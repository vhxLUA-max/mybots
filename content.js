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

  function parseCell(cell) {
    const id = cell.id || "";
    const match = id.match(/^cell-(\\d)-(\\d)$/);
    if (!match) return null;
    const row = Number(match[1]);
    const col = Number(match[2]);
    let value = Number(cell.getAttribute("data-value") || 0);
    if (!Number.isInteger(value) || value < 1 || value > 9) value = 0;
    return { row, col, value, element: cell };
  }

  function readBoard() {
    const board = Array.from({ length: 9 }, () => Array(9).fill(0));
    const cells = Array.from(document.querySelectorAll(".sudoku-board .sudoku-cell"));
    if (cells.length !== 81) throw new Error("Expected 81 Sudoku cells, found " + cells.length);

    for (const cell of cells) {
      const parsed = parseCell(cell);
      if (!parsed) throw new Error("A Sudoku cell did not have the expected cell-r-c id");
      board[parsed.row][parsed.col] = parsed.value;
    }

    return board;
  }

  function findCell(row, col) {
    return document.getElementById("cell-" + row + "-" + col)
      || document.querySelector(".sudoku-board .sudoku-cell[aria-label^=\"Row " + (row + 1) + ", Column " + (col + 1) + "\"]");
  }

  function getDigitButton(digit) {
    return document.querySelector(".digit-button-" + digit);
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
          const count = 32 - Math.clz32(mask);
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

  function getEmptyCells(board) {
    const cells = [];
    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        if (board[r][c] === 0) cells.push({ row: r, col: c });
      }
    }
    return cells;
  }

  async function clickCell(cell) {
    if (!cell) throw new Error("Could not find a Sudoku cell");
    cell.click();
    await delay(30);
  }

  async function enterDigit(digit) {
    const button = getDigitButton(digit);
    if (!button) throw new Error("Could not find digit button " + digit);
    button.click();
  }

  async function scan() {
    currentSolution = null;
    const board = readBoard();
    const empty = getEmptyCells(board).length;
    setStatus("Scanned: " + empty + " empty");
    return board;
  }

  async function solveOnly() {
    if (busy) return;
    try {
      const board = await scan();
      const solution = solveSudoku(board);
      if (!solution) throw new Error("The current board is invalid or has no solution");
      currentSolution = solution;
      setStatus("Solved: " + getEmptyCells(board).length + " moves");
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
      const board = readBoard();
      const solution = solveSudoku(board);
      if (!solution) throw new Error("The current board is invalid or has no solution");

      currentSolution = solution;
      const emptyCells = getEmptyCells(board);
      setStatus("Playing 0/" + emptyCells.length);

      for (let i = 0; i < emptyCells.length; i++) {
        if (stopped) {
          setStatus("Stopped at " + i + "/" + emptyCells.length);
          return;
        }

        const { row, col } = emptyCells[i];
        const liveCell = findCell(row, col);
        const liveValue = Number(liveCell?.getAttribute("data-value") || 0);

        if (liveValue !== 0) {
          setStatus("Playing " + (i + 1) + "/" + emptyCells.length);
          continue;
        }

        await clickCell(liveCell);
        await enterDigit(solution[row][col]);
        await delay(Number(delayEl.value));

        setStatus("Playing " + (i + 1) + "/" + emptyCells.length);
      }

      const finalBoard = readBoard();
      const complete = finalBoard.every((row, r) => row.every((value, c) => value === solution[r][c]));
      setStatus(complete ? "Completed" : "Finished entering moves");
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
