import test from "node:test";
import assert from "node:assert/strict";

import { extractMoves } from "../src/pgn.ts";

test("extractMoves keeps white and black SAN on the same numbered line", () => {
  const pgn = `
[Event "Live Chess"]

1. e4 1... e5 2. Nf3 2... Nc6 3. Bc4 3... Nf6 1-0
  `;

  assert.equal(
    extractMoves(pgn),
    ["1. e4 .. e5", "2. Nf3 .. Nc6", "3. Bc4 .. Nf6"].join("\n")
  );
});

test("extractMoves handles clock annotations and PGN without explicit black move numbers", () => {
  const pgn = `
[Event "Live Chess"]

1. e4 {[%clk 0:10:00]} e5 {[%clk 0:09:58]} 2. Nf3 Nc6 3. Bb5 a6 *
  `;

  assert.equal(
    extractMoves(pgn),
    ["1. e4 .. e5", "2. Nf3 .. Nc6", "3. Bb5 .. a6"].join("\n")
  );
});
