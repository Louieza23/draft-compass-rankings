# Draft Compass Rankings

Automated rankings fetcher for the Draft Compass browser extension. This repository periodically fetches fantasy football rankings from multiple sources and stores them for easy consumption.

## Data Sources

| Source | Status | Format | Update Frequency |
|--------|--------|--------|------------------|
| Underdog (Direct CSV) | Active | ADP Rankings | Every 6 hours |
| Keep Trade Cut | Planned | Dynasty Values | - |
| Fantasy Calc | Planned | Trade Values | - |

## Setup

### 1. Get Your Underdog CSV URL

Follow the steps in [Underdog Rankings Guide](https://github.com/YOUR_USERNAME/draft-compass-rankings/blob/main/docs/underdog-setup.md) to obtain your personal CSV download URL.

### 2. Configure GitHub Secret

1. Go to your GitHub repository Settings → Secrets and variables → Actions
2. Click "New repository secret"
3. Name: `UNDERDOG_CSV_URL`
4. Value: Your Underdog CSV download URL (from step 1)
5. Click "Add secret"

### 3. Verify Setup

1. Go to Actions → Fetch Rankings
2. Click "Run workflow" → Run workflow
3. Check that the workflow completes successfully

## Repository Structure

```
.
├── .github/workflows/
│   └── fetch-rankings.yml    # GitHub Actions automation
├── data/
│   ├── raw/                   # Raw responses from sources
│   │   └── underdog/
│   └── processed/             # Normalized data
│       └── underdog/
│           ├── rankings-latest.json   # Always latest
│           ├── rankings-latest.csv    # CSV format
│           └── rankings-{timestamp}.json  # Historical
├── scripts/
│   └── fetch-underdog.js     # Fetch script
└── README.md
```

## Usage

### For Extension Developers

Access the latest rankings via GitHub's raw file CDN:

```
https://raw.githubusercontent.com/{username}/draft-compass-rankings/main/data/processed/underdog/rankings-latest.json
```

### JSON Format

```json
{
  "lastUpdated": "2026-01-31T12:00:00.000Z",
  "source": "underdog",
  "slate": "NFL 2026 Pre-Draft Best Ball",
  "totalPlayers": 250,
  "players": [
    {
      "rank": 1,
      "name": "Player Name",
      "position": "WR",
      "team": "KC",
      "adp": 1.5,
      "originalRank": 1
    }
  ]
}
```

## Manual Trigger

You can manually trigger a fetch via the GitHub Actions tab:
1. Go to Actions → Fetch Rankings
2. Click "Run workflow"
3. Select source (underdog or all)

## Automation Schedule

The workflow runs automatically every 6 hours with a random delay of 0-15 minutes to avoid predictable load patterns.

## URL Expiration

The Underdog CSV URL contains session information that may expire. If the workflow starts failing:

1. Revisit the Underdog rankings page
2. Click the CSV download button
3. Capture the new URL from browser DevTools Network tab
4. Update the `UNDERDOG_CSV_URL` secret in GitHub

## License

MIT
