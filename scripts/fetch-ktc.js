const fs = require('fs');
const path = require('path');
const fetch = require('node-fetch');

// Keep Trade Cut URL configurations
const KTC_FORMATS = {
    dynasty_1qb: {
        url: 'https://keeptradecut.com/dynasty-rankings?page={page}&filters=QB|WR|RB|TE|RDP&format=1',
        format: 'dynasty_1qb',
        name: 'Dynasty 1QB'
    },
    dynasty_superflex: {
        url: 'https://keeptradecut.com/dynasty-rankings?page={page}&filters=QB|WR|RB|TE|RDP&format=0',
        format: 'dynasty_superflex',
        name: 'Dynasty Superflex'
    },
    redraft_1qb: {
        url: 'https://keeptradecut.com/fantasy-rankings?page={page}&filters=QB|WR|RB|TE&format=1',
        format: 'redraft_1qb',
        name: 'Redraft 1QB'
    },
    redraft_superflex: {
        url: 'https://keeptradecut.com/fantasy-rankings?page={page}&filters=QB|WR|RB|TE&format=2',
        format: 'redraft_superflex',
        name: 'Redraft Superflex'
    }
};

/**
 * Extract player data from KTC HTML page
 * @param {string} html - HTML content from KTC page
 * @param {number} startRank - Starting rank for this page
 * @returns {Object[]} Array of player objects
 */
function extractPlayersFromHtml(html, startRank = 1) {
    const players = [];

    // KTC uses a specific pattern for player rows
    // Look for divs with class containing "onePlayer" or similar player containers
    const playerRegex = /<div[^>]*class="[^"]*onePlayer[^"]*"[^>]*>(.*?)<\/div>\s*<\/div>/gi;

    let match;
    let rank = startRank;

    while ((match = playerRegex.exec(html)) !== null) {
        const playerHtml = match[1];

        // Extract player name
        const nameMatch = playerHtml.match(/<a[^>]*class="[^"]*player-name[^"]*"[^>]*>(.*?)<\/a>/i) ||
                          playerHtml.match(/<span[^>]*class="[^"]*player-name[^"]*"[^>]*>(.*?)<\/span>/i);
        const name = nameMatch ? cleanHtml(nameMatch[1]) : null;

        if (!name) continue;

        // Extract position
        const positionMatch = playerHtml.match(/<span[^>]*class="[^"]*position[^"]*"[^>]*>([A-Z]+)<\/span>/i);
        const position = positionMatch ? positionMatch[1] : '';

        // Extract team
        const teamMatch = playerHtml.match(/<span[^>]*class="[^"]*team[^"]*"[^>]*>([A-Z]+)<\/span>/i);
        const team = teamMatch ? teamMatch[1] : '';

        // Extract value (KTC value score)
        const valueMatch = playerHtml.match(/<div[^>]*class="[^"]*value[^"]*"[^>]*>([\d,]+)<\/div>/i) ||
                           playerHtml.match(/value["']?\s*[:>]+\s*["']?([\d,]+)/i);
        const value = valueMatch ? parseInt(valueMatch[1].replace(/,/g, ''), 10) : 0;

        // Extract age (dynasty only)
        const ageMatch = playerHtml.match(/<div[^>]*class="[^"]*age[^"]*"[^>]*>([\d.]+)<\/div>/i);
        const age = ageMatch ? parseFloat(ageMatch[1]) : null;

        if (name && position) {
            players.push({
                rank: rank,
                name: name,
                position: position,
                team: team || 'FA',
                value: value,
                age: age
            });
            rank++;
        }
    }

    return players;
}

/**
 * Clean HTML tags from text
 * @param {string} html - HTML string
 * @returns {string} Clean text
 */
function cleanHtml(html) {
    return html
        .replace(/<[^>]+>/g, '')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&nbsp;/g, ' ')
        .trim();
}

/**
 * Check if page has more results
 * @param {string} html - HTML content
 * @returns {boolean} True if there's a next page
 */
function hasNextPage(html) {
    // Look for next page button/link
    const hasNext = html.includes('page-item next') ||
                   html.includes('pagination-next') ||
                   html.match(/page=\d+["'][^>]*>[\s]*(?:Next|›|»)/i) !== null;

    // Also check if we got any players - if no players, we're done
    const playerCount = (html.match(/onePlayer/g) || []).length;

    return hasNext && playerCount > 0;
}

/**
 * Fetch rankings for a specific format
 * @param {Object} config - Format configuration
 * @returns {Object} Parsed rankings data
 */
async function fetchFormatRankings(config) {
    console.log(`Fetching ${config.name} rankings...`);

    const allPlayers = [];
    let page = 0;
    let hasMore = true;
    const maxPages = 50; // Safety limit

    while (hasMore && page < maxPages) {
        const url = config.url.replace('{page}', page);

        try {
            const response = await fetch(url, {
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

            // Check if page has content
            if (html.includes('No players found') || html.includes('No results')) {
                break;
            }

            const players = extractPlayersFromHtml(html, allPlayers.length + 1);

            if (players.length === 0) {
                hasMore = false;
            } else {
                allPlayers.push(...players);
                console.log(`  Page ${page}: Found ${players.length} players (total: ${allPlayers.length})`);

                // Check for next page indicator
                hasMore = hasNextPage(html);
            }

            page++;

            // Small delay to be respectful to the server
            if (hasMore) {
                await new Promise(resolve => setTimeout(resolve, 500));
            }

        } catch (error) {
            console.error(`Error fetching page ${page}:`, error.message);
            hasMore = false;
        }
    }

    console.log(`Total players fetched for ${config.name}: ${allPlayers.length}`);

    return {
        lastUpdated: new Date().toISOString(),
        source: 'ktc',
        format: config.format,
        formatName: config.name,
        totalPlayers: allPlayers.length,
        players: allPlayers
    };
}

/**
 * Create CSV format from parsed data (for backwards compatibility)
 * @param {Object} data - Parsed rankings data
 * @returns {string} CSV content
 */
function createCsvFormat(data) {
    const header = 'Rank,Player,Position,Team,Value,Age';
    const rows = data.players.map(p =>
        `${p.rank},${p.name},${p.position},${p.team},${p.value},${p.age || ''}`
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
    console.log(`Saved JSON to ${jsonPath}`);

    // Save timestamped version
    const jsonHistoryPath = path.join(processedDir, `rankings-${format}-${timestamp}.json`);
    fs.writeFileSync(jsonHistoryPath, JSON.stringify(data, null, 2));

    // Save CSV
    const csvFormatted = createCsvFormat(data);
    const csvPath = path.join(processedDir, `rankings-${format}-latest.csv`);
    fs.writeFileSync(csvPath, csvFormatted);
    console.log(`Saved CSV to ${csvPath}`);

    // Cleanup old history files (keep last 10 per format)
    const files = fs.readdirSync(processedDir)
        .filter(f => f.startsWith(`rankings-${format}-20`) && f.endsWith('.json'))
        .sort()
        .reverse();

    if (files.length > 10) {
        files.slice(10).forEach(file => {
            fs.unlinkSync(path.join(processedDir, file));
            console.log(`Cleaned up old file: ${file}`);
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
