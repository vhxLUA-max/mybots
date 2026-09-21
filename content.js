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

  function parseSquareNumber(value) {
    const number = Number(value);
    if (!Number.isInteger(number)) return null;
    const rank = Math.floor(number / 10);
    const file = number % 10 - 1;
    if (rank < 1 || rank > 8 || file < 0 || file > 7) return null;
    return { file, rank };
  }

  function squareIndex(square) {
    return (square.rank - 1) * 8 + square.file;
  }

  function indexToSquare(index) {
    return {
      file: index % 8,
      rank: Math.floor(index / 8) + 1
    };
  }

  function readPosition(board) {
    const pieces = Array(64).fill(null);
    const pieceNodes = board.querySelectorAll(".piece");

    for (const node of pieceNodes) {
      const squareClass = Array.from(node.classList).find(value => /^square-\d+$/.test(value));
      const pieceClass = Array.from(node.classList).find(value => /^[wb][pnbrqk]$/.test(value));
      if (!squareClass || !pieceClass) continue;

      const square = parseSquareNumber(squareClass.slice(7));
      if (!square) continue;

      const piece = pieceClass[0] === "w" ? pieceClass[1].toUpperCase() : pieceClass[1];
      pieces[squareIndex(square)] = piece;
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

    return "w";
  }

  function getEngineLine() {
    const node = document.querySelector("#moves-0.analysis-moves, #analysis .analysis-moves");
    if (!node) return null;

    const text = node.textContent.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
    if (!text) return null;

    const firstToken = text
      .replace(/^\d+\s*\.\.\.\s*/, "")
      .replace(/^\d+\s*\.\s*/, "")
      .trim()
      .split(" ")[0];

    if (!firstToken) return null;

    const depthText = document.querySelector("#stockfish-depth, .stockfish-info")?.textContent || "";
    const depthMatch = depthText.match(/depth\s*=\s*(\d+)/i);

    return {
      line: text,
      san: firstToken,
      depth: depthMatch ? Number(depthMatch[1]) : null
    };
  }

  function pathClear(position, source, target) {
    const df = Math.sign(target.file - source.file);
    const dr = Math.sign(target.rank - source.rank);
    let file = source.file + df;
    let rank = source.rank + dr;

    while (file !== target.file || rank !== target.rank) {
      if (position[(rank - 1) * 8 + file]) return false;
      file += df;
      rank += dr;
    }

    return true;
  }

  function movementMatches(piece, source, target, san) {
    const df = target.file - source.file;
    const dr = target.rank - source.rank;
    const adf = Math.abs(df);
    const adr = Math.abs(dr);
    const side = piece === piece.toUpperCase() ? "w" : "b";

    if (piece.toUpperCase() === "P") {
      const direction = side === "w" ? 1 : -1;
      const startRank = side === "w" ? 2 : 7;
      if (san.includes("x")) return adf === 1 && dr === direction;
      return df === 0 && (dr === direction || (dr === 2 * direction && source.rank === startRank));
    }

    if (piece.toUpperCase() === "N") return (adf === 1 && adr === 2) || (adf === 2 && adr === 1);
    if (piece.toUpperCase() === "K") return Math.max(adf, adr) === 1;
    if (piece.toUpperCase() === "B") return adf === adr && adf > 0;
    if (piece.toUpperCase() === "R") return (df === 0 || dr === 0) && (df !== 0 || dr !== 0);
    if (piece.toUpperCase() === "Q") return ((adf === adr) && adf > 0) || (df === 0 || dr === 0) && (df !== 0 || dr !== 0);

    return false;
  }

  function isSquareAttacked(position, targetIndex, bySide) {
    const target = indexToSquare(targetIndex);
    const pawn = bySide === "w" ? "P" : "p";
    const pawnRank = bySide === "w" ? target.rank - 1 : target.rank + 1;
    for (const file of [target.file - 1, target.file + 1]) {
      if (file < 0 || file > 7 || pawnRank < 1 || pawnRank > 8) continue;
      if (position[(pawnRank - 1) * 8 + file] === pawn) return true;
    }

    const knight = bySide === "w" ? "N" : "n";
    for (const [df, dr] of [[1,2],[2,1],[-1,2],[-2,1],[1,-2],[2,-1],[-1,-2],[-2,-1]]) {
      const file = target.file + df;
      const rank = target.rank + dr;
      if (file < 0 || file > 7 || rank < 1 || rank > 8) continue;
      if (position[(rank - 1) * 8 + file] === knight) return true;
    }

    const king = bySide === "w" ? "K" : "k";
    for (const df of [-1, 0, 1]) {
      for (const dr of [-1, 0, 1]) {
        if (!df && !dr) continue;
        const file = target.file + df;
        const rank = target.rank + dr;
        if (file < 0 || file > 7 || rank < 1 || rank > 8) continue;
        if (position[(rank - 1) * 8 + file] === king) return true;
      }
    }

    for (const [df, dr, first, second] of [
      [1,0,"R","Q"],[-1,0,"R","Q"],[0,1,"R","Q"],[0,-1,"R","Q"],
      [1,1,"B","Q"],[1,-1,"B","Q"],[-1,1,"B","Q"],[-1,-1,"B","Q"]
    ]) {
      let file = target.file + df;
      let rank = target.rank + dr;
      while (file >= 0 && file < 8 && rank >= 1 && rank <= 8) {
        const piece = position[(rank - 1) * 8 + file];
        if (piece) {
          const normalized = piece.toUpperCase();
          const isAttacker = piece === (bySide === "w" ? first : first.toLowerCase()) ||
            piece === (bySide === "w" ? second : second.toLowerCase());
          if (isAttacker) return true;
          break;
        }
        file += df;
        rank += dr;
      }
    }

    return false;
  }

  function moveWouldLeaveKingInCheck(position, sourceIndex, targetIndex, promotion) {
    const next = position.slice();
    const moving = next[sourceIndex];
    next[sourceIndex] = null;

    const source = indexToSquare(sourceIndex);
    const target = indexToSquare(targetIndex);

    if (moving && moving.toUpperCase() === "P" && source.file !== target.file && !next[targetIndex]) {
      const capturedIndex = (source.rank === (moving === "P" ? 5 : 4))
        ? (source.rank - 1) * 8 + target.file
        : (source.rank + 1) * 8 + target.file;
      if (next[capturedIndex] && next[capturedIndex].toUpperCase() === "P") next[capturedIndex] = null;
    }

    next[targetIndex] = promotion
      ? (moving === "P" ? promotion.toUpperCase() : promotion.toLowerCase())
      : moving;

    let kingIndex = -1;
    const king = moving === moving?.toUpperCase() ? "K" : "k";
    for (let i = 0; i < next.length; i++) {
      if (next[i] === king) {
        kingIndex = i;
        break;
      }
    }

    if (kingIndex === -1) return false;
    return isSquareAttacked(next, kingIndex, king === "K" ? "b" : "w");
  }

  function parseSanMove(san, position, side) {
    let value = san.replace(/[!?]+$/g, "").replace(/[+#]+$/g, "");
    if (/^(O-O|0-0)$/i.test(value)) {
      return side === "w" ? { source: { file: 4, rank: 1 }, target: { file: 6, rank: 1 }, san } :
        { source: { file: 4, rank: 8 }, target: { file: 6, rank: 8 }, san };
    }
    if (/^(O-O-O|0-0-0)$/i.test(value)) {
      return side === "w" ? { source: { file: 4, rank: 1 }, target: { file: 2, rank: 1 }, san } :
        { source: { file: 4, rank: 8 }, target: { file: 2, rank: 8 }, san };
    }

    const promotionMatch = value.match(/=([QRBN])$/i);
    const promotion = promotionMatch ? promotionMatch[1].toUpperCase() : null;
    if (promotion) value = value.slice(0, -2);

    const destinationMatch = value.match(/([a-h][1-8])$/i);
    if (!destinationMatch) return null;

    const destination = {
      file: destinationMatch[1].toLowerCase().charCodeAt(0) - 97,
      rank: Number(destinationMatch[1][1])
    };

    let prefix = value.slice(0, destinationMatch.index);
    const capture = prefix.includes("x");
    prefix = prefix.replace("x", "");

    let pieceType = "P";
    if (/^[KQRBN]/i.test(prefix)) {
      pieceType = prefix[0].toUpperCase();
      prefix = prefix.slice(1);
    }

    const disFile = prefix.length === 1 && /[a-h]/i.test(prefix) ? prefix.toLowerCase() : null;
    const disRank = prefix.length === 1 && /[1-8]/.test(prefix) ? Number(prefix) : null;

    const candidates = [];
    for (let index = 0; index < position.length; index++) {
      const piece = position[index];
      if (!piece || piece.toUpperCase() !== pieceType) continue;
      if ((side === "w" && piece !== piece.toUpperCase()) || (side === "b" && piece !== piece.toLowerCase())) continue;

      const source = indexToSquare(index);
      if (disFile && source.file !== disFile.charCodeAt(0) - 97) continue;
      if (disRank && source.rank !== disRank) continue;
      if (!movementMatches(piece, source, destination, capture ? "x" : "")) continue;

      if (pieceType !== "N" && pieceType !== "K" && pieceType !== "P" && !pathClear(position, source, destination)) continue;
      if (pieceType === "P" && !capture && source.file !== destination.file) continue;
      if (pieceType === "P" && Math.abs(destination.rank - source.rank) === 2) {
        const middle = (source.rank + destination.rank) / 2;
        if (position[(middle - 1) * 8 + source.file]) continue;
      }

      const targetIndex = squareIndex(destination);
      if (moveWouldLeaveKingInCheck(position, index, targetIndex, promotion)) continue;
      candidates.push({ source, target: destination, san });
    }

    return candidates[0] || null;
  }

  function clearArrow(board) {
    board.querySelector(".cmh-arrow-layer")?.remove();
  }

  function drawArrow(board, move) {
    clearArrow(board);
    if (hidden) return;

    const orientation = getOrientation(board);
    const sourceX = orientation.flipped ? 7 - move.source.file : move.source.file;
    const targetX = orientation.flipped ? 7 - move.target.file : move.target.file;
    const sourceY = orientation.flipped ? move.source.rank - 1 : 8 - move.source.rank;
    const targetY = orientation.flipped ? move.target.rank - 1 : 8 - move.target.rank;

    const sourcePoint = { x: sourceX * 12.5 + 6.25, y: sourceY * 12.5 + 6.25 };
    const targetPoint = { x: targetX * 12.5 + 6.25, y: targetY * 12.5 + 6.25 };

    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.className.baseVal = "cmh-arrow-layer";
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
    line.setAttribute("class", "cmh-arrow");
    svg.appendChild(line);

    board.appendChild(svg);
  }

  function getPositionKey(position, side) {
    return position.map((piece, index) => piece ? index + ":" + piece : "").filter(Boolean).join("|") + "|" + side;
  }

  function moveName(move) {
    const files = "abcdefgh";
    return files[move.source.file] + move.source.rank + files[move.target.file] + move.target.rank;
  }

  async function scan() {
    if (busy) return;
    busy = true;

    try {
      const board = getBoardElement();
      if (!board) {
        setStatus("Waiting for Chess.com board...");
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
      const engine = getEngineLine();

      if (!engine) {
        clearArrow(board);
        setStatus("Waiting for Stockfish...");
        lastPositionKey = key;
        return;
      }

      if (key === lastPositionKey && board.querySelector(".cmh-arrow-layer")) {
        return;
      }

      const move = parseSanMove(engine.san, position, side);
      if (!move) {
        clearArrow(board);
        setStatus("Could not map " + engine.san + " on this position");
        lastPositionKey = key;
        return;
      }

      drawArrow(board, move);
      lastPositionKey = key;
      setStatus(engine.san + " (" + moveName(move) + ")" + (engine.depth ? " | depth " + engine.depth : ""));
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
    if (!board) return;

    if (hidden) {
      clearArrow(board);
      panel.querySelector("#cmh-hide").textContent = "Show";
      return;
    }

    panel.querySelector("#cmh-hide").textContent = "Hide";
    lastPositionKey = "";
    scan().catch(error => setStatus(error.message));
  });

  setInterval(() => {
    scan().catch(error => setStatus(error.message));
  }, 700);

  scan().catch(error => setStatus(error.message));
})();
