const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const root = require("node:path").resolve(__dirname, "..");

function loadEngine() {
  const sandbox = {
    window: {},
    console,
    setInterval() {}
  };
  vm.runInNewContext(fs.readFileSync(require("node:path").join(root, "engine.js"), "utf8"), sandbox, {
    filename: "engine.js"
  });
  return sandbox.window.__CMH_ENGINE__;
}

function loadBook() {
  const sandbox = {console};
  vm.runInNewContext(fs.readFileSync(require("node:path").join(root, "book.js"), "utf8"), sandbox, {
    filename: "book.js"
  });
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

function moveKey(move) {
  return index(move.slice(0, 2)) + ":" + index(move.slice(2, 4));
}

function createNode(attributes = {}) {
  const node = {
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
    }
  };
  return node;
}

function loadContentHarness({fen, playerSide, turn, engineResult}) {
  let captured = null;
  let messageListener = null;

  const board = createNode({
    "data-cmh-fen": fen,
    "data-cmh-player-side": playerSide,
    "data-cmh-turn": turn
  });

  const engine = {
    getGameState(...args) {
      captured = {type: "gameState", args};
      return "playing";
    },
    search(...args) {
      captured = {...captured, type: "search", searchArgs: args};
      return engineResult;
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

  const chrome = {
    runtime: {
      lastError: null,
      sendMessage(message, callback) {
        callback({ok: true, found: false});
      },
      onMessage: {
        addListener(listener) {
          messageListener = listener;
        }
      }
    }
  };

  const sandbox = {
    window: {__CMH_ENGINE__: engine},
    document,
    chrome,
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
    fs.readFileSync(require("node:path").join(root, "content.js"), "utf8"),
    sandbox,
    {filename: "content.js"}
  );

  return new Promise((resolve, reject) => {
    setTimeout(() => {
      if (!messageListener) {
        reject(new Error("content state listener was not registered"));
        return;
      }
      let response;
      messageListener({type: "getState"}, null, value => {
        response = value;
      });
      resolve({captured, response});
    }, 25);
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
    document,
    MutationObserver: Observer,
    setInterval() {}
  };

  vm.runInNewContext(
    fs.readFileSync(require("node:path").join(root, "player-side-main.js"), "utf8"),
    sandbox,
    {filename: "player-side-main.js"}
  );

  return board;
}

test("starting position has 20 legal moves", () => {
  const engine = loadEngine();
  const position = positionFromFen("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1");
  const result = engine.search(position, "w", 1, 50000, 32, 15, null);
  assert.equal(result.gameState, "playing");
  assert.equal(result.alternatives.length, 20);
});

test("fool's mate position is checkmate", () => {
  const engine = loadEngine();
  const position = positionFromFen("rnb1kbnr/pppp1ppp/8/4p3/6P1/5P2/PPPPP2P/RNBQKBNR w KQkq - 0 3");
  assert.equal(engine.getGameState(position, "w", 15, null), "checkmate");
});

test("classic stalemate position is stalemate", () => {
  const engine = loadEngine();
  const position = positionFromFen("7k/5K2/6Q1/8/8/8/8/8 b - - 0 1");
  assert.equal(engine.getGameState(position, "b", 0, null), "stalemate");
});

test("castling moves are generated when legal", () => {
  const engine = loadEngine();
  const position = positionFromFen("r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1");
  const result = engine.search(position, "w", 1, 50000, 32, 15, null);
  const keys = new Set(result.alternatives.map(move => move.from + ":" + move.to));
  assert.equal(keys.has(index("e1") + ":" + index("g1")), true);
  assert.equal(keys.has(index("e1") + ":" + index("c1")), true);
});

test("en passant move is generated when legal", () => {
  const engine = loadEngine();
  const position = positionFromFen("rnbqkbnr/ppp1pppp/8/3pP3/8/8/PPPP1PPP/RNBQKBNR w KQkq d6 0 3");
  const result = engine.search(position, "w", 1, 50000, 32, 15, index("d6"));
  assert.equal(result.alternatives.some(move => move.from === index("e5") && move.to === index("d6")), true);
});

test("promotion moves are generated", () => {
  const engine = loadEngine();
  const position = positionFromFen("4k3/4P3/8/8/8/8/8/4K3 w - - 0 1");
  const result = engine.search(position, "w", 1, 50000, 32, 0, null);
  const promotions = result.alternatives.filter(move => move.from === index("e7") && move.to === index("e8"));
  assert.deepEqual(new Set(promotions.map(move => move.promotion)), new Set(["Q", "R", "B", "N"]));
});

test("mate in one returns the expected mate-distance score", () => {
  const engine = loadEngine();
  const position = positionFromFen("7k/6Q1/5K2/8/8/8/8/8 w - - 0 1");
  const result = engine.search(position, "w", 1, 50000, 8, 0, null);
  assert.equal(result.score, 999998);
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

test("content state uses authoritative FEN side, castling, and en passant", async () => {
  const fen = "rnbqkbnr/ppp1pppp/8/3pP3/8/8/PPPP1PPP/RNBQKBNR b KQkq d6 0 3";
  const engineResult = {
    gameState: "playing",
    from: index("e5"),
    to: index("d6"),
    promotion: null,
    score: 20,
    depth: 1,
    nodes: 1,
    alternatives: [{from: index("e5"), to: index("d6"), promotion: null, score: 20}]
  };
  const result = await loadContentHarness({
    fen,
    playerSide: "b",
    turn: "b",
    engineResult
  });

  assert.deepEqual(result.captured.args.slice(0, 4), [
    positionFromFen(fen),
    "b",
    15,
    index("d6")
  ]);
  assert.equal(result.captured.searchArgs[1], "b");
  assert.equal(result.captured.searchArgs[5], 15);
  assert.equal(result.captured.searchArgs[6], index("d6"));
  assert.equal(result.response.playerSide, "b");
});

test("content fallback turn detection remains available without bridge state", async () => {
  const fen = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
  const engineResult = {
    gameState: "playing",
    from: index("e2"),
    to: index("e4"),
    promotion: null,
    score: 20,
    depth: 1,
    nodes: 1,
    alternatives: [{from: index("e2"), to: index("e4"), promotion: null, score: 20}]
  };
  const result = await loadContentHarness({
    fen,
    playerSide: "w",
    turn: "w",
    engineResult
  });
  assert.equal(result.captured.args[1], "w");
});

test("moveKey maps UCI squares to engine indices", () => {
  assert.equal(moveKey("e2e4"), index("e2") + ":" + index("e4"));
});
