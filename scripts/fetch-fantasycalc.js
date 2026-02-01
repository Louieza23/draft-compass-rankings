const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');

// Fantasy Calc API configurations
const FC_FORMATS = {
    dynasty_1qb: {
        endpoint: 'https://api.fantasycalc.com/values/current?isDynasty=true&numQbs=1&numTeams=12&ppr=1',
        format: 'dynasty_1qb',
        name: 'Dynasty 1QB'
    },
    dynasty_2qb: {
        endpoint: 'https://api.fantasycalc.com/values/current?isDynasty=true&numQbs=2&numTeams=12&ppr=1',
        format: 'dynasty_2qb',
        name: 'Dynasty 2QB/Superflex'
    },
    redraft_1qb: {
        endpoint: 'https://api.fantasycalc.com/values/current?isDynasty=false&numQbs=1&numTeams=12&ppr=1',
        format: 'redraft_1qb',
        name: 'Redraft 1QB'
    },
    redraft_2qb: {
        endpoint: 'https://api.fantasycalc.com/values/current?isDynasty=false&numQbs=2&numTeams=12&ppr=1',
        format: 'redraft_2qb',
        name: 'Redraft 2QB/Superflex'
    }
};

/**
 * Parse FantasyCalc API response
 * @param {Object} apiData - Raw API response
 * @returns {Object} Parsed rankings data
 */
function parseFantasyCalcResponse(apiData) {
    const players = [];

    if (!Array.isArray(apiData)) {
        throw new Error('Invalid API response: expected array');
    }

    for (let i = 0; i < apiData.length; i++) {
        const item = apiData[i];

        // Extract player data from the API response
        // Format: { player: {...}, value: number, overallRank: number, positionRank: number, ... }
        const player = item.player || {};

        const name = player.name;
        const position = player.position?.toUpperCase();
        const team = player.maybeTeam?.toUpperCase() || 'FA';
        const value = item.value || 0;
        const rank = item.overallRank || (i + 1);
        const positionRank = item.positionRank || 0;

        // Additional fields available from FantasyCalc
        const trend30Day = item.trend30Day || null;
        const redraftValue = item.redraftValue || null;
        const tier = item.maybeTier || null;
        const isStarter = item.starter || false;
        const sleeperId = player.sleeperId || null;

        // Validate required fields
        if (!name || !position) {
            continue;
        }

        // Only include valid fantasy positions
        const validPositions = ['QB', 'RB', 'WR', 'TE'];
        if (!validPositions.includes(position)) {
            continue;
        }

        players.push({
            rank: rank,
            name: name,
            position: position,
            team: team,
            value: value,
            positionRank: positionRank,
            sleeperId: sleeperId,
            trend30Day: trend30Day,
            redraftValue: redraftValue,
            tier: tier,
            isStarter: isStarter
        });
    }

    // Sort by overall rank
    players.sort((a, b) => a.rank - b.rank);

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
        const response = await fetch(config.endpoint, {
            method: 'GET',
            headers: {
                'Accept': 'application/json',
                'Cache-Control': 'no-cache',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const apiData = await response.json();

        const players = parseFantasyCalcResponse(apiData);

        console.log(`  Parsed ${players.length} players`);

        return {
            lastUpdated: new Date().toISOString(),
            source: 'fantasycalc',
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
 * Create CSV format from parsed data (for backwards compatibility)
 * @param {Object} data - Parsed rankings data
 * @returns {string} CSV content
 */
function createCsvFormat(data) {
    const header = 'Rank,Player,Position,Team,Value,PositionRank,Trend30Day,RedraftValue,Tier';
    const rows = data.players.map(p =>
        `${p.rank},${p.name},${p.position},${p.team},${p.value},${p.positionRank},${p.trend30Day || ''},${p.redraftValue || ''},${p.tier || ''}`
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
    const rawDir = path.join(__dirname, '..', 'data', 'raw', 'fantasycalc', format);
    const processedDir = path.join(__dirname, '..', 'data', 'processed', 'fantasycalc');

    [rawDir, processedDir].forEach(dir => {
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }
    });

    // Generate timestamp
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

    // Save raw JSON (API response for reference)
    const rawPath = path.join(rawDir, `api-response-${timestamp}.json`);
    fs.writeFileSync(rawPath, JSON.stringify(data, null, 2));

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
async function fetchFantasyCalcRankings() {
    console.log('=== Fetching Fantasy Calc Rankings ===\n');

    const results = {};

    for (const [key, config] of Object.entries(FC_FORMATS)) {
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

    console.log('=== Fantasy Calc Rankings Fetch Complete ===');
    console.log('Results:');
    for (const [key, result] of Object.entries(results)) {
        const status = result.success ? '✓' : '✗';
        const details = result.success ? `${result.players} players` : result.error;
        console.log(`  ${status} ${FC_FORMATS[key].name}: ${details}`);
    }

    return results;
}

// Run if called directly
if (require.main === module) {
    fetchFantasyCalcRankings();
}

module.exports = { fetchFantasyCalcRankings, FC_FORMATS };
