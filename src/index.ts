import { Worker } from "@notionhq/workers";
import * as Schema from "@notionhq/workers/schema";
import * as Builder from "@notionhq/workers/builder";
import { extractMoves } from "./pgn.js";

const worker = new Worker();

// Rate-limit Chess.com API calls (they ask for sequential, not parallel)
const chesscomPacer = worker.pacer("chesscom", {
  allowedRequests: 1,
  intervalMs: 500,
});

// ---------------------------------------------------------------------------
// Chess.com API helpers
// ---------------------------------------------------------------------------

const CHESSCOM_USERNAME = process.env.CHESSCOM_USERNAME ?? "";
const TIMEZONE = process.env.TIMEZONE ?? "America/Los_Angeles";
const CHESSCOM_API_BASE = "https://api.chess.com/pub";

interface ChesscomGame {
  url: string;
  pgn: string;
  end_time: number;
  time_control: string;
  time_class: string;
  rated: boolean;
  rules: string;
  eco?: string;
  white: { username: string; rating: number; result: string };
  black: { username: string; rating: number; result: string };
  accuracies?: { white: number; black: number };
  uuid: string;
}

async function chesscomFetch<T>(path: string): Promise<T> {
  await chesscomPacer.wait();
  const res = await fetch(`${CHESSCOM_API_BASE}${path}`, {
    headers: { "User-Agent": "chesscards-notion-sync/0.1" },
  });
  if (!res.ok) throw new Error(`Chess.com API ${res.status}: ${path}`);
  return res.json() as Promise<T>;
}

async function getArchives(): Promise<string[]> {
  const data = await chesscomFetch<{ archives: string[] }>(
    `/player/${CHESSCOM_USERNAME}/games/archives`
  );
  return data.archives; // chronological, oldest first
}

async function getMonthGames(archiveUrl: string): Promise<ChesscomGame[]> {
  await chesscomPacer.wait();
  const res = await fetch(archiveUrl, {
    headers: { "User-Agent": "chesscards-notion-sync/0.1" },
  });
  if (!res.ok) throw new Error(`Chess.com API ${res.status}: ${archiveUrl}`);
  const data = (await res.json()) as { games: ChesscomGame[] };
  return data.games;
}

// ---------------------------------------------------------------------------
// Derive display fields from a Chess.com game
// ---------------------------------------------------------------------------

function getPlayerColor(game: ChesscomGame): "white" | "black" {
  return game.white.username.toLowerCase() === CHESSCOM_USERNAME.toLowerCase()
    ? "white"
    : "black";
}

function getResult(game: ChesscomGame): string {
  const color = getPlayerColor(game);
  const result = game[color].result;
  if (result === "win") return "Win";
  if (["checkmated", "timeout", "resigned", "abandoned"].includes(result))
    return "Loss";
  return "Draw";
}

function getOpponent(game: ChesscomGame) {
  const color = getPlayerColor(game);
  return color === "white" ? game.black : game.white;
}

function getTimeControlLabel(game: ChesscomGame): string {
  const labels: Record<string, string> = {
    bullet: "Bullet",
    blitz: "Blitz",
    rapid: "Rapid",
    daily: "Daily",
  };
  return labels[game.time_class] ?? game.time_class;
}

function getOpeningName(pgn: string): string {
  const match = pgn.match(/\[ECOUrl "https:\/\/www\.chess\.com\/openings\/([^"]+)"\]/);
  if (match) return match[1].replace(/-/g, " ");
  const eco = pgn.match(/\[ECO "([^"]+)"\]/);
  return eco ? eco[1] : "Unknown";
}

/** Format raw time_control string into a human-readable label.
 *  Examples: "600" → "10 min", "180+2" → "3 min + 2s", "1/259200" → "3 days" */
