(() => {
  if (window.__sudokuAutoPlayerLoaded) return;
  window.__sudokuAutoPlayerLoaded = true;

  const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
  let stopped = false;
  let busy = false;
  let currentSolution = null;

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

  function readGame() {
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

    return { board, editable, solution };
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
    if (!solution || solution.length !== 81) return false;

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

  function getBoardCanvas() {
    const canvas = document.querySelector("#game canvas");
    if (!canvas) throw new Error("Sudoku board canvas was not found");
    return canvas;
  }

  async function selectCell(index) {
    const canvas = getBoardCanvas();
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) throw new Error("Sudoku board canvas has no visible size");

    const row = Math.floor(index / 9);
    const col = index % 9;
    const clientX = rect.left + ((col + 0.5) / 9) * rect.width;
    const clientY = rect.top + ((row + 0.5) / 9) * rect.height;

    canvas.dispatchEvent(new MouseEvent("mousedown", {
      bubbles: true,
      cancelable: true,
      clientX,
      clientY
    }));

    await delay(25);
  }

  async function enterDigit(digit) {
    const keyCode = 48 + digit;
    window.dispatchEvent(new KeyboardEvent("keydown", {
      key: String(digit),
      code: "Digit" + digit,
      keyCode,
      which: keyCode,
      bubbles: true,
      cancelable: true
    }));
    await delay(15);
  }

  function verifySolution(solution) {
    const raw = localStorage.getItem("main_game");
    if (!raw) return false;

    try {
      const game = JSON.parse(raw);
      if (!Array.isArray(game.values) || game.values.length !== 81) return false;
      return game.values.every((value, index) => normalizeValue(value?.val) === solution[index]);
    } catch {
      return false;
    }
  }

  async function scan() {
    const game = readGame();
    const empty = game.editable.filter((editable, index) => editable && game.board[index] === 0).length;
    setStatus("Scanned: " + empty + " empty");
    return game;
  }

  async function solveOnly() {
    if (busy) return;

    try {
      const game = await scan();
      const solution = getSolution(game);

      if (!solution) throw new Error("The current board does not match a valid Sudoku solution");

      currentSolution = solution;
      setStatus("Solved: " + game.editable.filter(Boolean).length + " editable cells");
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
      const game = readGame();
      const solution = getSolution(game);

      if (!solution) throw new Error("The current board does not match a valid Sudoku solution");

      currentSolution = solution;
      const editableCells = getEditableCells(game.editable);

      setStatus("Playing 0/" + editableCells.length);

      for (let i = 0; i < editableCells.length; i++) {
        if (stopped) {
          setStatus("Stopped at " + i + "/" + editableCells.length);
          return;
        }

        const index = editableCells[i];
        if (game.board[index] === 0) {
          await selectCell(index);
          await enterDigit(solution[index]);
          await delay(Number(delayEl.value));

          const liveGame = readGame();
          if (liveGame.board[index] !== solution[index]) {
            throw new Error("Move rejected at cell " + (index + 1) + ": expected " + solution[index] + ", found " + liveGame.board[index]);
          }

          game.board[index] = liveGame.board[index];
        }

        setStatus("Playing " + (i + 1) + "/" + editableCells.length);
      }

      await delay(Math.max(100, Number(delayEl.value)));
      setStatus(verifySolution(solution) ? "Completed" : "Finished entering moves");
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
