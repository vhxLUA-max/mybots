const PIECE_MAP = {p:1,n:2,b:3,r:4,q:5,k:6};

function mirrorSquare(square) {
  return square[0] + (9 - Number(square[1]));
}

function mirrorMove(uci) {
  const promo = uci.length > 4 ? uci.slice(4) : "";
  return mirrorSquare(uci.slice(0, 2)) + mirrorSquare(uci.slice(2, 4)) + promo;
}

function tokenizeBoard(fen) {
  const tokens = new Float32Array(64 * 12);
  const parts = fen.split(" ");
  const turn = parts[1];
  const ranks = parts[0].split("/");
  const boardRanks = turn === "w" ? ranks : [...ranks].reverse();

  for (let rankIdx = 0; rankIdx < 8; rankIdx++) {
    const rank = boardRanks[7 - rankIdx];
    let fileIdx = 0;

    for (const ch of rank) {
      if (ch >= "1" && ch <= "8") {
        fileIdx += Number(ch);
        continue;
      }

      const square = rankIdx * 8 + fileIdx;
      const isWhite = ch === ch.toUpperCase();
      const isOurPiece = turn === "w" ? isWhite : !isWhite;
      const pieceType = PIECE_MAP[ch.toLowerCase()];
      if (!pieceType) throw new Error("Unknown piece in FEN.");

      const tokenIdx = isOurPiece ? pieceType - 1 : pieceType + 5;
      tokens[square * 12 + tokenIdx] = 1;
      fileIdx++;
    }

    if (fileIdx !== 8) throw new Error("Invalid FEN rank.");
  }

  return tokens;
}

function getHistoricalTokens(history, cfg = {}) {
  const H = cfg.history ?? 8;
  const feats = H * 12 + 1;
  if (!history.length || history[0].length !== 768) throw new Error("Invalid Maia board history.");

  const out = new Float32Array(64 * feats);
  const padded = [];
  while (padded.length < H) padded.push(history[0]);
  for (const h of history) padded.push(h);

  const sliced = padded.slice(padded.length - H);

  for (let sq = 0; sq < 64; sq++) {
    for (let h = 0; h < H; h++) {
      const src = sliced[h];
      for (let f = 0; f < 12; f++) {
        out[sq * feats + h * 12 + f] = src[sq * 12 + f];
      }
    }
    out[sq * feats + H * 12] = 0;
  }

  return out;
}

function indexToUci(index, allMoves, turn) {
  if (index < 0 || index >= allMoves.length) throw new Error("Maia move index out of range.");
  let move = allMoves[index];
  if (turn === "b") move = mirrorMove(move);
  return move;
}
