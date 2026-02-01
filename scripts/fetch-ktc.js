const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');

// Keep Trade Cut URL configurations
const KTC_FORMATS = {
    dynasty_1qb: {
        url: 'https://keeptradecut.com/dynasty-rankings?filters=QB|WR|RB|TE|RDP&format=1',
        format: 'dynasty_1qb',
        name: 'Dynasty 1QB',
        valueField: 'oneQBValues',
        isDynasty: true
    },
    dynasty_superflex: {
        url: 'https://keeptradecut.com/dynasty-rankings?filters=QB|WR|RB|TE|RDP&format=0',
        format: 'dynasty_superflex',
        name: 'Dynasty Superflex',
        valueField: 'superflexValues',
        isDynasty: true
    },
    redraft_1qb: {
        url: 'https://keeptradecut.com/fantasy-rankings?filters=QB|WR|RB|TE&format=1',
        format: 'redraft_1qb',
        name: 'Redraft 1QB',
        valueField: 'oneQBValues',
        isDynasty: false
    },
    redraft_superflex: {
        url: 'https://keeptradecut.com/fantasy-rankings?filters=QB|WR|RB|TE&format=2',
        format: 'redraft_superflex',
        name: 'Redraft Superflex',
        valueField: 'superflexValues',
        isDynasty: false
    }
};

/**
 * Extract playersArray from KTC HTML page
 * Uses bracket counting to handle nested arrays properly
 * @param {string} html - HTML content from KTC page
 * @returns {Array|null} Parsed players array or null if not found
 */
