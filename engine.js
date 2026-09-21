(() => {
  if (window.__CMH_ENGINE__) return;

  const VALUES = { P: 100, N: 320, B: 330, R: 500, Q: 900, K: 20000 };
  const PST = {
    P: [0,0,0,0,0,0,0,0,5,10,10,-20,-20,10,10,5,5,-5,-10,0,0,-10,-5,5,0,0,0,20,20,0,0,0,5,5,10,25,25,10,5,5,10,10,20,30,30,20,10,10,50,50,50,50,50,50,50,50,0,0,0,0,0,0,0,0],
    N: [-50,-40,-30,-30,-30,-30,-40,-50,-40,-20,0,5,5,0,-20,-40,-30,5,10,15,15,10,5,-30,-30,0,15,20,20,15,0,-30,-30,5,20,25,25,20,5,-30,-30,0,15,20,20,15,0,-30,-40,-20,0,0,0,0,-20,-40,-50,-40,-30,-30,-30,-30,-40,-50],
    B: [-20,-10,-10,-10,-10,-10,-10,-20,-10,5,0,0,0,0,5,-10,-10,10,10,10,10,10,10,10,-10,0,10,10,10,10,0,-10,-10,5,5,10,10,5,5,-10,-10,0,10,10,10,10,0,-10,-10,0,0,0,0,0,0,-10,-20,-10,-10,-10,-10,-10,-10,-20],
    R: [0,0,5,10,10,5,0,0,-5,0,0,0,0,0,0,-5,-5,0,0,0,0,0,0,-5,-5,0,0,0,0,0,0,-5,5,0,0,0,0,0,0,5,10,10,10,10,10,10,10,10,5,10,10,10,10,10,10,5,0,0,0,0,0,0,0,0],
    Q: [-20,-10,-10,0,0,-10,-10,-20,-10,0,5,0,0,0,0,-10,-10,5,5,5,5,5,5,-10,0,0,5,5,5,5,0,0,-5,0,5,5,5,5,0,-5,-10,0,5,5,5,5,0,-10,-20,-10,-10,0,0,-10,-10,-20],
    K: [-30,-40,-40,-50,-50,-40,-40,-30,-30,-40,-40,-50,-50,-40,-40,-30,-20,-30,-30,-40,-40,-30,-30,-20,-10,-20,-20,-20,-20,-20,-20,-10,20,20,0,0,0,0,20,20,20,30,10,0,0,10,30,20,20,30,20,0,0,20,30,20,20,0,0,0,0,0,0,20]
  };

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

  function pushMove(moves, from, to, promotion = null, castle = false) {
    moves.push({ from, to, promotion, castle });
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

    if (move.castle) {
      const c = coords(move.to);
      const rookFrom = c.file === 6 ? square(7, c.rank) : square(0, c.rank);
      const rookTo = c.file === 6 ? square(5, c.rank) : square(3, c.rank);
      next[rookTo] = next[rookFrom];
      next[rookFrom] = null;
    }

    return next;
  }

  function addPawnMoves(position, moves, from, side) {
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
      }
    }
  }

  function generatePseudo(position, side) {
    const moves = [];
    for (let from = 0; from < 64; from++) {
      const piece = position[from];
      if (!piece || sideOf(piece) !== side) continue;
      const type = piece.toUpperCase();
      const { file, rank } = coords(from);

      if (type === "P") {
        addPawnMoves(position, moves, from, side);
        continue;
      }

      if (type === "N") {
        for (const [df, dr] of [[1,2],[2,1],[-1,2],[-2,1],[1,-2],[2,-1],[-1,-2],[-2,-1]]) {
          const f = file + df;
          const r = rank + dr;
          if (!inside(f, r)) continue;
          const to = square(f, r);
          if (!position[to] || (isEnemy(position[to], side) && position[to].toUpperCase() !== "K")) pushMove(moves, from, to);
        }
        continue;
      }

      if (type === "K") {
        for (const [df, dr] of [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]]) {
          const f = file + df;
          const r = rank + dr;
          if (!inside(f, r)) continue;
          const to = square(f, r);
          if (!position[to] || (isEnemy(position[to], side) && position[to].toUpperCase() !== "K")) pushMove(moves, from, to);
        }

        const backRank = side === "w" ? 1 : 8;
        if (rank === backRank && file === 4 && !kingInCheck(position, side)) {
          const enemy = side === "w" ? "b" : "w";
          const kingSideRook = position[square(7, backRank)] === colorPiece("R", side);
          if (kingSideRook && !position[square(5, backRank)] && !position[square(6, backRank)] &&
              !attacked(position, square(5, backRank), enemy) && !attacked(position, square(6, backRank), enemy)) {
            pushMove(moves, from, square(6, backRank), null, true);
          }

          const queenSideRook = position[square(0, backRank)] === colorPiece("R", side);
          if (queenSideRook && !position[square(1, backRank)] && !position[square(2, backRank)] && !position[square(3, backRank)] &&
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
          if (type !== "B" && type !== "R" && type !== "Q") break;
        }
      }
    }
    return moves;
  }

  function legalMoves(position, side) {
    const result = [];
    for (const move of generatePseudo(position, side)) {
      const next = applyMove(position, move);
      if (!kingInCheck(next, side)) result.push(move);
    }
    return result;
  }

  function evaluate(position) {
    let score = 0;
    let whiteBishops = 0;
    let blackBishops = 0;

    for (let i = 0; i < 64; i++) {
      const piece = position[i];
      if (!piece) continue;
      const type = piece.toUpperCase();
      const value = VALUES[type];
      const tableIndex = piece === piece.toUpperCase() ? i : 56 - i;
      const positional = PST[type][tableIndex] || 0;
      if (piece === piece.toUpperCase()) {
        score += value + positional;
        if (type === "B") whiteBishops++;
      } else {
        score -= value + positional;
        if (type === "B") blackBishops++;
      }
    }

    if (whiteBishops >= 2) score += 30;
    if (blackBishops >= 2) score -= 30;

    return score;
  }

  function moveScore(position, move) {
    const captured = position[move.to];
    let score = 0;
    if (captured) score += VALUES[captured.toUpperCase()] * 10 - VALUES[position[move.from].toUpperCase()];
    if (move.promotion) score += VALUES[move.promotion] + 800;
    if (move.castle) score += 60;
    return score;
  }

  class Engine {
    constructor() {
      this.nodes = 0;
      this.nodeLimit = 40000;
      this.table = new Map();
      this.stop = false;
    }

    orderMoves(position, moves) {
      return moves.sort((a, b) => moveScore(position, b) - moveScore(position, a));
    }

    quiescence(position, side, alpha, beta) {
      if (++this.nodes >= this.nodeLimit) {
        this.stop = true;
        return side === "w" ? evaluate(position) : -evaluate(position);
      }

      const inCheck = kingInCheck(position, side);
      if (inCheck) {
        const evasions = this.orderMoves(position, legalMoves(position, side));
        if (!evasions.length) return -999999;
        let best = -999999;
        for (const move of evasions) {
          const score = -this.quiescence(applyMove(position, move), side === "w" ? "b" : "w", -beta, -alpha);
          if (this.stop) return score;
          if (score > best) best = score;
          if (score > alpha) alpha = score;
          if (alpha >= beta) break;
        }
        return best;
      }

      const stand = side === "w" ? evaluate(position) : -evaluate(position);
      if (stand >= beta) return stand;
      if (stand > alpha) alpha = stand;

      const captures = this.orderMoves(position, legalMoves(position, side).filter(move => position[move.to] || move.promotion));
      for (const move of captures) {
        const score = -this.quiescence(applyMove(position, move), side === "w" ? "b" : "w", -beta, -alpha);
        if (this.stop) return score;
        if (score >= beta) return score;
        if (score > alpha) alpha = score;
      }
      return alpha;
    }

    negamax(position, side, depth, alpha, beta) {
      if (++this.nodes >= this.nodeLimit) {
        this.stop = true;
        return side === "w" ? evaluate(position) : -evaluate(position);
      }

      const key = position.join("") + side + depth;
      const cached = this.table.get(key);
      if (cached !== undefined) return cached;

      const moves = this.orderMoves(position, legalMoves(position, side));
      if (!moves.length) {
        if (kingInCheck(position, side)) return -999999 + (5 - depth);
        return 0;
      }

      if (depth === 0) return this.quiescence(position, side, alpha, beta);

      let best = -999999;
      const nextSide = side === "w" ? "b" : "w";
      for (const move of moves) {
        const score = -this.negamax(applyMove(position, move), nextSide, depth - 1, -beta, -alpha);
        if (this.stop) return score;
        if (score > best) best = score;
        if (score > alpha) alpha = score;
        if (alpha >= beta) break;
      }

      this.table.set(key, best);
      return best;
    }

    search(position, side, maxDepth = 4, nodeLimit = 40000, alternativeCount = 4) {
      this.nodes = 0;
      this.nodeLimit = nodeLimit;
      this.table.clear();
      this.stop = false;

      let bestMove = null;
      let bestScore = -999999;
      let bestMoves = [];
      let reachedDepth = 0;

      for (let depth = 1; depth <= maxDepth; depth++) {
        const moves = this.orderMoves(position, legalMoves(position, side));
        if (!moves.length) break;

        const scoredMoves = [];
        let localBest = moves[0];
        let localScore = -999999;
        const nextSide = side === "w" ? "b" : "w";

        for (const move of moves) {
          const score = -this.negamax(applyMove(position, move), nextSide, depth - 1, -1000000, 1000000);
          if (this.stop) break;

          scoredMoves.push({ move, score });
          if (score > localScore) {
            localScore = score;
            localBest = move;
          }
        }

        if (this.stop) break;

        scoredMoves.sort((a, b) => b.score - a.score);
        bestMoves = scoredMoves;
        bestMove = localBest;
        bestScore = localScore;
        reachedDepth = depth;
        this.table.clear();
      }

      if (!bestMove) return null;

      const alternatives = bestMoves
        .slice(0, Math.max(1, alternativeCount))
        .map(entry => ({
          from: entry.move.from,
          to: entry.move.to,
          promotion: entry.move.promotion,
          score: entry.score
        }));

      return {
        from: bestMove.from,
        to: bestMove.to,
        promotion: bestMove.promotion,
        score: bestScore,
        depth: reachedDepth,
        nodes: this.nodes,
        alternatives
      };
    }
  }

  window.__CMH_ENGINE__ = new Engine();
})();
