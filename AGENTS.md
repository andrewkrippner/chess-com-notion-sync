# Repository guide for agents

Chess.com → Notion sync, deployed as a [Notion Worker](https://developers.notion.com/docs/workers). No server, no API keys to manage — Notion runs the worker on a schedule.

## Layout

- `src/index.ts` — worker entrypoint and sync logic.
- `src/pgn.ts` — PGN parser.
- `worktree-setup.sh` / `worktree-archive.sh` — Conductor worktree helpers.
- `conductor.json` — Conductor workspace config.
- `.github/` — CI (runs `npm run check` on push/PR to `master`).

No tests in-repo; correctness is enforced by `tsc --noEmit`.

## Conventions

- TypeScript, ESM (`"type": "module"`), Node 22+.
- Default branch is `master` (not `main`). PRs target `master`.
- Dependencies are deliberately minimal — just `@notionhq/workers`. Don't add libraries without a clear reason.

## Commands

```bash
npm install
npm run check     # typecheck — run before committing
npm run build     # emit dist/
```

Deploy / operate (requires `ntn` CLI and a Notion login):

```bash
ntn workers deploy
ntn workers sync trigger chessGamesSync --preview   # dry run
ntn workers sync trigger chessGamesSync             # real sync
ntn workers sync status
ntn workers sync state reset chessGamesSync         # re-sync from scratch
```

Env vars consumed by the worker: `CHESSCOM_USERNAME` (required), `TIMEZONE` (optional, defaults to `America/Los_Angeles`).

## How the sync behaves

- **Incremental:** stores the timestamp of the last synced game and only fetches newer ones.
- **Newest-first walk** of Chess.com's monthly archives; stops at the first month with nothing new.
- **Upsert by Chess.com game UUID** — re-runs are safe.
- **Rate-limited** to one request per 500ms via Notion's pacer (Chess.com requires sequential requests).

When changing sync behavior, preserve these invariants unless the user explicitly asks otherwise.

## Before opening a PR

1. `npm run check` passes.
2. PR base is `master`.
3. Keep diffs minimal — this is a small, focused repo.
