const RESULT_TOKENS = new Set(["1-0", "0-1", "1/2-1/2", "*"]);

/** Strip clock annotations from PGN and return one line per move number. */
export function extractMoves(pgn: string): string {
  const lines = pgn.split("\n");
  const moveLines = lines.filter((line) => !line.startsWith("[") && line.trim());
  const clean = moveLines
    .join(" ")
    .replace(/\s*\{[^}]*\}\s*/g, " ")
    .replace(/\$\d+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const tokens = clean.split(" ").filter(Boolean);
  const moves: Array<{ moveNumber: string; white?: string; black?: string }> = [];
  let currentMove: { moveNumber: string; white?: string; black?: string } | null = null;
  let expectedColor: "white" | "black" | null = null;

  const flushCurrentMove = () => {
    if (!currentMove || (!currentMove.white && !currentMove.black)) return;
    moves.push(currentMove);
  };

  for (const token of tokens) {
    if (RESULT_TOKENS.has(token)) {
      continue;
    }

    const whiteMoveNumber = token.match(/^(\d+)\.$/);
    if (whiteMoveNumber) {
      flushCurrentMove();
      currentMove = { moveNumber: whiteMoveNumber[1] };
      expectedColor = "white";
      continue;
    }

    const blackMoveNumber = token.match(/^(\d+)\.\.\.$/);
    if (blackMoveNumber) {
      if (!currentMove || currentMove.moveNumber !== blackMoveNumber[1]) {
        flushCurrentMove();
        currentMove = { moveNumber: blackMoveNumber[1] };
      }
      expectedColor = "black";
      continue;
    }

    if (!currentMove) {
      continue;
    }

    if (expectedColor === "white" && !currentMove.white) {
      currentMove.white = token;
      expectedColor = null;
      continue;
    }

    if (!currentMove.black) {
      currentMove.black = token;
      expectedColor = null;
    }
  }

  flushCurrentMove();

  return moves
    .map(({ moveNumber, white, black }) =>
      `${moveNumber}. ${white ?? ""}${black ? ` .. ${black}` : ""}`.trim()
    )
    .join("\n");
}
