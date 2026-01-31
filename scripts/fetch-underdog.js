const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');

// Underdog CSV download URL - should be set as UNDERDOG_CSV_URL environment variable
// Format: https://app.underdogfantasy.com/rankings/download/[SLATE_ID]/[USER_ID]/[SESSION_ID]?[PARAMS]
const UNDERDOG_CSV_URL = process.env.UNDERDOG_CSV_URL;

/**
 * Parse Underdog CSV content
 * Expected format: Rank,Player,Position,Team,FPTS,Bye
 * @param {string} csvContent - Raw CSV from Underdog
 * @returns {Object} Parsed rankings data
 */
function parseUnderdogCsv(csvContent) {
    const lines = csvContent.trim().split('\n');
    const players = [];

    // Skip header row
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        // Parse CSV line (handle quoted fields)
        const fields = parseCsvLine(line);
        if (fields.length >= 4) {
            const rank = parseInt(fields[0]) || i;
            const name = fields[1]?.trim() || '';
            const position = fields[2]?.trim() || '';
            const team = fields[3]?.trim() || 'N/A';

            if (name) {
                players.push({
                    rank: rank,
                    name: name,
                    position: position,
                    team: team,
                    adp: rank,
                    originalRank: i
                });
            }
        }
    }

    return {
        lastUpdated: new Date().toISOString(),
        source: 'underdog',
        slate: 'NFL 2026 Pre-Draft Best Ball',
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
