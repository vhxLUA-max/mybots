(() => {
  if (globalThis.__CMH_MAIA__) return;

  importScripts("ort.min.js", "maia3/maia3-tokenizer.js", "maia3/chess-rules.js");

  const MODEL_URL = "https://raw.githubusercontent.com/vhxLUA-max/cheeezie-engine/main/lib/maia3/maia3-5m.onnx";
  const ORT_WASM_BASE = "https://raw.githubusercontent.com/vhxLUA-max/cheeezie-engine/main/lib/ort/";
  const ALL_MOVES_URL = chrome.runtime.getURL("maia3/all_moves.json");

  let session = null;
  let allMoves = null;
  let allMovesDict = null;
  let initPromise = null;

  function clampElo(value) {
    return Math.max(600, Math.min(2600, Number(value) || 1500));
  }

  function moveToUci(move) {
    const files = "abcdefgh";
    const from = files[move.from & 7] + (Math.floor(move.from / 8) + 1);
    const to = files[move.to & 7] + (Math.floor(move.to / 8) + 1);
    return from + to + (move.promotion ? move.promotion.toLowerCase() : "");
  }

  function softmaxTop(logits, legalIndices, topN, turn) {
    let maxLogit = -Infinity;

    for (const index of legalIndices) {
      if (logits[index] > maxLogit) maxLogit = logits[index];
    }

    if (!Number.isFinite(maxLogit)) throw new Error("Maia returned no finite legal move logits.");

    const scored = [];
    let sum = 0;

    for (const index of legalIndices) {
      const probability = Math.exp(logits[index] - maxLogit);
      scored.push({index, probability});
      sum += probability;
    }

    if (!Number.isFinite(sum) || sum <= 0) throw new Error("Maia probability normalization failed.");

    for (const entry of scored) entry.probability /= sum;
    scored.sort((a, b) => b.probability - a.probability);

    return scored.slice(0, Math.max(1, topN)).map((entry, rank) => {
      const uci = indexToUci(entry.index, allMoves, turn);
      const from = uci.slice(0, 2);
      const to = uci.slice(2, 4);
      const score = Math.round(entry.probability * 1000);

      return {
        from,
        to,
        promotion: uci.length > 4 ? uci[4].toUpperCase() : null,
        score,
        loss: 0,
        probability: entry.probability,
        rank: rank + 1
      };
    });
  }

  async function init() {
    if (session) return;
    if (initPromise) return initPromise;

    initPromise = (async () => {
      ort.env.wasm.wasmPaths = ORT_WASM_BASE;
      if (ort.env.wasm.numThreads !== undefined) ort.env.wasm.numThreads = 1;
      if (ort.env.wasm.proxy !== undefined) ort.env.wasm.proxy = false;

      const [modelResponse, movesResponse] = await Promise.all([
        fetch(MODEL_URL),
        fetch(ALL_MOVES_URL)
      ]);

      if (!modelResponse.ok) throw new Error("Maia model fetch HTTP " + modelResponse.status);
      if (!movesResponse.ok) throw new Error("Maia move vocabulary fetch HTTP " + movesResponse.status);

      const [modelBuffer, moves] = await Promise.all([
        modelResponse.arrayBuffer(),
        movesResponse.json()
      ]);

      if (!Array.isArray(moves) || moves.length !== 4352) {
        throw new Error("Invalid Maia move vocabulary.");
      }

      allMoves = moves;
      allMovesDict = new Map(moves.map((move, index) => [move, index]));

      session = await ort.InferenceSession.create(modelBuffer, {
        executionProviders: ["wasm"],
        graphOptimizationLevel: "all",
        executionMode: "sequential"
      });
    })();

    try {
      await initPromise;
    } catch (error) {
      initPromise = null;
      session = null;
      throw error;
    }
  }

  async function search(position, side, alternativeCount = 4, castlingRights = 15, epSquare = null, selfElo = 1500, oppoElo = 1500) {
    const legalMoves = globalThis.__CMH_CHESS_RULES__.legalMoves(
      position,
      side,
      castlingRights,
      epSquare
    );

    if (!legalMoves.length) {
      const gameState = globalThis.__CMH_CHESS_RULES__.getGameState(
        position,
        side,
        castlingRights,
        epSquare
      );
      return {
        gameState,
        from: null,
        to: null,
        promotion: null,
        score: 0,
        mate: null,
        pv: [],
        depth: 0,
        nodes: 0,
        alternatives: [],
        maia: true,
        model: "Maia 3 5M"
      };
    }

    await init();

    const turn = side;
    const legalIndices = [];

    for (const move of legalMoves) {
      let uci = moveToUci(move);
      if (turn === "b") uci = mirrorMove(uci);

      const index = allMovesDict.get(uci);
      if (index === undefined) continue;

      legalIndices.push(index);
    }

    if (!legalIndices.length) throw new Error("Maia legal move vocabulary contains no current legal moves.");

    const boardTokens = tokenizeBoard(
      positionToFen(position, side, castlingRights, epSquare)
    );
    const tokenFlat = getHistoricalTokens([boardTokens], {
      history: 8,
      include_time_info: false
    });

    const selfEloTensor = new ort.Tensor(
      "int64",
      BigInt64Array.from([BigInt(clampElo(selfElo))]),
      [1]
    );
    const oppoEloTensor = new ort.Tensor(
      "int64",
      BigInt64Array.from([BigInt(clampElo(oppoElo))]),
      [1]
    );
    const tokenTensor = new ort.Tensor("float32", tokenFlat, [1, 64, 97]);

    const output = await session.run({
      tokens: tokenTensor,
      self_elo: selfEloTensor,
      oppo_elo: oppoEloTensor
    });

    const logits = output.logits_move?.data;
    if (!logits || logits.length !== 4352) throw new Error("Invalid Maia logits output.");

    const ranked = softmaxTop(logits, legalIndices, alternativeCount, turn);
    const bestScore = ranked[0]?.score ?? 0;
    const alternatives = ranked.map(entry => ({
      ...entry,
      loss: Math.max(0, bestScore - entry.score)
    }));

    const best = alternatives[0];
    return {
      gameState: "playing",
      from: best.from,
      to: best.to,
      promotion: best.promotion,
      score: best.score,
      probability: best.probability,
      mate: null,
      pv: [],
      depth: 0,
      nodes: 0,
      alternatives,
      maia: true,
      model: "Maia 3 5M",
      selfElo: clampElo(selfElo),
      oppoElo: clampElo(oppoElo)
    };
  }

  function positionToFen(position, side, castlingRights, epSquare) {
    const ranks = [];

    for (let rank = 8; rank >= 1; rank--) {
      let empty = 0;
      let row = "";

      for (let file = 0; file < 8; file++) {
        const piece = position[(rank - 1) * 8 + file];
        if (!piece) {
          empty++;
          continue;
        }
        if (empty) {
          row += empty;
          empty = 0;
        }
        row += piece;
      }

      if (empty) row += empty;
      ranks.push(row);
    }

    const rights =
      (castlingRights & 1 ? "K" : "") +
      (castlingRights & 2 ? "Q" : "") +
      (castlingRights & 4 ? "k" : "") +
      (castlingRights & 8 ? "q" : "");

    let ep = "-";
    if (Number.isInteger(epSquare)) {
      const files = "abcdefgh";
      ep = files[epSquare & 7] + (Math.floor(epSquare / 8) + 1);
    }

    return ranks.join("/") + " " + side + " " + (rights || "-") + " " + ep + " 0 1";
  }

  globalThis.__CMH_MAIA__ = {search};
})();