function formatTimeControl(tc: string): string {
  // Correspondence: "1/86400" means 1 move per 86400 seconds
  if (tc.startsWith("1/")) {
    const seconds = parseInt(tc.slice(2), 10);
    const days = Math.round(seconds / 86400);
    return days === 1 ? "1 day/move" : `${days} days/move`;
  }
  // Increment: "180+2" means 3 min base + 2s increment
  if (tc.includes("+")) {
    const [base, inc] = tc.split("+").map(Number);
    const mins = Math.floor(base / 60);
    const secs = base % 60;
    const baseStr = secs > 0 ? `${mins}:${String(secs).padStart(2, "0")}` : `${mins} min`;
    return `${baseStr} + ${inc}s`;
  }
  // Simple: "600" means 10 min
  const totalSec = parseInt(tc, 10);
  if (isNaN(totalSec)) return tc;
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  if (secs > 0) return `${mins}:${String(secs).padStart(2, "0")}`;
  return `${mins} min`;
}

/** Derive a clean termination reason from both players' results */
function getTermination(game: ChesscomGame): string {
  const color = getPlayerColor(game);
  const myResult = game[color].result;
  const oppResult = game[color === "white" ? "black" : "white"].result;

  // I won — look at opponent's result for how
  if (myResult === "win") {
    const map: Record<string, string> = {
      checkmated: "Checkmate",
      resigned: "Resignation",
      timeout: "Timeout",
      abandoned: "Abandonment",
    };
    return map[oppResult] ?? "Win";
  }
  // I lost — look at my result for how
  if (oppResult === "win") {
    const map: Record<string, string> = {
      checkmated: "Checkmate",
      resigned: "Resignation",
      timeout: "Timeout",
      abandoned: "Abandonment",
    };
    return map[myResult] ?? "Loss";
  }
  // Draw
  const drawMap: Record<string, string> = {
    stalemate: "Stalemate",
    repetition: "Repetition",
    agreed: "Draw Agreement",
    insufficient: "Insufficient Material",
    "50move": "50-Move Rule",
    timevsinsufficient: "Timeout vs Insufficient",
  };
  return drawMap[myResult] ?? drawMap[oppResult] ?? "Draw";
}

/** Count the total number of full moves in a PGN */
function countMoves(pgn: string): number {
  const lines = pgn.split("\n").filter((l) => !l.startsWith("[") && l.trim());
  const raw = lines.join(" ");
  const matches = raw.match(/\d+\./g);
  if (!matches) return 0;
  // The highest move number is the total
  return Math.max(...matches.map((m) => parseInt(m, 10)));
}

/** Extract the ECO code from a PGN (e.g. "C40", "B10") */
function getEcoCode(pgn: string): string {
  const match = pgn.match(/\[ECO "([^"]+)"\]/);
  return match ? match[1] : "";
}

/** Compute game duration in minutes from PGN StartTime/EndTime headers */
function getGameDurationMinutes(pgn: string): number | null {
  const startMatch = pgn.match(/\[StartTime "(\d+):(\d+):(\d+)"\]/);
  const endMatch = pgn.match(/\[EndTime "(\d+):(\d+):(\d+)"\]/);
  const startDate = pgn.match(/\[UTCDate "(\d+)\.(\d+)\.(\d+)"\]/);
  const endDate = pgn.match(/\[EndDate "(\d+)\.(\d+)\.(\d+)"\]/);
  if (!startMatch || !endMatch || !startDate || !endDate) return null;

  const start = new Date(
    `${startDate[1]}-${startDate[2]}-${startDate[3]}T${startMatch[1]}:${startMatch[2]}:${startMatch[3]}Z`
  );
  const end = new Date(
    `${endDate[1]}-${endDate[2]}-${endDate[3]}T${endMatch[1]}:${endMatch[2]}:${endMatch[3]}Z`
  );
  const diffMs = end.getTime() - start.getTime();
  if (diffMs < 0) return null;
  return Math.round((diffMs / 60000) * 10) / 10;
}

/** Map Chess.com rules field to a display label */
function getVariantLabel(rules: string): string {
  const map: Record<string, string> = {
    chess: "Standard",
    chess960: "Chess960",
    bughouse: "Bughouse",
    kingofthehill: "King of the Hill",
    threecheck: "Three-Check",
    crazyhouse: "Crazyhouse",
  };
  return map[rules] ?? rules;
}

