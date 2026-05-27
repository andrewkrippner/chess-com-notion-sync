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

## Quick start (GitHub Actions)

This repo deploys itself: push to `master` and CI runs `ntn workers deploy` for you. To set it up on your own fork:

1. **Fork this repo** on GitHub.

2. **Get a Notion API token** from a Notion integration with workspace access (https://www.notion.so/profile/integrations).

3. **Configure the repo in GitHub** (Settings → Secrets and variables → Actions):

   | Kind | Name | Value |
   |---|---|---|
   | Secret | `NOTION_API_TOKEN` | your Notion integration token |
   | Secret | `NOTION_WORKSPACE_ID` | the ID of the Notion workspace to deploy into |
   | Variable | `CHESSCOM_USERNAME` | your Chess.com username |
   | Variable | `TIMEZONE` | e.g. `America/Los_Angeles` (optional, defaults to LA) |

   Or via the `gh` CLI:
   ```bash
   gh secret set NOTION_API_TOKEN
   gh secret set NOTION_WORKSPACE_ID
   gh variable set CHESSCOM_USERNAME --body "yourusername"
   gh variable set TIMEZONE --body "America/Los_Angeles"
   ```

4. **Push to `master`** (or re-run the latest workflow). CI builds, sets the worker env vars, and deploys.

Notion will then run the sync every hour automatically. The database appears in your workspace under the integration you authorized.

## Quick start (CLI)

Prefer to deploy from your laptop? You'll need Node 22+ and a Notion account.

1. **Install the Notion Workers CLI:** `npm i -g ntn`
2. **Clone and install:** `git clone https://github.com/andrewkrippner/chess-com-notion-sync.git && cd chess-com-notion-sync && npm install`
3. **Log in:** `ntn login`
4. **Configure:**
   ```bash
   ntn workers env set CHESSCOM_USERNAME=yourusername
   ntn workers env set TIMEZONE=America/Los_Angeles   # optional
   ```
5. **Deploy:** `ntn workers deploy`
6. **First sync:**
   ```bash
   ntn workers sync trigger chessGamesSync --preview   # dry run
   ntn workers sync trigger chessGamesSync             # real sync
   ```

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

## Development

```bash
npm install
npm run check    # typecheck
npm run build    # emit dist/
```

The worker entrypoint is `src/index.ts`; the PGN parser is `src/pgn.ts`.

## Why this exists

I built this for [chesscards.ai](https://chesscards.ai), a chess flashcard app I'm working on, but the sync turned out to be useful on its own — Notion is a surprisingly nice place to keep a chess journal. Hourly automatic ingestion + rich filterable metadata gets you most of the way to a personal Chess.com dashboard with zero infrastructure.

## Contributing

Bug reports, feature ideas, and PRs are welcome. Run `npm run check` before opening a PR.

## License

[MIT](./LICENSE)
