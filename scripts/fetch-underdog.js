const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');

// Underdog CSV download URL - should be set as UNDERDOG_CSV_URL environment variable
// Format: https://app.underdogfantasy.com/rankings/download/[SLATE_ID]/[USER_ID]/[SESSION_ID]?[PARAMS]
const UNDERDOG_CSV_URL = process.env.UNDERDOG_CSV_URL;

/**
 * Parse Underdog CSV content
 * Underdog format: Rank,FirstName,LastName,ADP,Position,Team,...
 * @param {string} csvContent - Raw CSV from Underdog
 * @returns {Object} Parsed rankings data
 */
function parseUnderdogCsv(csvContent) {
    const lines = csvContent.trim().split('\n');
    const players = [];

    // Try to detect column positions from header
    const header = lines[0] ? parseCsvLine(lines[0].toLowerCase()) : [];

    // Find column indices (with fallbacks)
    let rankCol = header.findIndex(h => h.includes('rank') || h === '#');
    let firstNameCol = header.findIndex(h => h.includes('first') || h === 'first name');
    let lastNameCol = header.findIndex(h => h.includes('last') || h === 'last name');
    let positionCol = header.findIndex(h => h.includes('pos') || h === 'position');
    let teamCol = header.findIndex(h => h.includes('team'));
    let adpCol = header.findIndex(h => h.includes('adp') || h.includes('rank'));

    // Default column positions if auto-detect fails (Underdog typical format)
    if (rankCol === -1) rankCol = 0;
    if (firstNameCol === -1) firstNameCol = 1;
    if (lastNameCol === -1) lastNameCol = 2;
    // ADP is often column 3 in Underdog exports
    if (adpCol === -1 || adpCol === rankCol) adpCol = 3;
    if (positionCol === -1) positionCol = 4;
    if (teamCol === -1) teamCol = 5;

    // Skip header row
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        // Parse CSV line (handle quoted fields)
        const fields = parseCsvLine(line);
        if (fields.length >= 4) {
            const rank = parseInt(fields[rankCol]) || i;
            const firstName = fields[firstNameCol]?.trim() || '';
            const lastName = fields[lastNameCol]?.trim() || '';
            const fullName = `${firstName} ${lastName}`.trim();

            // Parse ADP - could be "1.1" format or just a number
            let adp = rank;
            const adpRaw = fields[adpCol]?.trim() || '';
            if (adpRaw) {
                // Handle "1.1" (round.pick) format - convert to overall pick number
                if (adpRaw.includes('.')) {
                    const [round, pick] = adpRaw.split('.').map(Number);
                    if (!isNaN(round) && !isNaN(pick)) {
                        adp = (round - 1) * 12 + pick; // Assuming 12-team league
                    }
                } else {
                    adp = parseFloat(adpRaw) || rank;
                }
            }

            const position = fields[positionCol]?.trim().toUpperCase() || '';
            const team = fields[teamCol]?.trim().toUpperCase() || 'N/A';

            // Validate position is a real position (QB, RB, WR, TE, K, DST, DEF)
            const validPositions = ['QB', 'RB', 'WR', 'TE', 'K', 'DST', 'DEF', 'FLEX'];
            const isValidPosition = validPositions.some(p => position.includes(p));

            if (fullName && isValidPosition) {
                players.push({
                    rank: rank,
                    name: fullName,
                    position: position.replace(/[^A-Z]/g, ''), // Clean position
                    team: team,
                    adp: adp,
                    originalRank: i
                });
            }
        }
    }

    return {
        lastUpdated: new Date().toISOString(),
        source: 'underdog',
        slate: 'NFL 2026 Best Ball',
        totalPlayers: players.length,
        players: players
    };
}

/**
 * Parse a CSV line handling quoted fields
 * @param {string} line - CSV line
 * @returns {string[]} Array of fields
 */
function parseCsvLine(line) {
    const fields = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
        const char = line[i];

        if (char === '"') {
            inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
            fields.push(current.trim());
            current = '';
        } else {
            current += char;
        }
    }
    fields.push(current.trim());

    return fields;
}

/**
 * Create CSV format from parsed data (for backwards compatibility)
 * @param {Object} data - Parsed rankings data
 * @returns {string} CSV content in FantasyPros format
 */
function createFantasyProsCsvFormat(data) {
    const header = 'Rank,Player,Position,Team,Extra,ADP,Final';
    const rows = data.players.map(p => `${p.rank},${p.name},${p.position},${p.team},,${p.adp},`);
    return header + '\n' + rows.join('\n');
}

/**
 * Main fetch function
 */
async function fetchUnderdogRankings() {
    console.log('Fetching Underdog rankings...');

    if (!UNDERDOG_CSV_URL) {
        console.error('ERROR: UNDERDOG_CSV_URL environment variable is not set');
        console.error('Please set it to your Underdog CSV download URL');
        console.error('Format: https://app.underdogfantasy.com/rankings/download/[SLATE_ID]/[USER_ID]/[SESSION_ID]?[PARAMS]');
        process.exit(1);
    }

    try {
        const response = await fetch(UNDERDOG_CSV_URL, {
            method: 'GET',
            headers: {
                'Accept': 'text/csv,text/plain,*/*',
                'Cache-Control': 'no-cache',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const csvText = await response.text();
        console.log(`Fetched ${csvText.length} bytes from Underdog`);

        // Parse the CSV
        const parsedData = parseUnderdogCsv(csvText);
        console.log(`Parsed ${parsedData.totalPlayers} players`);

        // Create data directories if they don't exist
        const rawDir = path.join(__dirname, '..', 'data', 'raw', 'underdog');
        const processedDir = path.join(__dirname, '..', 'data', 'processed', 'underdog');

        [rawDir, processedDir].forEach(dir => {
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
        });

        // Generate timestamp for filenames
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

        // Save raw CSV
        const rawPath = path.join(rawDir, `underdog-${timestamp}.csv`);
        fs.writeFileSync(rawPath, csvText);
        console.log(`Saved raw CSV to ${rawPath}`);

        // Save processed JSON
        const jsonPath = path.join(processedDir, 'rankings-latest.json');
        fs.writeFileSync(jsonPath, JSON.stringify(parsedData, null, 2));
        console.log(`Saved processed JSON to ${jsonPath}`);

        // Also save timestamped version for history
        const jsonHistoryPath = path.join(processedDir, `rankings-${timestamp}.json`);
        fs.writeFileSync(jsonHistoryPath, JSON.stringify(parsedData, null, 2));

        // Save CSV in FantasyPros-compatible format for backwards compatibility
        const csvFormatted = createFantasyProsCsvFormat(parsedData);
        const csvPath = path.join(processedDir, 'rankings-latest.csv');
        fs.writeFileSync(csvPath, csvFormatted);
        console.log(`Saved formatted CSV to ${csvPath}`);

        // Cleanup old history files (keep last 10)
        const files = fs.readdirSync(processedDir)
            .filter(f => f.startsWith('rankings-20') && f.endsWith('.json'))
            .sort()
            .reverse();

        if (files.length > 10) {
            files.slice(10).forEach(file => {
                fs.unlinkSync(path.join(processedDir, file));
                console.log(`Cleaned up old file: ${file}`);
            });
        }

        console.log('Underdog rankings fetch completed successfully!');
        return { success: true, players: parsedData.totalPlayers };

    } catch (error) {
        console.error('Error fetching Underdog rankings:', error);
        process.exit(1);
    }
}

// Run if called directly
if (require.main === module) {
    fetchUnderdogRankings();
}

module.exports = { fetchUnderdogRankings, parseUnderdogCsv };
