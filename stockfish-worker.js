let enginePromise = null;
let initialized = false;
let activeSearch = null;
const waiters = [];

function normalizeLine(value) {
  if (typeof value === "string") return value.trim();
  if (typeof value?.data === "string") return value.data.trim();
  return "";
}

function notifyLine(value) {
  const line = normalizeLine(value);
  if (!line) return;

  if (activeSearch) {
    if (line.startsWith("info ")) parseInfo(line, activeSearch);
    if (line.startsWith("bestmove ")) {
      const move = line.split(/\s+/)[1] || "";
      activeSearch.resolve(move);
    }
  }

  for (let index = waiters.length - 1; index >= 0; index--) {
    const waiter = waiters[index];
    if (!waiter.predicate(line)) continue;
    waiters.splice(index, 1);
    clearTimeout(waiter.timer);
    waiter.resolve(line);
  }
}

function waitForLine(predicate, timeout = 15000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const index = waiters.findIndex(waiter => waiter.timer === timer);
      if (index !== -1) waiters.splice(index, 1);
      reject(new Error("Stockfish timed out waiting for engine response."));
    }, timeout);
    waiters.push({predicate, resolve, reject, timer});
  });
}

function parseUciMove(value) {
  if (!/^[a-h][1-8][a-h][1-8][nbrq]?$/i.test(value || "")) return null;
  const files = "abcdefgh";
  const from = (Number(value[1]) - 1) * 8 + files.indexOf(value[0].toLowerCase());
  const to = (Number(value[3]) - 1) * 8 + files.indexOf(value[2].toLowerCase());
  return {
    from,
    to,
    promotion: value.length > 4 ? value[4].toUpperCase() : null
  };
}

function numericScore(cp, mate) {
  if (mate !== null) {
    const distance = Math.abs(mate);
    return mate >= 0 ? 1000000 - distance * 2 : -1000000 + distance * 2;
  }
  return cp;
}

function parseInfo(line, search) {
  const multipv = Number(line.match(/\bmultipv (\d+)/)?.[1] || 1);
  const depth = Number(line.match(/\bdepth (\d+)/)?.[1] || 0);
  const nodes = Number(line.match(/\bnodes (\d+)/)?.[1] || 0);
  const cpMatch = line.match(/\bscore cp (-?\d+)/);
  const mateMatch = line.match(/\bscore mate (-?\d+)/);
  const pvMatch = line.match(/\bpv (.+)$/);

  if (!cpMatch && !mateMatch) return;

  const cp = cpMatch ? Number(cpMatch[1]) : null;
  const mate = mateMatch ? Number(mateMatch[1]) : null;
  const pv = pvMatch
    ? pvMatch[1].trim().split(/\s+/).map(parseUciMove).filter(Boolean)
    : [];

  search.lines.set(multipv, {
    multipv,
    depth,
    nodes,
    score: numericScore(cp ?? 0, mate),
    mate,
    pv
  });
}

async function getEngine() {
  if (!enginePromise) {
    enginePromise = (async () => {
      try {
        importScripts("stockfish/stockfish-19-lite-single.js");
      } catch {
        throw new Error("Stockfish asset missing: stockfish/stockfish-19-lite-single.js");
      }

      if (typeof Stockfish !== "function") {
        throw new Error("Stockfish factory is unavailable.");
      }

      const engine = await Promise.resolve(Stockfish());
      if (!engine || typeof engine.postMessage !== "function" || typeof engine.addMessageListener !== "function") {
        throw new Error("Unsupported Stockfish.js browser interface.");
      }

      engine.addMessageListener(notifyLine);
      return engine;
    })();
  }

  return enginePromise;
}

async function initializeEngine(engine) {
  if (initialized) return;

  engine.postMessage("uci");
  await waitForLine(line => line === "uciok");
  engine.postMessage("isready");
  await waitForLine(line => line === "readyok");
  initialized = true;
}

async function runSearch({fen, depth, multiPV}) {
  const engine = await getEngine();
  await initializeEngine(engine);

  const search = {
    lines: new Map(),
    resolve: null,
    reject: null
  };

  const completion = new Promise((resolve, reject) => {
    search.resolve = resolve;
    search.reject = reject;
  });

  activeSearch = search;
  const timeout = setTimeout(() => {
    if (activeSearch !== search) return;
    try {
      engine.postMessage("stop");
    } catch {}
    search.reject(new Error("Stockfish search timed out."));
  }, 30000);

  try {
    engine.postMessage("ucinewgame");
    engine.postMessage("setoption name MultiPV value " + Math.max(1, Math.min(8, Number(multiPV) || 4)));
    engine.postMessage("isready");
    await waitForLine(line => line === "readyok");

    engine.postMessage("position fen " + fen);
    engine.postMessage("go depth " + Math.max(1, Math.min(30, Number(depth) || 16)));

    const bestmove = await completion;
    const entries = [...search.lines.values()].sort((a, b) => a.multipv - b.multipv);
    const bestInfo = entries[0] || null;
    const fallback = parseUciMove(bestmove);

    if (!fallback) {
      return {
        gameState: "no-move",
        from: null,
        to: null,
        promotion: null,
        score: 0,
        mate: null,
        pv: [],
        depth: bestInfo?.depth || Number(depth) || 0,
        nodes: bestInfo?.nodes || 0,
        alternatives: [],
        stockfish: true,
        model: "Stockfish 19 Lite"
      };
    }

    const baseScore = bestInfo?.score ?? 0;
    const alternatives = entries.slice(0, 8).map((entry, index) => {
      const firstMove = entry.pv[0] || (index === 0 ? fallback : null);
      if (!firstMove) return null;
      return {
        ...firstMove,
        score: entry.score,
        loss: Math.max(0, baseScore - entry.score),
        mate: entry.mate,
        rank: index + 1,
        depth: entry.depth,
        nodes: entry.nodes
      };
    }).filter(Boolean);

    if (!alternatives.length) {
      alternatives.push({
        ...fallback,
        score: baseScore,
        loss: 0,
        mate: bestInfo?.mate ?? null,
        rank: 1,
        depth: bestInfo?.depth || Number(depth) || 0,
        nodes: bestInfo?.nodes || 0
      });
    }

    const best = alternatives[0];

    return {
      gameState: "playing",
      from: best.from,
      to: best.to,
      promotion: best.promotion,
      score: best.score,
      mate: best.mate ?? null,
      pv: bestInfo?.pv || [fallback],
      depth: bestInfo?.depth || Number(depth) || 0,
      nodes: bestInfo?.nodes || 0,
      alternatives,
      stockfish: true,
      model: "Stockfish 19 Lite"
    };
  } finally {
    clearTimeout(timeout);
    activeSearch = null;
  }
}

let requestQueue = Promise.resolve();

self.onmessage = event => {
  const message = event.data || {};
  const taskId = message.taskId || 0;

  if (message.type !== "stockfishSearch") {
    self.postMessage({taskId, ok: false, error: "Unknown Stockfish task."});
    return;
  }

  requestQueue = requestQueue
    .catch(() => {})
    .then(() => runSearch(message))
    .then(result => self.postMessage({taskId, ok: true, result}))
    .catch(error => self.postMessage({
      taskId,
      ok: false,
      error: error.message || "Stockfish worker error."
    }));
};
