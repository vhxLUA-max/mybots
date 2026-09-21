(() => {
  if (window.__sudokuAutoPlayerLoaded) return;
  window.__sudokuAutoPlayerLoaded = true;

  const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
  let stopped = false;
  let busy = false;
  let currentSolution = null;
  let bridgeInjected = false;
  let requestId = 0;
  const pendingRequests = new Map();

  const pageBridge = `(() => {
    if (window.__sdaPageBridge) return;
    window.__sdaPageBridge = true;

    let webpackRequire;
    try {
      if (!self.webpackChunk || !Array.isArray(self.webpackChunk)) throw new Error("Sudoku.com Webpack runtime not found");
      self.webpackChunk.push([[Date.now()], {}, (require) => {
        webpackRequire = require;
      }]);
      if (typeof webpackRequire !== "function") throw new Error("Sudoku.com Webpack require was not exposed");

      const store = webpackRequire(62351)?.default;
      const actions = webpackRequire(80457);
      if (!store || !store.state || !actions?.bE || !actions?.E7) {
        throw new Error("Sudoku.com game store was not found");
      }

      const snapshot = () => {
        const game = store.state.currentGame;
        if (!game || !Array.isArray(game.values) || game.values.length !== 81) {
          throw new Error("Sudoku.com current game is not available");
        }

        return {
          board: game.values.map((cell) => Number(cell?.val) || 0),
          editable: game.values.map((cell) => Boolean(cell?.editable)),
          solution: typeof game.solution === "string"
            ? game.solution.split("").map((value) => Number(value) || 0)
            : Array.isArray(game.solution)
              ? game.solution.map((value) => Number(value) || 0)
              : null,
          selectedCell: store.state.selectedCell
        };
      };

      window.addEventListener("message", (event) => {
        if (event.source !== window) return;
        const message = event.data;
        if (!message || message.source !== "sda-content") return;

        try {
          if (message.action === "get") {
            window.postMessage({
              source: "sda-page",
              type: "response",
              id: message.id,
              state: snapshot()
            }, "*");
            return;
          }

          if (message.action === "set") {
            const index = Number(message.index);
            const digit = Number(message.digit);

            if (!Number.isInteger(index) || index < 0 || index >= 81) {
              throw new Error("Invalid Sudoku cell index");
            }
            if (!Number.isInteger(digit) || digit < 1 || digit > 9) {
              throw new Error("Invalid Sudoku digit");
            }

            store.dispatch(actions.bE.updateBoard, {
              type: actions.E7.select,
              value: index
            });
            store.dispatch(actions.bE.updateBoard, {
              type: actions.E7.value,
              value: digit
            });

            window.postMessage({
              source: "sda-page",
              type: "response",
              id: message.id,
              state: snapshot()
            }, "*");
          }
        } catch (error) {
          window.postMessage({
            source: "sda-page",
            type: "error",
            id: message.id,
            error: error instanceof Error ? error.message : String(error)
          }, "*");
        }
      });

      window.postMessage({ source: "sda-page", type: "ready" }, "*");
    } catch (error) {
      window.postMessage({
        source: "sda-page",
        type: "bridge-error",
        error: error instanceof Error ? error.message : String(error)
      }, "*");
    }
  })();`;

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;

    const message = event.data;
    if (!message || message.source !== "sda-page") return;

    if ((message.type === "response" || message.type === "error") && pendingRequests.has(message.id)) {
      const pending = pendingRequests.get(message.id);
      pendingRequests.delete(message.id);
      clearTimeout(pending.timer);

      if (message.type === "error") {
        pending.reject(new Error(message.error));
      } else {
        pending.resolve(message.state);
      }
    }
  });

  function injectBridge() {
    if (bridgeInjected) return;
    bridgeInjected = true;

    const script = document.createElement("script");
    script.textContent = pageBridge;
    (document.documentElement || document.head || document.body).appendChild(script);
    script.remove();
  }

  function requestPage(action, payload = {}) {
    injectBridge();

    return new Promise((resolve, reject) => {
      const id = ++requestId;
      const timer = setTimeout(() => {
        pendingRequests.delete(id);
        reject(new Error("Sudoku.com game bridge timed out"));
      }, 2000);

      pendingRequests.set(id, { resolve, reject, timer });

      window.postMessage({
        source: "sda-content",
        action,
        id,
        ...payload
      }, "*");
    });
  }

  const panel = document.createElement("div");
  panel.className = "sda-panel";
  panel.innerHTML = [
    '<div class="sda-title">Sudoku Auto Player</div>',
    '<div class="sda-status" id="sda-status">Ready</div>',
    '<div class="sda-row">',
    '<button class="sda-button" id="sda-scan">Scan</button>',
    '<button class="sda-button" id="sda-solve">Solve</button>',
    '</div>',
    '<div class="sda-row">',
    '<button class="sda-button sda-primary" id="sda-play">Auto Play</button>',
    '<button class="sda-button sda-stop" id="sda-stop">Stop</button>',
    '</div>',
    '<label class="sda-speed">Delay <input id="sda-delay" type="range" min="50" max="500" step="10" value="140"><span id="sda-delay-value">140ms</span></label>'
  ].join("");
  document.documentElement.appendChild(panel);

  const statusEl = panel.querySelector("#sda-status");
  const delayEl = panel.querySelector("#sda-delay");
  const delayValueEl = panel.querySelector("#sda-delay-value");

  const setStatus = (text) => {
    statusEl.textContent = text;
  };

  delayEl.addEventListener("input", () => {
    delayValueEl.textContent = delayEl.value + "ms";
  });

  function normalizeValue(value) {
    const number = Number(value);
    return Number.isInteger(number) && number >= 1 && number <= 9 ? number : 0;
  }

  function normalizeSolution(solution) {
    if (Array.isArray(solution)) {
      const values = solution.map(normalizeValue);
      return values.length === 81 && values.every(Boolean) ? values : null;
    }

    if (typeof solution === "string") {
      const values = solution.split("").map(normalizeValue);
      return values.length === 81 && values.every(Boolean) ? values : null;
    }

    return null;
  }

  function parseStoredGame() {
    const raw = localStorage.getItem("main_game");
    if (!raw) throw new Error("main_game was not found");

    let game;
    try {
      game = JSON.parse(raw);
    } catch {
      throw new Error("main_game is not valid JSON");
    }

    if (!Array.isArray(game.values) || game.values.length !== 81) {
      throw new Error("main_game.values does not contain 81 cells");
    }

    const board = game.values.map(value => normalizeValue(value?.val));
    const editable = game.values.map(value => Boolean(value?.editable));
    const solution = normalizeSolution(game.solution);

    return {
      board,
      editable,
      solution
    };
  }

  async function readGame() {
    try {
      const state = await requestPage("get");
      const board = state.board.map(normalizeValue);
      const editable = state.editable.map(Boolean);
      const solution = normalizeSolution(state.solution);

      if (board.length !== 81 || editable.length !== 81) {
        throw new Error("Sudoku.com current game does not contain 81 cells");
      }

      return { board, editable, solution };
    } catch (error) {
      const stored = parseStoredGame();
      return stored;
    }
  }

  function solveSudoku(input) {
    const board = input.map(row => row.slice());
    const rows = Array(9).fill(0);
    const cols = Array(9).fill(0);
    const boxes = Array(9).fill(0);
    const FULL = 0x1ff;

    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        const value = board[r][c];
        if (!value) continue;
        const bit = 1 << (value - 1);
        const box = Math.floor(r / 3) * 3 + Math.floor(c / 3);
        if ((rows[r] & bit) || (cols[c] & bit) || (boxes[box] & bit)) return null;
        rows[r] |= bit;
        cols[c] |= bit;
        boxes[box] |= bit;
      }
    }

    function search() {
      let bestR = -1;
      let bestC = -1;
      let bestMask = 0;
      let bestCount = 10;

      for (let r = 0; r < 9; r++) {
        for (let c = 0; c < 9; c++) {
          if (board[r][c]) continue;

          const box = Math.floor(r / 3) * 3 + Math.floor(c / 3);
          const mask = FULL & ~(rows[r] | cols[c] | boxes[box]);
          let count = 0;

          for (let bits = mask; bits; bits &= bits - 1) count++;

          if (count === 0) return false;

          if (count < bestCount) {
            bestCount = count;
            bestR = r;
            bestC = c;
            bestMask = mask;

            if (count === 1) break;
          }
        }

        if (bestCount === 1) break;
      }

      if (bestR === -1) return true;

      const box = Math.floor(bestR / 3) * 3 + Math.floor(bestC / 3);

      for (let mask = bestMask; mask; mask &= mask - 1) {
        const bit = mask & -mask;
        const value = 32 - Math.clz32(bit);

        board[bestR][bestC] = value;
        rows[bestR] |= bit;
        cols[bestC] |= bit;
        boxes[box] |= bit;

        if (search()) return true;

        board[bestR][bestC] = 0;
        rows[bestR] ^= bit;
        cols[bestC] ^= bit;
        boxes[box] ^= bit;
      }

      return false;
    }

    return search() ? board : null;
  }

  function boardFromFlat(values) {
    return Array.from({ length: 9 }, (_, row) => values.slice(row * 9, row * 9 + 9));
  }

  function getEditableCells(editable) {
    const cells = [];

    for (let i = 0; i < editable.length; i++) {
      if (editable[i]) cells.push(i);
    }

    return cells;
  }

  function validateSolution(board, solution) {
    if (!solution || solution.length !== 81 || solution.some(value => !normalizeValue(value))) {
      return false;
    }

    for (let i = 0; i < 81; i++) {
      if (board[i] && board[i] !== solution[i]) return false;
    }

    return solveSudoku(boardFromFlat(solution)) !== null;
  }

  function getSolution(game) {
    if (validateSolution(game.board, game.solution)) return game.solution;

    const solved = solveSudoku(boardFromFlat(game.board));
    return solved ? solved.flat() : null;
  }

  async function setCell(index, digit) {
    const state = await requestPage("set", { index, digit });
    if (!state || state.board?.[index] !== digit) {
      throw new Error("Move rejected at cell " + (index + 1) + ": expected " + digit);
    }
  }

  async function verifySolution(solution) {
    try {
      const state = await requestPage("get");
      return state.board.every((value, index) => normalizeValue(value) === solution[index]);
    } catch {
      return verifyStoredSolution(solution);
    }
  }

  function verifyStoredSolution(solution) {
    try {
      const game = parseStoredGame();
      return game.board.every((value, index) => value === solution[index]);
    } catch {
      return false;
    }
  }

  async function scan() {
    const game = await readGame();
    const empty = game.editable.filter((editable, index) => editable && game.board[index] === 0).length;
    const filled = game.board.filter(Boolean).length;
    const conflicts = game.boardFromFlat ? 0 : 0;
    setStatus("Scanned: " + empty + " empty, " + filled + " filled");
    return game;
  }

  async function solveOnly() {
    if (busy) return;

    try {
      const game = await readGame();
      const solution = getSolution(game);

      if (!solution) {
        throw new Error("The current board does not match a valid Sudoku solution");
      }

      currentSolution = solution;
      const editableEmpty = game.editable.filter((editable, index) => editable && game.board[index] === 0).length;
      setStatus("Solved: " + editableEmpty + " moves");
    } catch (error) {
      setStatus(error.message);
      currentSolution = null;
    }
  }

  async function autoPlay() {
    if (busy) return;

    busy = true;
    stopped = false;

    try {
      const game = await readGame();
      const solution = getSolution(game);

      if (!solution) {
        throw new Error("The current board does not match a valid Sudoku solution");
      }

      currentSolution = solution;
      const editableCells = getEditableCells(game.editable).filter(index => game.board[index] === 0);

      setStatus("Playing 0/" + editableCells.length);

      for (let i = 0; i < editableCells.length; i++) {
        if (stopped) {
          setStatus("Stopped at " + i + "/" + editableCells.length);
          return;
        }

        const index = editableCells[i];
        const digit = solution[index];

        await setCell(index, digit);
        await delay(Number(delayEl.value));

        setStatus("Playing " + (i + 1) + "/" + editableCells.length);
      }

      await delay(Math.max(100, Number(delayEl.value)));

      const finalState = await readGame();
      const correct = finalState.board.every((value, index) => value === solution[index]);

      if (!correct) {
        throw new Error("Verification failed: at least one cell does not match the calculated solution");
      }

      setStatus("Completed");
    } catch (error) {
      setStatus(error.message);
    } finally {
      busy = false;
    }
  }

  panel.querySelector("#sda-scan").addEventListener("click", () => {
    if (!busy) scan().catch(error => setStatus(error.message));
  });

  panel.querySelector("#sda-solve").addEventListener("click", solveOnly);

  panel.querySelector("#sda-play").addEventListener("click", autoPlay);

  panel.querySelector("#sda-stop").addEventListener("click", () => {
    stopped = true;
    if (!busy) setStatus("Stopped");
  });
})();
