const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

const root = path.resolve(__dirname, "..");

function loadRules() {
  const sandbox = {console};
  vm.runInNewContext(
    fs.readFileSync(path.join(root, "maia3", "chess-rules.js"), "utf8"),
    sandbox,
    {filename: "maia3/chess-rules.js"}
  );
  return sandbox.__CMH_CHESS_RULES__;
}

function loadBook() {
  const sandbox = {console};
  vm.runInNewContext(
    fs.readFileSync(path.join(root, "book.js"), "utf8"),
    sandbox,
    {filename: "book.js"}
  );
  return sandbox.CMH_BOOK;
}

function positionFromFen(fen) {
  const rows = fen.split(/\s+/)[0].split("/");
  assert.equal(rows.length, 8);
  const position = Array(64).fill(null);

  for (let row = 0; row < 8; row++) {
    let file = 0;
    for (const symbol of rows[row]) {
      if (/^[1-8]$/.test(symbol)) {
        file += Number(symbol);
      } else {
        assert.match(symbol, /^[prnbqkPRNBQK]$/);
        position[(7 - row) * 8 + file] = symbol;
        file++;
      }
    }
    assert.equal(file, 8);
  }

  return position;
}

function index(square) {
  return (Number(square[1]) - 1) * 8 + square.charCodeAt(0) - 97;
}

function createNode(attributes = {}) {
  return {
    attributes: {...attributes},
    children: [],
    style: {
      setProperty() {}
    },
    classList: {
      values: new Set(),
      add(...values) {
        values.forEach(value => this.values.add(value));
      },
      contains(value) {
        return this.values.has(value);
      }
    },
    getAttribute(name) {
      return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null;
    },
    setAttribute(name, value) {
      this.attributes[name] = String(value);
    },
    removeAttribute(name) {
      delete this.attributes[name];
    },
    appendChild(child) {
      this.children.push(child);
      return child;
    },
    querySelector() {
      return null;
    },
    querySelectorAll() {
      return [];
    },
    remove() {}
  };
}

function loadContentHarness({fen, playerSide, turn, maiaResult}) {
  let captured = null;
  let messageListener = null;

  const board = createNode({
    "data-cmh-fen": fen,
    "data-cmh-player-side": playerSide,
    "data-cmh-turn": turn
  });

  const engine = {
    maiaSearch(...args) {
      captured = {...captured, type: "maiaSearch", maiaArgs: args};
      return maiaResult;
    }
  };

  const document = {
    body: {innerText: ""},
    documentElement: createNode(),
    querySelector(selector) {
      if (selector.includes("wc-chess-board")) return board;
      return null;
    },
    querySelectorAll() {
      return [];
    },
    createElement() {
      return createNode();
    },
    createElementNS() {
      return createNode();
    }
  };

  class FakeWorker {
    constructor() {
      this.onmessage = null;
      this.onerror = null;
    }

    postMessage(message) {
      setTimeout(() => {
        try {
          if (message.type !== "maiaSearch") throw new Error("Unknown Maia task");
          const result = engine.maiaSearch(
            message.position,
            message.side,
            message.alternativeCount,
            message.castlingRights,
            message.epSquare,
            message.selfElo,
            message.oppoElo
          );
          this.onmessage?.({data: {taskId: message.taskId, ok: true, result}});
        } catch (error) {
          this.onmessage?.({
            data: {
              taskId: message.taskId,
              ok: false,
              error: error.message
            }
          });
        }
      }, 0);
    }

    terminate() {}
  }

  const chrome = {
    runtime: {
      lastError: null,
      getURL(value) {
        return "chrome-extension://test/" + value;
      },
      sendMessage(message, callback) {
        if (message?.type === "bookLookup") {
          callback({ok: true, found: false, moves: [], name: "", sourceId: ""});
          return;
        }
        callback({ok: true});
      },
      onMessage: {
        addListener(listener) {
          messageListener = listener;
        }
      }
    }
  };

  class Observer {
    observe() {}
    disconnect() {}
  }

  const sandbox = {
    window: {},
    document,
    chrome,
    Worker: FakeWorker,
    MutationObserver: Observer,
    location: {
      pathname: "/game/live/123",
      href: "https://www.chess.com/game/live/123"
    },
    URL,
    console,
    setTimeout,
    setInterval() {}
  };

  vm.runInNewContext(
    fs.readFileSync(path.join(root, "content.js"), "utf8"),
    sandbox,
    {filename: "content.js"}
  );

  return new Promise((resolve, reject) => {
    setTimeout(() => {
      if (!messageListener) {
        reject(new Error("content state listener was not registered"));
        return;
      }

      messageListener({type: "getState"}, null, response => {
        resolve({captured, response});
      });
    }, 75);
  });
}

