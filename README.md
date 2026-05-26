# chess-com-notion-sync

Sync your [Chess.com](https://www.chess.com) games into a [Notion](https://www.notion.so) database — automatically, every hour, with rich metadata and the full move list on every page.

Built as a [Notion Worker](https://developers.notion.com/docs/workers) — no server to run, no API keys to rotate. You deploy it once with the `ntn` CLI and Notion runs it on a schedule.

## What you get

A managed "Chess Games" database in your Notion workspace, one row per game, with:

| Column | Type | Description |
|---|---|---|
| Name | Title | `white vs black` |
| Game ID | Text | Chess.com UUID (primary key) |
| Date | Date | When the game ended, in your timezone |
| Result | Select | Win / Loss / Draw |
| Color | Select | White / Black |
| My Rating | Number | Your rating at time of game |
| Opponent | Link | Opponent's username, links to their Chess.com profile |
| Opponent Rating | Number | |
| Time Control | Select | Bullet / Blitz / Rapid / Daily |
| Time Control (Exact) | Select | e.g. `3 min + 2s`, `10 min`, `1 day/move` |
| Termination | Select | Checkmate / Resignation / Timeout / Stalemate / … |
| Total Moves | Number | |
| Rated | Checkbox | |
| Opening | Text | Opening name (from Chess.com's ECOUrl) |
| ECO Code | Text | e.g. `B10` |
| Duration (min) | Number | Wall-clock length of the game |
| Variant | Select | Standard / Chess960 / Bughouse / … |
| Accuracy | Percent | Your accuracy %, when Chess.com provides it |
| Link | URL | Game on Chess.com |

Each page's body contains the full PGN move list, formatted one move-pair per line:

```
1. e4 .. e5
2. Nf3 .. Nc6
3. Bb5 .. a6
...
```

That means you can use Notion's filters, sorts, and views to slice your games however you like: blunder hunting by opening, win rate by time control, accuracy trends, etc.

## Quick start

You'll need Node 22+ and a Notion account.

1. **Install the Notion Workers CLI:**
   ```bash
   npm i -g ntn
   ```

2. **Clone and install:**
   ```bash
   git clone https://github.com/andrewkrippner/chess-com-notion-sync.git
   cd chess-com-notion-sync
   npm install
   ```

3. **Log in to Notion:**
   ```bash
   ntn login
   ```

4. **Configure your username** (and optionally timezone):
   ```bash
   ntn workers env set CHESSCOM_USERNAME=yourusername
   ntn workers env set TIMEZONE=America/Los_Angeles   # optional, defaults to LA
   ```

5. **Deploy:**
   ```bash
   ntn workers deploy
   ```

6. **Run your first sync:**
   ```bash
   ntn workers sync trigger chessGamesSync --preview   # dry run
   ntn workers sync trigger chessGamesSync             # real sync
   ```

Notion will then run the sync every hour automatically. The database appears in your workspace under the integration you authorized.

## How it works

- **Incremental:** the worker remembers the timestamp of the last game it synced, and only fetches games newer than that.
- **Newest-first:** Chess.com's archives are paginated by month. The sync walks them newest-first and stops as soon as it hits a month with nothing new — so steady-state runs are cheap.
- **Rate-limited:** Chess.com asks API consumers for sequential, not parallel, requests. The worker uses Notion's built-in pacer to throttle itself to one request every 500 ms.
- **Upsert by game UUID:** re-running the sync is safe; rows are keyed on Chess.com's UUID and updated in place.

## Useful commands

```bash
ntn workers sync status                          # Check sync status
ntn workers sync trigger chessGamesSync          # Force a sync now
ntn workers sync state reset chessGamesSync      # Re-sync all games from scratch
ntn workers capabilities disable chessGamesSync  # Pause syncing
ntn workers capabilities enable chessGamesSync   # Resume syncing
```

## Removing legacy properties

If you ran an earlier version of this worker and your database still has columns like `Rating (After)` or `Opp Rating (After)`, you can drop them with the included script. Share the data source with a Notion integration first, then:

```bash
export NOTION_API_TOKEN=secret_xxx
export NOTION_DATA_SOURCE_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
npm run remove-legacy-properties
```

Or pass custom property names:

```bash
npm run remove-legacy-properties -- "Old Column" "Another Old Column"
```

## Development

```bash
npm install
npm run check    # typecheck
npm test         # run PGN parser tests
npm run build    # emit dist/
```

The worker entrypoint is `src/index.ts`; the PGN parser is `src/pgn.ts`.

## Deploying from CI

This repo deploys itself via GitHub Actions on every push to `main`, using [`andrewkrippner/setup-ntn`](https://github.com/andrewkrippner/setup-ntn). To do the same in your fork:

1. Generate a Notion API token with access to your workspace.
2. Add it as a `NOTION_API_TOKEN` repository secret (Settings → Secrets and variables → Actions).
3. Push to `main`. The `deploy` job in `.github/workflows/ci.yml` will run `ntn workers deploy` for you.

## Why this exists

I built this for [chesscards.ai](https://chesscards.ai), a chess flashcard app I'm working on, but the sync turned out to be useful on its own — Notion is a surprisingly nice place to keep a chess journal. Hourly automatic ingestion + rich filterable metadata gets you most of the way to a personal Chess.com dashboard with zero infrastructure.

## Contributing

Bug reports, feature ideas, and PRs are welcome. Run `npm run check` and `npm test` before opening a PR.

## License

[MIT](./LICENSE)