function extractPlayersArray(html) {
    // Find the start of playersArray
    const startMatch = html.match(/var\s+playersArray\s*=\s*\[/);
    if (!startMatch) {
        return null;
    }

    const startIndex = startMatch.index + startMatch[0].length - 1; // Position at the opening [

    // Use bracket counting to find the matching closing bracket
    let bracketCount = 0;
    let inString = false;
    let stringChar = null;
    let i = startIndex;

    for (; i < html.length; i++) {
        const char = html[i];
        const prevChar = i > 0 ? html[i - 1] : null;

        // Handle string boundaries (handle escaped quotes)
        if (!inString && (char === '"' || char === "'")) {
            inString = true;
            stringChar = char;
        } else if (inString && char === stringChar && prevChar !== '\\') {
            inString = false;
            stringChar = null;
        }

        // Only count brackets when not inside a string
        if (!inString) {
            if (char === '[') {
                bracketCount++;
            } else if (char === ']') {
                bracketCount--;
                if (bracketCount === 0) {
                    // Found the matching closing bracket
                    break;
                }
            }
        }
    }

    if (bracketCount !== 0) {
        console.error('Failed to find matching closing bracket for playersArray');
        return null;
    }

    // Extract the JSON array
    const jsonStr = html.substring(startIndex, i + 1);

    try {
        return JSON.parse(jsonStr);
    } catch (e) {
        console.error('Failed to parse playersArray:', e.message);
        return null;
    }
}

/**
 * Parse KTC player data into standardized format
 * @param {Array} playersArray - Raw players array from KTC
 * @param {Object} config - Format configuration
 * @returns {Array} Parsed player objects
 */
function parsePlayers(playersArray, config) {
    const players = [];
    const validPositions = ['QB', 'RB', 'WR', 'TE'];

    for (const player of playersArray) {
        const position = player.position?.toUpperCase();

        // Skip invalid positions
        if (!validPositions.includes(position)) {
            continue;
        }

        // Get values based on format (1QB vs Superflex)
        const values = player[config.valueField] || {};

        // Skip if no value data available
        if (!values || values.value === undefined) {
            continue;
        }

        players.push({
            playerId: player.playerID,
            name: player.playerName,
            position: position,
            team: player.team?.toUpperCase() || 'FA',
            value: values.value,
            rank: values.rank,
            positionRank: values.positionalRank,
            age: player.age || null,
            kept: values.kept || 0,
            traded: values.traded || 0,
            cut: values.cut || 0,
            overallTier: values.overallTier || null,
            positionTier: values.positionalTier || null
        });
    }

    // Sort by rank
    players.sort((a, b) => a.rank - b.rank);

    // Re-assign sequential ranks after sorting
    players.forEach((p, i) => {
        p.rank = i + 1;
    });

    return players;
}

/**
 * Fetch rankings for a specific format
 * @param {Object} config - Format configuration
 * @returns {Object} Parsed rankings data
 */
async function fetchFormatRankings(config) {
    console.log(`Fetching ${config.name} rankings...`);

    try {
        const response = await fetch(config.url, {
            method: 'GET',
            headers: {
                'Accept': 'text/html,application/xhtml+xml',
                'Cache-Control': 'no-cache',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const html = await response.text();

        // Extract playersArray from HTML
        const playersArray = extractPlayersArray(html);

        if (!playersArray) {
            throw new Error('Could not find playersArray in HTML');
        }

        console.log(`  Found ${playersArray.length} raw player entries`);

        // Parse into standardized format
        const players = parsePlayers(playersArray, config);

        console.log(`  Parsed ${players.length} valid players`);

        return {
            lastUpdated: new Date().toISOString(),
            source: 'ktc',
            format: config.format,
            formatName: config.name,
            totalPlayers: players.length,
            players: players
        };

    } catch (error) {
        console.error(`  Error: ${error.message}`);
        throw error;
    }
}

/**
 * Create CSV format from parsed data
 * @param {Object} data - Parsed rankings data
 * @returns {string} CSV content
 */
function createCsvFormat(data) {
    const header = 'Rank,Player,Position,Team,Value,PositionRank,Age,Kept,Traded,Cut';
    const rows = data.players.map(p =>
        `${p.rank},"${p.name}",${p.position},${p.team},${p.value},${p.positionRank || ''},${p.age || ''},${p.kept || ''},${p.traded || ''},${p.cut || ''}`
    );
    return header + '\n' + rows.join('\n');
}

/**
 * Save rankings data to files
 * @param {Object} data - Rankings data
 */
function saveRankings(data) {
    const format = data.format;

    // Create directories
    const rawDir = path.join(__dirname, '..', 'data', 'raw', 'ktc', format);
    const processedDir = path.join(__dirname, '..', 'data', 'processed', 'ktc');

    [rawDir, processedDir].forEach(dir => {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
    });

    // Generate timestamp
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

    // Save processed JSON
    const jsonPath = path.join(processedDir, `rankings-${format}-latest.json`);
    fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2));
    console.log(`  Saved JSON to ${jsonPath}`);

    // Save timestamped version
    const jsonHistoryPath = path.join(processedDir, `rankings-${format}-${timestamp}.json`);
    fs.writeFileSync(jsonHistoryPath, JSON.stringify(data, null, 2));

    // Save CSV
    const csvFormatted = createCsvFormat(data);
    const csvPath = path.join(processedDir, `rankings-${format}-latest.csv`);
    fs.writeFileSync(csvPath, csvFormatted);
    console.log(`  Saved CSV to ${csvPath}`);

    // Cleanup old history files (keep last 10 per format)
    const files = fs.readdirSync(processedDir)
        .filter(f => f.startsWith(`rankings-${format}-20`) && f.endsWith('.json'))
        .sort()
        .reverse();

    if (files.length > 10) {
        files.slice(10).forEach(file => {
            fs.unlinkSync(path.join(processedDir, file));
            console.log(`  Cleaned up old file: ${file}`);
        });
    }
}

/**
 * Main fetch function
 */
async function fetchKtcRankings() {
    console.log('=== Fetching Keep Trade Cut Rankings ===\n');

    const results = {};

    for (const [key, config] of Object.entries(KTC_FORMATS)) {
        try {
            const data = await fetchFormatRankings(config);
            saveRankings(data);
            results[key] = {
                success: true,
                players: data.totalPlayers
            };
        } catch (error) {
            console.error(`Failed to fetch ${config.name}:`, error.message);
            results[key] = {
                success: false,
                error: error.message
            };
        }
        console.log('');
    }

    console.log('=== KTC Rankings Fetch Complete ===');
    console.log('Results:');
    for (const [key, result] of Object.entries(results)) {
        const status = result.success ? '✓' : '✗';
        const details = result.success ? `${result.players} players` : result.error;
        console.log(`  ${status} ${KTC_FORMATS[key].name}: ${details}`);
    }

    return results;
}

// Run if called directly
if (require.main === module) {
    fetchKtcRankings();
}

module.exports = { fetchKtcRankings, KTC_FORMATS };
