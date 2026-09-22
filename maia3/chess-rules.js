(() => {
  if (globalThis.__CMH_CHESS_RULES__) return;

  function square(file, rank) {
    return (rank - 1) * 8 + file;
  }

  function coords(index) {
    return { file: index & 7, rank: (index >> 3) + 1 };
  }

  function sideOf(piece) {
    return piece && piece === piece.toUpperCase() ? "w" : "b";
  }

  function colorPiece(piece, side) {
    return side === "w" ? piece.toUpperCase() : piece.toLowerCase();
  }

  function inside(file, rank) {
    return file >= 0 && file < 8 && rank >= 1 && rank <= 8;
  }

  function isEnemy(target, side) {
    return target && sideOf(target) !== side;
  }

  function pushMove(moves, from, to, promotion = null, castle = false, enPassant = false) {
    moves.push({ from, to, promotion, castle, enPassant });
  }

  function attacked(position, target, bySide) {
    const t = coords(target);
    const pawn = colorPiece("P", bySide);
    const pawnRank = bySide === "w" ? t.rank - 1 : t.rank + 1;
    for (const file of [t.file - 1, t.file + 1]) {
      if (inside(file, pawnRank) && position[square(file, pawnRank)] === pawn) return true;
    }

    const knight = colorPiece("N", bySide);
    for (const [df, dr] of [[1,2],[2,1],[-1,2],[-2,1],[1,-2],[2,-1],[-1,-2],[-2,-1]]) {
      const file = t.file + df;
      const rank = t.rank + dr;
      if (inside(file, rank) && position[square(file, rank)] === knight) return true;
    }

    const king = colorPiece("K", bySide);
    for (const df of [-1,0,1]) {
      for (const dr of [-1,0,1]) {
        if (!df && !dr) continue;
        const file = t.file + df;
        const rank = t.rank + dr;
        if (inside(file, rank) && position[square(file, rank)] === king) return true;
      }
    }

    const rook = colorPiece("R", bySide);
    const bishop = colorPiece("B", bySide);
    const queen = colorPiece("Q", bySide);
    for (const [df, dr, a, q] of [
      [1,0,rook,queen],[-1,0,rook,queen],[0,1,rook,queen],[0,-1,rook,queen],
      [1,1,bishop,queen],[1,-1,bishop,queen],[-1,1,bishop,queen],[-1,-1,bishop,queen]
    ]) {
      let file = t.file + df;
      let rank = t.rank + dr;
      while (inside(file, rank)) {
        const piece = position[square(file, rank)];
        if (piece) {
          if (piece === a || piece === q) return true;
          break;
        }
        file += df;
        rank += dr;
      }
    }

    return false;
  }

  function kingInCheck(position, side) {
    const king = colorPiece("K", side);
    const index = position.indexOf(king);
    return index >= 0 && attacked(position, index, side === "w" ? "b" : "w");
  }

  function applyMove(position, move) {
    const next = position.slice();
    const piece = next[move.from];
    next[move.from] = null;
    next[move.to] = move.promotion ? colorPiece(move.promotion, sideOf(piece)) : piece;

    if (move.enPassant) {
      const capturedPawn = move.to + (piece === "P" ? -8 : 8);
      next[capturedPawn] = null;
    }

    if (move.castle) {
      const c = coords(move.to);
      const rookFrom = c.file === 6 ? square(7, c.rank) : square(0, c.rank);
      const rookTo = c.file === 6 ? square(5, c.rank) : square(3, c.rank);
      next[rookTo] = next[rookFrom];
      next[rookFrom] = null;
    }

    return next;
  }

  function addPawnMoves(position, moves, from, side, epSquare = null) {
    const { file, rank } = coords(from);
    const dir = side === "w" ? 1 : -1;
    const lastRank = side === "w" ? 8 : 1;
    const startRank = side === "w" ? 2 : 7;
    const oneRank = rank + dir;

    if (inside(file, oneRank)) {
      const one = square(file, oneRank);
      if (!position[one]) {
        if (oneRank === lastRank) {
          for (const promotion of ["Q","R","B","N"]) pushMove(moves, from, one, promotion);
        } else {
          pushMove(moves, from, one);
          const twoRank = rank + 2 * dir;
          const two = square(file, twoRank);
          if (rank === startRank && !position[two]) pushMove(moves, from, two);
        }
      }
    }

    for (const df of [-1,1]) {
      const captureFile = file + df;
      if (!inside(captureFile, oneRank)) continue;
      const to = square(captureFile, oneRank);
      if (position[to] && isEnemy(position[to], side) && position[to].toUpperCase() !== "K") {
        if (oneRank === lastRank) {
          for (const promotion of ["Q","R","B","N"]) pushMove(moves, from, to, promotion);
        } else {
          pushMove(moves, from, to);
        }
      } else if (epSquare === to && !position[to]) {
        const capturedPawnSquare = to + (side === "w" ? -8 : 8);
        const enemyPawn = colorPiece("P", side === "w" ? "b" : "w");
        if (position[capturedPawnSquare] === enemyPawn) {
          pushMove(moves, from, to, null, false, true);
        }
      }
    }
  }

  function generatePseudo(position, side, castlingRights = 15, epSquare = null) {
    const moves = [];

    for (let from = 0; from < 64; from++) {
      const piece = position[from];
      if (!piece || sideOf(piece) !== side) continue;
      const type = piece.toUpperCase();
      const { file, rank } = coords(from);

      if (type === "P") {
        addPawnMoves(position, moves, from, side, epSquare);
        continue;
      }

      if (type === "N") {
        for (const [df, dr] of [[1,2],[2,1],[-1,2],[-2,1],[1,-2],[2,-1],[-1,-2],[-2,-1]]) {
          const f = file + df;
          const r = rank + dr;
          if (!inside(f, r)) continue;
          const to = square(f, r);
          if (!position[to] || isEnemy(position[to], side)) {
            if (!position[to] || position[to].toUpperCase() !== "K") pushMove(moves, from, to);
          }
        }
        continue;
      }

      if (type === "K") {
        for (const df of [-1,0,1]) {
          for (const dr of [-1,0,1]) {
            if (!df && !dr) continue;
            const f = file + df;
            const r = rank + dr;
            if (!inside(f, r)) continue;
            const to = square(f, r);
            if (!position[to] || isEnemy(position[to], side)) {
              if (!position[to] || position[to].toUpperCase() !== "K") pushMove(moves, from, to);
            }
          }
        }

        const enemy = side === "w" ? "b" : "w";
        const backRank = side === "w" ? 1 : 8;
        if (rank === backRank && !kingInCheck(position, side)) {
          const kingSideRight = side === "w" ? 1 : 4;
          const queenSideRight = side === "w" ? 2 : 8;
          const kingSideRook = position[square(7, backRank)] === colorPiece("R", side);
          if ((castlingRights & kingSideRight) && kingSideRook &&
              !position[square(5, backRank)] && !position[square(6, backRank)] &&
              !attacked(position, square(5, backRank), enemy) && !attacked(position, square(6, backRank), enemy)) {
            pushMove(moves, from, square(6, backRank), null, true);
          }

          const queenSideRook = position[square(0, backRank)] === colorPiece("R", side);
          if ((castlingRights & queenSideRight) && queenSideRook &&
              !position[square(1, backRank)] && !position[square(2, backRank)] && !position[square(3, backRank)] &&
              !attacked(position, square(3, backRank), enemy) && !attacked(position, square(2, backRank), enemy)) {
            pushMove(moves, from, square(2, backRank), null, true);
          }
        }
        continue;
      }

      const directions = type === "B"
        ? [[1,1],[1,-1],[-1,1],[-1,-1]]
        : type === "R"
          ? [[1,0],[-1,0],[0,1],[0,-1]]
          : [[1,1],[1,-1],[-1,1],[-1,-1],[1,0],[-1,0],[0,1],[0,-1]];

      for (const [df, dr] of directions) {
        let f = file + df;
        let r = rank + dr;
        while (inside(f, r)) {
          const to = square(f, r);
          if (!position[to]) {
            pushMove(moves, from, to);
          } else {
            if (isEnemy(position[to], side) && position[to].toUpperCase() !== "K") pushMove(moves, from, to);
            break;
          }
          f += df;
          r += dr;
        }
      }
    }

    return moves;
  }

  function legalMoves(position, side, castlingRights = 15, epSquare = null) {
    const result = [];
    for (const move of generatePseudo(position, side, castlingRights, epSquare)) {
      const next = applyMove(position, move);
      if (!kingInCheck(next, side)) result.push(move);
    }
    return result;
  }

  function getGameState(position, side, castlingRights = 15, epSquare = null) {
    const moves = legalMoves(position, side, castlingRights, epSquare);
    if (moves.length) return "playing";
    return kingInCheck(position, side) ? "checkmate" : "stalemate";
  }

  globalThis.__CMH_CHESS_RULES__ = {
    legalMoves,
    getGameState
  };
})();