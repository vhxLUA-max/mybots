(() => {
  if (window.__chessMoveHelperLoaded) return;
  window.__chessMoveHelperLoaded = true;

  const panel = document.createElement("div");
  panel.className = "cmh-panel";
  panel.innerHTML = [
    '<div class="cmh-title">Chess Move Helper</div>',
    '<div class="cmh-status" id="cmh-status">Waiting for board...</div>',
    '<div class="cmh-row">',
    '<button class="cmh-button cmh-primary" id="cmh-scan">Scan</button>',
    '<button class="cmh-button" id="cmh-hide">Hide</button>',
    '</div>'
  ].join("");
  document.documentElement.appendChild(panel);

  const statusEl = panel.querySelector("#cmh-status");
  let hidden = false;
  let busy = false;
  let lastPositionKey = "";

  const setStatus = (text) => {
    statusEl.textContent = text;
  };

  function getBoardElement() {
    return document.querySelector("wc-chess-board.board, wc-chess-board");
  }

  function isLiveGame() {
    return /^\/game\/live\//.test(location.pathname);
  }

  function isRestrictedPage() {
    return /^\/game\/live\//.test(location.pathname) ||
      /^\/play(?:\/|$)/.test(location.pathname) ||
      /^\/puzzles(?:\/|$)/.test(location.pathname);
  }

  function parseSquareNumber(value) {
    const number = Number(value);
    if (!Number.isInteger(number)) return null;
    const file = Math.floor(number / 10) - 1;
    const rank = number % 10;
    if (rank < 1 || rank > 8 || file < 0 || file > 7) return null;
    return { file, rank };
  }

  function squareIndex(square) {
    return (square.rank - 1) * 8 + square.file;
  }

  function indexToSquare(index) {
    return {
      file: index & 7,
      rank: Math.floor(index / 8) + 1
    };
  }

  function readPosition(board) {
    const pieces = Array(64).fill(null);

    for (const node of board.querySelectorAll(".piece")) {
      const squareClass = Array.from(node.classList).find(value => /^square-\d+$/.test(value));
      const pieceClass = Array.from(node.classList).find(value => /^[wb][pnbrqk]$/.test(value));
      if (!squareClass || !pieceClass) continue;

      const parsed = parseSquareNumber(squareClass.slice(7));
      if (!parsed) continue;

      pieces[squareIndex(parsed)] = pieceClass[0] === "w"
        ? pieceClass[1].toUpperCase()
        : pieceClass[1];
    }

    return pieces;
  }

  function getOrientation(board) {
    const labels = Array.from(board.querySelectorAll(".coordinates text"))
      .map(node => node.textContent.trim())
      .filter(Boolean);

    const rankLabels = labels.filter(value => /^[1-8]$/.test(value));
    const fileLabels = labels.filter(value => /^[a-h]$/.test(value));

    return {
      flipped: rankLabels[0] === "1" || fileLabels[0] === "h"
    };
  }

  function getSideToMove() {
    const selected = document.querySelector("#analysis [data-node].selected, #analysis [data-node].selected *");
    const selectedNode = selected?.closest("[data-node]");

    if (selectedNode) {
      const value = selectedNode.getAttribute("data-node") || "";
      const match = value.match(/-(\d+)$/);
      if (match) return Number(match[1]) % 2 === 0 ? "b" : "w";
    }

    const urlMove = new URL(location.href).searchParams.get("move");
    if (urlMove !== null && /^\d+$/.test(urlMove)) {
      return Number(urlMove) % 2 === 0 ? "w" : "b";
    }

    return "w";
  }

  function clearArrow(board) {
    board.querySelector(".cmh-arrow-layer")?.remove();
  }

  function drawArrow(board, move) {
    clearArrow(board);
    if (hidden) return;

    const orientation = getOrientation(board);
    const source = indexToSquare(move.from);
    const target = indexToSquare(move.to);

    const sourceX = orientation.flipped ? 7 - source.file : source.file;
    const targetX = orientation.flipped ? 7 - target.file : target.file;
    const sourceY = orientation.flipped ? source.rank - 1 : 8 - source.rank;
    const targetY = orientation.flipped ? target.rank - 1 : 8 - target.rank;

    const sourcePoint = { x: sourceX * 12.5 + 6.25, y: sourceY * 12.5 + 6.25 };
    const targetPoint = { x: targetX * 12.5 + 6.25, y: targetY * 12.5 + 6.25 };

    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.classList.add("cmh-arrow-layer");
    svg.setAttribute("viewBox", "0 0 100 100");

    const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
    const marker = document.createElementNS("http://www.w3.org/2000/svg", "marker");
    marker.setAttribute("id", "cmh-arrow-head");
    marker.setAttribute("viewBox", "0 0 10 10");
    marker.setAttribute("refX", "8.5");
    marker.setAttribute("refY", "5");
    marker.setAttribute("markerWidth", "5");
    marker.setAttribute("markerHeight", "5");
    marker.setAttribute("orient", "auto");

    const head = document.createElementNS("http://www.w3.org/2000/svg", "path");
    head.setAttribute("d", "M 0 0 L 10 5 L 0 10 z");
    head.setAttribute("fill", "currentColor");
    marker.appendChild(head);
    defs.appendChild(marker);
    svg.appendChild(defs);

    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", String(sourcePoint.x));
    line.setAttribute("y1", String(sourcePoint.y));
    line.setAttribute("x2", String(targetPoint.x));
    line.setAttribute("y2", String(targetPoint.y));
    line.setAttribute("marker-end", "url(#cmh-arrow-head)");
    line.classList.add("cmh-arrow");
    svg.appendChild(line);

    board.appendChild(svg);
  }

  function getPositionKey(position, side) {
    return position.map((piece, index) => piece ? index + ":" + piece : "").filter(Boolean).join("|") + "|" + side;
  }

  function moveName(move) {
    const files = "abcdefgh";
    return files[move.from & 7] + (Math.floor(move.from / 8) + 1) +
      files[move.to & 7] + (Math.floor(move.to / 8) + 1) +
      (move.promotion ? "=" + move.promotion : "");
  }

  async function scan() {
    if (busy) return;
    busy = true;

    try {
      const board = getBoardElement();
      if (!board) {
        setStatus("No chessboard on this page");
        return;
      }

      if (isRestrictedPage()) {
        clearArrow(board);
        setStatus(isLiveGame() ? "Live game hints disabled" : "Hints disabled on this page");
        lastPositionKey = "";
        return;
      }

      const engine = window.__CMH_ENGINE__;
      if (!engine) {
        setStatus("Local engine loading...");
        return;
      }

      const position = readPosition(board);
      const pieceCount = position.filter(Boolean).length;
      if (!pieceCount) {
        clearArrow(board);
        setStatus("Board not loaded");
        return;
      }

      const side = getSideToMove();
      const key = getPositionKey(position, side);

      if (key === lastPositionKey && board.querySelector(".cmh-arrow-layer")) return;

      setStatus("Thinking...");
      await new Promise(resolve => setTimeout(resolve, 0));

      const result = engine.search(position, side, 4, 40000);
      if (!result) {
        clearArrow(board);
        setStatus("No legal move");
        lastPositionKey = key;
        return;
      }

      drawArrow(board, result);
      lastPositionKey = key;
      setStatus(moveName(result) + " | depth " + result.depth + " | " + result.nodes + " nodes");
    } finally {
      busy = false;
    }
  }

  panel.querySelector("#cmh-scan").addEventListener("click", () => {
    scan().catch(error => setStatus(error.message));
  });

  panel.querySelector("#cmh-hide").addEventListener("click", () => {
    hidden = !hidden;
    const board = getBoardElement();

    if (hidden) {
      if (board) clearArrow(board);
      panel.querySelector("#cmh-hide").textContent = "Show";
      return;
    }

    panel.querySelector("#cmh-hide").textContent = "Hide";
    lastPositionKey = "";
    scan().catch(error => setStatus(error.message));
  });

  setInterval(() => {
    scan().catch(error => setStatus(error.message));
  }, 900);

  scan().catch(error => setStatus(error.message));
})();