function loadMainBridgeHarness({playerSide, turn, fen}) {
  const board = createNode();
  board.game = {
    getPlayingAs() {
      return playerSide;
    },
    getTurn() {
      return turn;
    },
    getFEN() {
      return fen;
    }
  };

  const document = {
    documentElement: createNode(),
    querySelector() {
      return board;
    }
  };

  class Observer {
    observe() {}
  }

  const sandbox = {
    window: {},
    document,
    MutationObserver: Observer,
    setInterval() {}
  };

  vm.runInNewContext(
    fs.readFileSync(path.join(root, "player-side-main.js"), "utf8"),
    sandbox,
    {filename: "player-side-main.js"}
  );

  return board;
}

test("Maia provider does not depend on the deleted local engine", () => {
  const maia = fs.readFileSync(path.join(root, "maia3", "maia3-engine.js"), "utf8");
  const worker = fs.readFileSync(path.join(root, "engine-worker.js"), "utf8");
  const background = fs.readFileSync(path.join(root, "background.js"), "utf8");

  assert.doesNotMatch(maia, /__CMH_ENGINE__/);
  assert.doesNotMatch(worker, /(?:^|["'])engine\.js(?:["']|$)|__CMH_ENGINE__/);
  assert.doesNotMatch(background, /importScripts\("engine\.js"\)|__CMH_ENGINE__\.search|__CMH_ENGINE__\.getGameState/);
  assert.match(maia, /__CMH_CHESS_RULES__/);
  assert.match(maia, /logits_move/);
  assert.match(maia, /4352/);
});

test("Maia worker is the only analysis worker task", () => {
  const worker = fs.readFileSync(path.join(root, "engine-worker.js"), "utf8");
  assert.match(worker, /message\.type === "maiaSearch"/);
  assert.doesNotMatch(worker, /message\.type === "search"/);
  assert.doesNotMatch(worker, /message\.type === "gameState"/);
});

test("Maia uses the independent chess legality layer", () => {
  const rules = loadRules();
  const position = positionFromFen("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1");
  const moves = rules.legalMoves(position, "w", 15, null);
  assert.equal(moves.length, 20);
});

test("chess legality layer detects checkmate", () => {
  const rules = loadRules();
  const position = positionFromFen("rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 0 3");
  assert.equal(rules.getGameState(position, "w", 15, null), "checkmate");
});

test("chess legality layer detects stalemate", () => {
  const rules = loadRules();
  const position = positionFromFen("7k/5K2/6Q1/8/8/8/8/8 b - - 0 1");
  assert.equal(rules.getGameState(position, "b", 0, null), "stalemate");
});

test("castling moves are generated when legal", () => {
  const rules = loadRules();
  const position = positionFromFen("r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1");
  const moves = rules.legalMoves(position, "w", 15, null);
  const keys = new Set(moves.map(move => move.from + ":" + move.to));
  assert.equal(keys.has(index("e1") + ":" + index("g1")), true);
  assert.equal(keys.has(index("e1") + ":" + index("c1")), true);
});

test("en passant move is generated when legal", () => {
  const rules = loadRules();
  const position = positionFromFen("rnbqkbnr/ppp1pppp/8/3pP3/8/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 3");
  const moves = rules.legalMoves(position, "w", 15, index("d6"));
  assert.equal(moves.some(move => move.from === index("e5") && move.to === index("d6") && move.enPassant), true);
});

test("promotion moves are generated", () => {
  const rules = loadRules();
  const position = positionFromFen("7k/4P3/8/8/8/8/8/4K3 w - - 0 1");
  const promotions = rules.legalMoves(position, "w", 0, null)
    .filter(move => move.from === index("e7") && move.to === index("e8"))
    .map(move => move.promotion);
  assert.deepEqual(new Set(promotions), new Set(["Q", "R", "B", "N"]));
});

test("Polyglot hash matches known positions", () => {
  const book = loadBook();
  const cases = [
    ["rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1", "w", 15, null, "463b96181691fc9c"],
    ["rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1", "b", 15, "e", "823c9b50fd114196"],
    ["rnbqkbnr/ppp1pppp/8/3p4/4P3/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 2", "w", 15, "d", "0756b94461c50fb0"]
  ];

  for (const [fen, side, castling, epFile, expected] of cases) {
    const position = positionFromFen(fen);
    assert.equal(book.hash(position, side, castling, epFile).toString(16).padStart(16, "0"), expected);
  }
});

test("MAIN-world bridge exposes player side, turn, and FEN", () => {
  const fen = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1";
  const board = loadMainBridgeHarness({playerSide: 2, turn: 2, fen});
  assert.equal(board.getAttribute("data-cmh-player-side"), "b");
  assert.equal(board.getAttribute("data-cmh-turn"), "b");
  assert.equal(board.getAttribute("data-cmh-fen"), fen);
});

test("content uses Maia directly for move recommendations and candidates", async () => {
  const fen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
  const maiaResult = {
    gameState: "playing",
    from: index("e2"),
    to: index("e4"),
    promotion: null,
    score: 620,
    probability: 0.62,
    alternatives: [
      {from: index("e2"), to: index("e4"), promotion: null, score: 620, probability: 0.62},
      {from: index("d2"), to: index("d4"), promotion: null, score: 180, probability: 0.18}
    ],
    maia: true,
    model: "Maia 3 5M"
  };

  const result = await loadContentHarness({
    fen,
    playerSide: "w",
    turn: "w",
    maiaResult
  });

  assert.equal(result.captured.type, "maiaSearch");
  assert.equal(result.captured.maiaArgs[1], "w");
  assert.equal(result.response.analysisSource, "Maia 3 • Human predictor");
  assert.equal(result.response.analysisEvaluation, "62.0%");
  assert.equal(result.response.analysisCandidates[0].move, "e2e4");
  assert.equal(result.response.analysisCandidates[0].loss, 0);
  assert.equal(result.response.analysisCandidates[0].lossUnit, "pp");
  assert.equal(result.response.status, "Maia e2e4");
});

test("content reports Maia checkmate state directly", async () => {
  const fen = "rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 0 3";
  const result = await loadContentHarness({
    fen,
    playerSide: "w",
    turn: "w",
    maiaResult: {
      gameState: "checkmate",
      from: null,
      to: null,
      promotion: null,
      score: 0,
      alternatives: [],
      maia: true,
      model: "Maia 3 5M"
    }
  });

  assert.equal(result.captured.type, "maiaSearch");
  assert.equal(result.response.status, "Checkmate");
});

test("manifest keeps Maia model resources and WASM policy", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
  assert.equal(manifest.host_permissions.includes("https://raw.githubusercontent.com/*"), true);
  assert.equal(manifest.web_accessible_resources[0].resources.includes("maia3/*"), true);
  assert.equal(manifest.web_accessible_resources[0].resources.includes("ort.min.js"), true);
  assert.equal(manifest.content_security_policy.extension_pages.includes("wasm-unsafe-eval"), true);
  assert.equal(fs.existsSync(path.join(root, "engine.js")), false);
});