/** Convert a UTC unix timestamp to a local ISO string (YYYY-MM-DDTHH:MM:SS) */
function toLocalISOString(unixSeconds: number, timeZone: string): string {
  const date = new Date(unixSeconds * 1000);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:${get("second")}`;
}

// ---------------------------------------------------------------------------
// Notion database schema
// ---------------------------------------------------------------------------

const gamesDb = worker.database("games", {
  type: "managed",
  initialTitle: "Chess Games",
  primaryKeyProperty: "Game ID",
  schema: {
    properties: {
      Name: Schema.title(),
      "Game ID": Schema.richText(),
      Date: Schema.date(),
      Result: Schema.select([
        { name: "Win", color: "green" },
        { name: "Loss", color: "red" },
        { name: "Draw", color: "yellow" },
      ]),
      Color: Schema.select([
        { name: "White", color: "default" },
        { name: "Black", color: "gray" },
      ]),
      "My Rating": Schema.number(),
      Opponent: Schema.richText(),
      "Opponent Rating": Schema.number(),
      "Time Control": Schema.select([
        { name: "Bullet", color: "red" },
        { name: "Blitz", color: "orange" },
        { name: "Rapid", color: "blue" },
        { name: "Daily", color: "green" },
      ]),
      "Time Control (Exact)": Schema.select([
        { name: "10 min", color: "blue" },
        { name: "3 min + 2s", color: "orange" },
        { name: "1 min + 1s", color: "red" },
        { name: "1 min", color: "red" },
        { name: "5 min", color: "blue" },
        { name: "2 min + 1s", color: "orange" },
        { name: "0:30", color: "red" },
        { name: "5 min + 2s", color: "blue" },
        { name: "5 min + 5s", color: "blue" },
        { name: "3 min", color: "orange" },
        { name: "0:20 + 1s", color: "red" },
        { name: "10 min + 5s", color: "blue" },
        { name: "3 days/move", color: "green" },
        { name: "15 min + 10s", color: "blue" },
        { name: "2 min + 12s", color: "orange" },
        { name: "10 min + 10s", color: "blue" },
        { name: "1 min + 5s", color: "red" },
        { name: "1 day/move", color: "green" },
        { name: "-", color: "gray" },
      ]),
      Termination: Schema.select([
        { name: "Checkmate", color: "purple" },
        { name: "Resignation", color: "orange" },
        { name: "Timeout", color: "red" },
        { name: "Abandonment", color: "gray" },
        { name: "Stalemate", color: "yellow" },
        { name: "Repetition", color: "yellow" },
        { name: "Draw Agreement", color: "yellow" },
        { name: "Insufficient Material", color: "yellow" },
        { name: "50-Move Rule", color: "yellow" },
        { name: "Timeout vs Insufficient", color: "yellow" },
      ]),
      "Total Moves": Schema.number(),
      Rated: Schema.checkbox(),
      Opening: Schema.richText(),
      "ECO Code": Schema.richText(),
      "Duration (min)": Schema.number(),
      Variant: Schema.select([
        { name: "Standard", color: "default" },
        { name: "Chess960", color: "purple" },
        { name: "Bughouse", color: "orange" },
        { name: "King of the Hill", color: "green" },
        { name: "Three-Check", color: "red" },
        { name: "Crazyhouse", color: "blue" },
      ]),
      Accuracy: Schema.number("percent"),
      Link: Schema.url(),
    },
  },
});

// ---------------------------------------------------------------------------
// Sync state
// ---------------------------------------------------------------------------

interface SyncState {
  /** Index into the archives array (we process newest-first) */
  archiveIndex: number;
  /** All archive URLs, newest first */
  archives: string[];
  /** Unix timestamp of the most recent game we've synced (committed after cycle completes) */
  lastEndTime: number;
  /** Max end_time seen during the current cycle (not yet committed) */
  cycleMaxEndTime: number;
  /** Whether this is a continuation within a cycle (archives already fetched) */
  initialized: boolean;
}

// ---------------------------------------------------------------------------
// Sync definition
// ---------------------------------------------------------------------------

worker.sync("chessGamesSync", {
  database: gamesDb,
  mode: "incremental",
  schedule: "1h",

  execute: async (state: SyncState | undefined) => {
    if (!CHESSCOM_USERNAME) {
      throw new Error(
        "CHESSCOM_USERNAME not set. Run: ntn workers env set CHESSCOM_USERNAME=yourusername"
      );
    }

    // First call of a new cycle: fetch archive list.
    // Also refetch if the previous cycle left archiveIndex at the end,
    // which indicates a completed cycle waiting to restart.
    if (
      !state ||
      !state.initialized ||
      state.archiveIndex >= state.archives.length
    ) {
      const archives = await getArchives();
      // Reverse so we process newest month first
      archives.reverse();

      state = {
        archiveIndex: 0,
        archives,
        lastEndTime: state?.lastEndTime ?? 0,
        cycleMaxEndTime: state?.lastEndTime ?? 0,
        initialized: true,
      };
    }

    const { archives, archiveIndex, lastEndTime } = state;

    // No more archives to process
    if (archiveIndex >= archives.length) {
      return { changes: [], hasMore: false, nextState: state };
    }

    const archiveUrl = archives[archiveIndex];
    const games = await getMonthGames(archiveUrl);

    // Filter to only games newer than our last sync point
    const newGames = games
      .filter((g) => g.end_time > lastEndTime)
      .sort((a, b) => a.end_time - b.end_time);

    const changes = newGames.map((game) => {
      const color = getPlayerColor(game);
      const opponent = getOpponent(game);
      const myRating = game[color].rating;
      const accuracy = game.accuracies?.[color];
      const date = toLocalISOString(game.end_time, TIMEZONE);
      const moves = extractMoves(game.pgn);
      const opponentProfileUrl = `https://www.chess.com/member/${opponent.username}`;

      return {
        type: "upsert" as const,
        key: game.uuid,
        icon: Builder.emojiIcon(getResult(game) === "Win" ? "♟️" : getResult(game) === "Loss" ? "💀" : "🤝"),
        pageContentMarkdown: `## Moves\n\n${moves}`,
        properties: {
          Name: Builder.title(
            `${game.white.username} vs ${game.black.username}`
          ),
          "Game ID": Builder.richText(game.uuid),
          Date: Builder.dateTime(date, TIMEZONE),
          Result: Builder.select(getResult(game)),
          Color: Builder.select(color === "white" ? "White" : "Black"),
          "My Rating": Builder.number(myRating),
          Opponent: Builder.link(opponent.username, opponentProfileUrl),
          "Opponent Rating": Builder.number(opponent.rating),
          "Time Control": Builder.select(getTimeControlLabel(game)),
          "Time Control (Exact)": Builder.select(formatTimeControl(game.time_control)),
          Termination: Builder.select(getTermination(game)),
          "Total Moves": Builder.number(countMoves(game.pgn)),
          Rated: Builder.checkbox(game.rated),
          Opening: Builder.richText(getOpeningName(game.pgn)),
          ...(getEcoCode(game.pgn) ? { "ECO Code": Builder.richText(getEcoCode(game.pgn)) } : {}),
          ...(getGameDurationMinutes(game.pgn) != null ? { "Duration (min)": Builder.number(getGameDurationMinutes(game.pgn)!) } : {}),
          Variant: Builder.select(getVariantLabel(game.rules)),
          ...(accuracy != null ? { Accuracy: Builder.number(accuracy / 100) } : {}),
          Link: Builder.url(game.url),
        },
      };
    });

    // Track the max timestamp seen during this cycle (don't commit to lastEndTime yet)
    const newestTime = newGames.length > 0
      ? Math.max(...newGames.map((g) => g.end_time))
      : 0;
    const updatedCycleMax = Math.max(state.cycleMaxEndTime, newestTime);

    // If this month had no new games and we're past the first (newest) month,
    // stop pagination — older months won't have new games either
    const noNewGamesInOlderMonth = newGames.length === 0 && archiveIndex > 0;

    const nextArchiveIndex = archiveIndex + 1;
    const moreArchives = nextArchiveIndex < archives.length && !noNewGamesInOlderMonth;

    return {
      changes,
      hasMore: moreArchives,
      nextState: {
        archiveIndex: nextArchiveIndex,
        archives,
        // Only commit cycleMaxEndTime to lastEndTime when the cycle is done
        lastEndTime: moreArchives ? lastEndTime : updatedCycleMax,
        cycleMaxEndTime: updatedCycleMax,
        // Reset `initialized` at cycle end so the next scheduled run
        // re-fetches the archive list and starts a fresh cycle.
        initialized: moreArchives,
      },
    };
  },
});

export default worker;
