(() => {
  if (window.__CMH_ENGINE__) return;

  const VALUES = { P: 100, N: 320, B: 330, R: 500, Q: 900, K: 20000 };
  const PST = {
    P: [0,0,0,0,0,0,0,0,5,10,10,-20,-20,10,10,5,5,-5,-10,0,0,-10,-5,5,0,0,0,20,20,0,0,0,5,5,10,25,25,10,5,5,10,10,20,30,30,20,10,10,50,50,50,50,50,50,50,50,0,0,0,0,0,0,0,0],
    N: [-50,-40,-30,-30,-30,-30,-40,-50,-40,-20,0,5,5,0,-20,-40,-30,5,10,15,15,10,5,-30,-30,0,15,20,20,15,0,-30,-30,5,20,25,25,20,5,-30,-30,0,15,20,20,15,0,-30,-40,-20,0,0,0,0,-20,-40,-50,-40,-30,-30,-40,-50],
    B: [-20,-10,-10,-10,-10,-10,-10,-20,-10,5,0,0,0,0,5,-10,-10,10,10,10,10,10,10,10,-10,0,10,10,10,10,0,-10,-10,5,5,10,10,5,5,-10,-10,0,10,10,10,10,0,-10,-10,0,0,0,0,0,0,-10,-20,-10,-10,-10,-10,-10,-10,-20],
    R: [0,0,5,10,10,5,0,0,-5,0,0,0,0,0,0,-5,-5,0,0,0,0,0,0,-5,-5,0,0,0,0,0,0,-5,5,0,0,0,0,0,0,5,10,10,10,10,10,10,10,10,5,10,10,10,10,10,10,5,0,0,0,0,0,0,0,0],
    Q: [-20,-10,-10,0,0,-10,-10,-20,-10,0,5,0,0,0,0,-10,-10,5,5,5,5,5,5,-10,0,0,5,5,5,5,0,0,-5,0,5,5,5,5,0,-5,-10,0,5,5,5,5,0,-10,-20,-10,-10,0,0,-10,-10,-20],
    K: [-30,-40,-40,-50,-50,-40,-40,-30,-30,-40,-40,-50,-50,-40,-40,-30,-20,-30,-30,-40,-40,-30,-10,-20,-10,-20,-20,-20,-20,-20,-20,-10,20,20,0,0,0,0,20,20,20,30,10,0,0,10,30,20,20,30,20,0,0,20,30,20,20,0,0,0,0,0,0,20]
  };
  const MATE_SCORE = 999999;
  const SEARCH_INF = 10000000;
  const MATE_THRESHOLD = MATE_SCORE - 10000;


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

  function nextStateMetadata(position, side, castlingRights, epSquare, move) {
    let nextCastlingRights = castlingRights;
    const piece = position[move.from];
    const captured = move.enPassant ? null : position[move.to];

    if (piece === "K") nextCastlingRights &= ~3;
    if (piece === "k") nextCastlingRights &= ~12;
    if (piece === "R") {
      if (move.from === square(7, 1)) nextCastlingRights &= ~1;
      if (move.from === square(0, 1)) nextCastlingRights &= ~2;
    }
    if (piece === "r") {
      if (move.from === square(7, 8)) nextCastlingRights &= ~4;
      if (move.from === square(0, 8)) nextCastlingRights &= ~8;
    }
    if (captured === "R") {
      if (move.to === square(7, 1)) nextCastlingRights &= ~1;
      if (move.to === square(0, 1)) nextCastlingRights &= ~2;
    }
    if (captured === "r") {
      if (move.to === square(7, 8)) nextCastlingRights &= ~4;
      if (move.to === square(0, 8)) nextCastlingRights &= ~8;
    }

    let nextEpSquare = null;
    if (piece?.toUpperCase() === "P" && Math.abs(move.to - move.from) === 16) {
      nextEpSquare = (move.from + move.to) >> 1;
    }

    return {
      castlingRights: nextCastlingRights,
      epSquare: nextEpSquare
    };
  }

  function stateKey(position, side, castlingRights, epSquare) {
    return position.join("") + "|" + side + "|" + castlingRights + "|" + (epSquare ?? -1);
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

  function pawnOnFile(position, side, file) {
    if (file < 0 || file > 7) return false;
    const pawn = colorPiece("P", side);
    for (let rank = 1; rank <= 8; rank++) {
      if (position[square(file, rank)] === pawn) return true;
    }
    return false;
  }

  function anyPawnOnFile(position, file) {
    return pawnOnFile(position, "w", file) || pawnOnFile(position, "b", file);
  }

  function nonPawnMaterial(position) {
    let total = 0;
    for (const piece of position) {
      if (!piece) continue;
      if (piece.toUpperCase() !== "P" && piece.toUpperCase() !== "K") {
        total += VALUES[piece.toUpperCase()] || 0;
      }
    }
    return total;
  }

  function mobility(position, side) {
    let total = 0;
    const knight = colorPiece("N", side);
    const bishop = colorPiece("B", side);
    const rook = colorPiece("R", side);
    const queen = colorPiece("Q", side);

    for (let from = 0; from < 64; from++) {
      const piece = position[from];
      if (piece !== knight && piece !== bishop && piece !== rook && piece !== queen) continue;
      const {file, rank} = coords(from);
      const type = piece.toUpperCase();
      const directions = type === "N"
        ? [[1,2],[2,1],[-1,2],[-2,1],[1,-2],[2,-1],[-1,-2],[-2,-1]]
        : type === "B"
          ? [[1,1],[1,-1],[-1,1],[-1,-1]]
          : type === "R"
            ? [[1,0],[-1,0],[0,1],[0,-1]]
            : [[1,1],[1,-1],[-1,1],[-1,-1],[1,0],[-1,0],[0,1],[0,-1]];

      for (const [df, dr] of directions) {
        let f = file + df;
        let r = rank + dr;
        while (inside(f, r)) {
          const target = position[square(f, r)];
          if (!target) {
            total++;
          } else {
            if (isEnemy(target, side) && target.toUpperCase() !== "K") total++;
            break;
          }
          if (type === "N") break;
          f += df;
          r += dr;
        }
      }
    }

    return total;
  }

  function pieceAttacksSquare(position, from, target, side) {
    const piece = position[from];
    if (!piece || sideOf(piece) !== side) return false;

    const source = coords(from);
    const destination = coords(target);
    const df = destination.file - source.file;
    const dr = destination.rank - source.rank;
    const type = piece.toUpperCase();

    if (type === "P") return dr === (side === "w" ? 1 : -1) && Math.abs(df) === 1;
    if (type === "N") return (Math.abs(df) === 1 && Math.abs(dr) === 2) || (Math.abs(df) === 2 && Math.abs(dr) === 1);
    if (type === "K") return Math.max(Math.abs(df), Math.abs(dr)) === 1;

    const diagonal = Math.abs(df) === Math.abs(dr);
    const straight = df === 0 || dr === 0;
    if ((type === "B" && !diagonal) || (type === "R" && !straight) || (type === "Q" && !diagonal && !straight)) {
      return false;
    }

    const stepFile = Math.sign(df);
    const stepRank = Math.sign(dr);
    let file = source.file + stepFile;
    let rank = source.rank + stepRank;
    while (file !== destination.file || rank !== destination.rank) {
      if (position[square(file, rank)]) return false;
      file += stepFile;
      rank += stepRank;
    }
    return true;
  }

  function findLeastValuableAttacker(position, target, side) {
    let bestFrom = null;
    let bestValue = Infinity;

    for (let from = 0; from < 64; from++) {
      const piece = position[from];
      if (!piece || sideOf(piece) !== side || piece.toUpperCase() === "K") continue;
      const value = VALUES[piece.toUpperCase()] || 0;
      if (value >= bestValue) continue;
      if (!pieceAttacksSquare(position, from, target, side)) continue;
      bestFrom = from;
      bestValue = value;
    }

    return bestFrom;
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

    const totalNonPawnMaterial = nonPawnMaterial(position);
    const endgameFactor = Math.max(0, Math.min(1, (5000 - totalNonPawnMaterial) / 3000));
    const mobilityDelta = mobility(position, "w") - mobility(position, "b");
    score += mobilityDelta * 3;

    for (const side of ["w", "b"]) {
      const sign = side === "w" ? 1 : -1;
      const pawn = colorPiece("P", side);
      const enemyPawn = colorPiece("P", side === "w" ? "b" : "w");

      for (let file = 0; file < 8; file++) {
        let pawnCount = 0;
        for (let rank = 1; rank <= 8; rank++) {
          if (position[square(file, rank)] === pawn) pawnCount++;
        }

        if (pawnCount > 1) score -= sign * 16 * (pawnCount - 1);
        if (pawnCount && !pawnOnFile(position, side, file - 1) && !pawnOnFile(position, side, file + 1)) {
          score -= sign * 12;
        }
      }

      for (let i = 0; i < 64; i++) {
        if (position[i] !== pawn) continue;
        const { file, rank } = coords(i);
        let passed = true;

        for (let otherFile = file - 1; otherFile <= file + 1; otherFile++) {
          if (otherFile < 0 || otherFile > 7) continue;
          if (side === "w") {
            for (let enemyRank = rank + 1; enemyRank <= 8; enemyRank++) {
              if (position[square(otherFile, enemyRank)] === enemyPawn) passed = false;
            }
          } else {
            for (let enemyRank = rank - 1; enemyRank >= 1; enemyRank--) {
              if (position[square(otherFile, enemyRank)] === enemyPawn) passed = false;
            }
          }
        }

        if (passed) {
          const advance = side === "w" ? rank : 9 - rank;
          score += sign * (10 + advance * 3 + Math.round(endgameFactor * (12 + advance * 3)));
        }
      }
    }

    for (const side of ["w", "b"]) {
      const sign = side === "w" ? 1 : -1;
      const rook = colorPiece("R", side);
      const pawn = colorPiece("P", side);
      const king = colorPiece("K", side);

      for (let i = 0; i < 64; i++) {
        if (position[i] !== rook) continue;
        const file = i & 7;
        if (!anyPawnOnFile(position, file)) score += sign * 20;
        else if (!pawnOnFile(position, side, file)) score += sign * 10;
      }

      const kingIndex = position.indexOf(king);
      if (kingIndex >= 0) {
        const { file, rank } = coords(kingIndex);
        const shieldRank = side === "w" ? rank + 1 : rank - 1;
        if (shieldRank >= 1 && shieldRank <= 8) {
          for (let f = Math.max(0, file - 1); f <= Math.min(7, file + 1); f++) {
            if (position[square(f, shieldRank)] === pawn) score += sign * 8;
          }
        }

        if (endgameFactor > 0) {
          const centerDistance = Math.abs(file - 3.5) + Math.abs(rank - 4.5);
          score += sign * Math.round(endgameFactor * Math.max(0, 24 - centerDistance * 6));
        } else if (file === 0 || file === 7) {
          score -= sign * 10;
        }

        if (!pawnOnFile(position, side, file)) score -= sign * 8;
      }
    }

    const centerSquares = [square(4, 4), square(5, 4), square(4, 5), square(5, 5)];
    for (const target of centerSquares) {
      if (attacked(position, target, "w")) score += 2;
      if (attacked(position, target, "b")) score -= 2;
    }

    return score;
  }

  class Engine {
    constructor() {
      this.nodes = 0;
      this.nodeLimit = 0;
      this.stop = false;
      this.table = new Map();
      this.ttMax = 80000;
      this.generation = 0;
      this.killers = Array.from({length: 64}, () => []);
      this.history = new Map();
    }

    isCapture(position, move) {
      return Boolean(position[move.to]) || Boolean(move.enPassant);
    }

    staticExchange(position, move) {
      const movingPiece = position[move.from];
      if (!movingPiece) return 0;

      const capturedPiece = move.enPassant
        ? colorPiece("P", sideOf(movingPiece) === "w" ? "b" : "w")
        : position[move.to];
      if (!capturedPiece && !move.promotion) return 0;

      let gain = [
        (VALUES[capturedPiece?.toUpperCase()] || 0) +
        (move.promotion ? VALUES[move.promotion] - VALUES.P : 0)
      ];
      let board = applyMove(position, move);
      let side = sideOf(movingPiece) === "w" ? "b" : "w";
      let victimValue = VALUES[(move.promotion || movingPiece).toUpperCase()] || 0;

      while (true) {
        const attackerFrom = findLeastValuableAttacker(board, move.to, side);
        if (attackerFrom === null) break;

        const attacker = board[attackerFrom];
        board[attackerFrom] = null;
        board[move.to] = attacker;
        gain.push(victimValue - gain[gain.length - 1]);
        victimValue = VALUES[attacker.toUpperCase()] || 0;
        side = side === "w" ? "b" : "w";
      }

      for (let index = gain.length - 2; index >= 0; index--) {
        gain[index] = -Math.max(-gain[index], gain[index + 1]);
      }

      return gain[0];
    }

    captureValue(position, move) {
      if (move.enPassant) return VALUES.P;
      return VALUES[position[move.to]?.toUpperCase()] || 0;
    }

    isCheckingMove(position, side, move) {
      return kingInCheck(applyMove(position, move), side === "w" ? "b" : "w");
    }

    readTTScore(score, ply) {
      if (score > MATE_THRESHOLD) return score - ply;
      if (score < -MATE_THRESHOLD) return score + ply;
      return score;
    }

    writeTTScore(score, ply) {
      if (score > MATE_THRESHOLD) return score + ply;
      if (score < -MATE_THRESHOLD) return score - ply;
      return score;
    }

    storeTT(key, depth, score, flag, bestMove, ply) {
      const normalizedScore = this.writeTTScore(score, ply);
      const existing = this.table.get(key);

      if (existing && existing.depth > depth && existing.flag === "EXACT" && flag !== "EXACT") return;

      this.table.set(key, {
        depth,
        score: normalizedScore,
        flag,
        bestMove,
        generation: this.generation
      });

      if (this.table.size <= this.ttMax) return;

      const targetSize = Math.floor(this.ttMax * 0.9);
      for (const [candidateKey, entry] of this.table) {
        if (this.table.size <= targetSize) break;
        if (entry.generation < this.generation) this.table.delete(candidateKey);
      }

      if (this.table.size > targetSize) {
        for (const [candidateKey, entry] of this.table) {
          if (this.table.size <= targetSize) break;
          if (entry.depth <= 2) this.table.delete(candidateKey);
        }
      }

      if (this.table.size > targetSize) {
        const iterator = this.table.keys();
        while (this.table.size > targetSize) {
          const candidate = iterator.next();
          if (candidate.done) break;
          this.table.delete(candidate.value);
        }
      }
    }

    getGameState(position, side, castlingRights = 15, epSquare = null) {
      const inCheck = kingInCheck(position, side);
      const hasLegalMoves = legalMoves(position, side, castlingRights, epSquare).length > 0;
      if (!hasLegalMoves) return inCheck ? "checkmate" : "stalemate";
      return inCheck ? "check" : "playing";
    }

    resetHeuristics() {
      this.killers = Array.from({length: 64}, () => []);
      this.history.clear();
    }

    addKiller(ply, move) {
      const list = this.killers[ply] || [];
      if (!list.some(item => item.from === move.from && item.to === move.to && item.promotion === move.promotion)) {
        list.unshift({from: move.from, to: move.to, promotion: move.promotion || null});
        this.killers[ply] = list.slice(0, 2);
      }
    }

    addHistory(side, move, depth) {
      const key = side + ":" + move.from + ":" + move.to + ":" + (move.promotion || "");
      const current = this.history.get(key) || 0;
      const next = Math.min(200000, current + depth * depth * Math.max(1, depth - 1));
      this.history.set(key, next);
    }

    orderMoves(position, side, moves, ply = 0, ttMove = null) {
      const killers = this.killers[ply] || [];
      const killerKey = move => move.from + ":" + move.to + ":" + (move.promotion || "");
      const scores = moves.map(move => {
        const key = killerKey(move);
        let value = 0;

        if (ttMove && killerKey(move) === killerKey(ttMove)) value += 10000000;

        if (this.isCapture(position, move)) {
          const see = this.staticExchange(position, move);
          value += 300000 + see * 100 + this.captureValue(position, move) * 10;
        }

        if (move.promotion) value += 250000 + (VALUES[move.promotion] || 0) * 20;

        if (killers[0] && killerKey(killers[0]) === key) value += 120000;
        else if (killers[1] && killerKey(killers[1]) === key) value += 100000;

        value += this.history.get(side + ":" + move.from + ":" + move.to + ":" + (move.promotion || "")) || 0;
        return {move, value};
      });

      scores.sort((a, b) => b.value - a.value);
      moves.splice(0, moves.length, ...scores.map(entry => entry.move));
    }

    quiescence(position, side, alpha, beta, castlingRights, epSquare, ply = 0) {
      if (++this.nodes >= this.nodeLimit) {
        this.stop = true;
        return side === "w" ? evaluate(position) : -evaluate(position);
      }

      const inCheck = kingInCheck(position, side);
      const standLimit = 12;
      const moves = legalMoves(position, side, castlingRights, epSquare);
      if (!moves.length) {
        if (inCheck) return -MATE_SCORE + ply;
        return 0;
      }

      const stand = side === "w" ? evaluate(position) : -evaluate(position);
      if (ply >= standLimit) return stand;
      if (!inCheck) {
        if (stand >= beta) return stand;
        if (stand > alpha) alpha = stand;
      }

      const nextSide = side === "w" ? "b" : "w";
      const tactical = [];

      for (const move of moves) {
        const capture = this.isCapture(position, move);
        const promotion = Boolean(move.promotion);
        const givesCheck = this.isCheckingMove(position, side, move);

        if (!inCheck && capture && !promotion && !givesCheck && this.staticExchange(position, move) < 0) continue;
        if (!inCheck && !capture && !promotion && (!givesCheck || ply >= 2)) continue;

        tactical.push(move);
      }

      this.orderMoves(position, side, tactical, ply);

      for (const move of tactical) {
        const captureGain = this.captureValue(position, move) + (move.promotion ? VALUES[move.promotion] - VALUES.P : 0);
        if (!inCheck && !move.promotion && this.captureValue(position, move) > 0 &&
            stand + captureGain + 80 < alpha && !this.isCheckingMove(position, side, move)) {
          continue;
        }

        const nextPosition = applyMove(position, move);
        const nextState = nextStateMetadata(position, side, castlingRights, epSquare, move);
        const score = -this.quiescence(
          nextPosition,
          nextSide,
          -beta,
          -alpha,
          nextState.castlingRights,
          nextState.epSquare,
          ply + 1
        );

        if (this.stop) return score;
        if (score >= beta) return score;
        if (score > alpha) alpha = score;
      }

      return alpha;
    }

    negamax(position, side, depth, alpha, beta, ply = 0, castlingRights = 15, epSquare = null, allowNull = true) {
      if (++this.nodes >= this.nodeLimit) {
        this.stop = true;
        return side === "w" ? evaluate(position) : -evaluate(position);
      }

      const key = stateKey(position, side, castlingRights, epSquare);
      const originalAlpha = alpha;
      const entry = this.table.get(key);

      if (entry && entry.depth >= depth) {
        const ttScore = this.readTTScore(entry.score, ply);
        if (entry.flag === "EXACT") return ttScore;
        if (entry.flag === "LOWER" && ttScore >= beta) return ttScore;
        if (entry.flag === "UPPER" && ttScore <= alpha) return ttScore;
      }

      const inCheck = kingInCheck(position, side);
      const moves = legalMoves(position, side, castlingRights, epSquare);
      if (!moves.length) {
        if (inCheck) return -MATE_SCORE + ply;
        return 0;
      }

      if (depth <= 0) return this.quiescence(position, side, alpha, beta, castlingRights, epSquare, ply);

      if (allowNull && depth >= 4 && !inCheck && nonPawnMaterial(position) > 2400) {
        const nextSide = side === "w" ? "b" : "w";
        const score = -this.negamax(
          position,
          nextSide,
          depth - 3,
          -beta,
          -beta + 1,
          ply + 1,
          castlingRights,
          null,
          false
        );
        if (this.stop) return score;
        if (score >= beta) return score;
      }

      const ttMove = entry?.bestMove || null;
      this.orderMoves(position, side, moves, ply, ttMove);

      let best = -SEARCH_INF;
      let bestMove = moves[0];
      let first = true;
      const nextSide = side === "w" ? "b" : "w";

      for (let index = 0; index < moves.length; index++) {
        const move = moves[index];
        const nextPosition = applyMove(position, move);
        const nextState = nextStateMetadata(position, side, castlingRights, epSquare, move);
        const quiet = !this.isCapture(position, move) && !move.promotion && !move.castle;

        let searchDepth = depth - 1;
        if (!first && depth >= 4 && index >= 3 && quiet) {
          const historyScore = this.history.get(side + ":" + move.from + ":" + move.to + ":" + (move.promotion || "")) || 0;
          const killer = (this.killers[ply] || []).some(item =>
            item.from === move.from && item.to === move.to && item.promotion === (move.promotion || null)
          );
          const givesCheck = kingInCheck(nextPosition, nextSide);

          if (!killer && !givesCheck && historyScore < 12000) {
            const reduction = depth >= 6 && index >= 7 ? 2 : 1;
            searchDepth = Math.max(1, depth - 1 - reduction);
          }
        }

        let score;
        if (first) {
          score = -this.negamax(
            nextPosition,
            nextSide,
            depth - 1,
            -beta,
            -alpha,
            ply + 1,
            nextState.castlingRights,
            nextState.epSquare,
            true
          );
          first = false;
        } else {
          score = -this.negamax(
            nextPosition,
            nextSide,
            searchDepth,
            -alpha - 1,
            -alpha,
            ply + 1,
            nextState.castlingRights,
            nextState.epSquare,
            true
          );

          if (!this.stop && score > alpha) {
            score = -this.negamax(
              nextPosition,
              nextSide,
              depth - 1,
              -beta,
              -alpha,
              ply + 1,
              nextState.castlingRights,
              nextState.epSquare,
              true
            );
          }
        }

        if (this.stop) return score;

        if (score > best) {
          best = score;
          bestMove = move;
        }

        if (score > alpha) alpha = score;

        if (alpha >= beta) {
          if (quiet) {
            this.addKiller(ply, move);
            this.addHistory(side, move, depth);
          }
          break;
        }
      }

      let flag = "EXACT";
      if (best <= originalAlpha) flag = "UPPER";
      else if (best >= beta) flag = "LOWER";

      this.storeTT(key, depth, best, flag, bestMove, ply);
      return best;
    }

    searchRoot(position, side, depth, alpha, beta, castlingRights = 15, epSquare = null, ply = 0) {
      const moves = legalMoves(position, side, castlingRights, epSquare);
      if (!moves.length) return {
        complete: true,
        bestMove: null,
        bestScore: kingInCheck(position, side) ? -MATE_SCORE : 0,
        scoredMoves: [],
        failLow: false,
        failHigh: false
      };

      const key = stateKey(position, side, castlingRights, epSquare);
      const entry = this.table.get(key);
      this.orderMoves(position, side, moves, 0, entry?.bestMove || null);

      let bestScore = -SEARCH_INF;
      let bestMove = moves[0];
      let first = true;
      const scoredMoves = [];
      const originalAlpha = alpha;
      const nextSide = side === "w" ? "b" : "w";

      for (const move of moves) {
        const nextPosition = applyMove(position, move);
        const nextState = nextStateMetadata(position, side, castlingRights, epSquare, move);

        let score;
        if (first) {
          score = -this.negamax(
            nextPosition,
            nextSide,
            depth - 1,
            -beta,
            -alpha,
            1,
            nextState.castlingRights,
            nextState.epSquare,
            true
          );
          first = false;
        } else {
          score = -this.negamax(
            nextPosition,
            nextSide,
            depth - 1,
            -alpha - 1,
            -alpha,
            1,
            nextState.castlingRights,
            nextState.epSquare,
            true
          );

          if (!this.stop && score > alpha) {
            score = -this.negamax(
              nextPosition,
              nextSide,
              depth - 1,
              -beta,
              -alpha,
              1,
              nextState.castlingRights,
              nextState.epSquare,
              true
            );
          }
        }

        if (this.stop) {
          return {
            complete: false,
            bestMove,
            bestScore,
            scoredMoves,
            failLow: false,
            failHigh: false
          };
        }

        scoredMoves.push({move, score});
        if (score > bestScore) {
          bestScore = score;
          bestMove = move;
        }
        if (score > alpha) alpha = score;

        if (alpha >= beta) break;
      }

      scoredMoves.sort((a, b) => b.score - a.score);
      return {
        complete: scoredMoves.length === moves.length,
        bestMove,
        bestScore,
        scoredMoves,
        failLow: bestScore <= originalAlpha,
        failHigh: bestScore >= beta
      };
    }

    search(position, side, maxDepth = 4, nodeLimit = 40000, alternativeCount = 4, castlingRights = 15, epSquare = null) {
      this.nodes = 0;
      this.nodeLimit = nodeLimit;
      this.generation++;
      this.resetHeuristics();
      this.stop = false;

      let bestMove = null;
      let bestScore = -SEARCH_INF;
      let bestMoves = [];
      let reachedDepth = 0;

      for (let depth = 1; depth <= maxDepth; depth++) {
        const moves = legalMoves(position, side, castlingRights, epSquare);
        if (!moves.length) break;

        const rootKey = stateKey(position, side, castlingRights, epSquare);
        const rootEntry = this.table.get(rootKey);
        this.orderMoves(position, side, moves, 0, rootEntry?.bestMove || bestMove);

        let alpha = -SEARCH_INF;
        let beta = SEARCH_INF;
        const useAspiration = depth >= 3 && reachedDepth > 0;
        const finalAlternatives = alternativeCount > 1 && depth === maxDepth;

        if (useAspiration && !finalAlternatives) {
          const window = 40 + depth * 10;
          alpha = Math.max(-SEARCH_INF, bestScore - window);
          beta = Math.min(SEARCH_INF, bestScore + window);
        }

        let iteration = this.searchRoot(position, side, depth, alpha, beta, castlingRights, epSquare);

        if (!this.stop && useAspiration && !finalAlternatives &&
            (iteration.failLow || iteration.failHigh)) {
          iteration = this.searchRoot(position, side, depth, -SEARCH_INF, SEARCH_INF, castlingRights, epSquare);
        }

        if (this.stop || !iteration.complete) break;

        bestMoves = iteration.scoredMoves;
        bestMove = iteration.bestMove;
        bestScore = iteration.bestScore;
        reachedDepth = depth;

        this.storeTT(rootKey, depth, bestScore, "EXACT", bestMove, 0);
      }

      if (!bestMove) {
        const legal = legalMoves(position, side, castlingRights, epSquare);
        if (!legal.length) {
          return {
            gameState: kingInCheck(position, side) ? "checkmate" : "stalemate",
            from: null,
            to: null,
            promotion: null,
            score: kingInCheck(position, side) ? -MATE_SCORE : 0,
            depth: 0,
            nodes: this.nodes,
            alternatives: []
          };
        }

        bestMove = legal[0];
        bestScore = 0;
        bestMoves = [{move: bestMove, score: bestScore}];
        reachedDepth = 0;
      }

      const outputMoves = bestMoves
        .slice(0, Math.max(1, alternativeCount))
        .map(entry => ({
          from: entry.move.from,
          to: entry.move.to,
          promotion: entry.move.promotion,
          score: entry.score
        }));

      return {
        gameState: kingInCheck(position, side) ? "check" : "playing",
        from: bestMove.from,
        to: bestMove.to,
        promotion: bestMove.promotion,
        score: bestScore,
        depth: reachedDepth,
        nodes: this.nodes,
        alternatives: outputMoves
      };
    }
  }

  window.__CMH_ENGINE__ = new Engine();
})();
