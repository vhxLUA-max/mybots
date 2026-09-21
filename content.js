(() => {
  if (window.__chessMoveHelperLoaded) return;
  window.__chessMoveHelperLoaded = true;

  let hidden = false;
  let showAlternatives = true;
  let bookEnabled = true;
  let busy = false;
  let lastPositionKey = "";
  let lastResult = null;
  let lastBookName = "";
  let currentStatus = "Waiting for board...";
  let currentDetail = "Open a Chess.com board to begin.";

  function setStatus(status, detail) {
    currentStatus = status;
    currentDetail = detail || "";
  }

  function stateResponse() {
    return {
      ok: true,
      status: currentStatus,
      detail: currentDetail,
      hidden,
      showAlternatives,
      bookEnabled,
      bookName: lastBookName
    };
  }

  function getBoardElement() {
    return document.querySelector("wc-chess-board.board, wc-chess-board");
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

  function getCastlingRights(position) {
    let rights = 0;
    if (position[4] === "K" && position[7] === "R") rights |= 1;
    if (position[4] === "K" && position[0] === "R") rights |= 2;
    if (position[60] === "k" && position[63] === "r") rights |= 4;
    if (position[60] === "k" && position[56] === "r") rights |= 8;
    return rights;
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
    const activeClock = document.querySelector(".clock-component.clock-player-turn");
    if (activeClock?.classList.contains("clock-white")) return "w";
    if (activeClock?.classList.contains("clock-black")) return "b";

    const selected = document.querySelector("#analysis [data-node].selected, #analysis [data-node].selected *");
    const selectedNode = selected?.closest("[data-node]");

    if (selectedNode) {
      const value = selectedNode.getAttribute("data-node") || "";
      const numbers = value.match(/\d+/g);
      const moveNumber = numbers?.[numbers.length - 1];
      if (moveNumber !== undefined) return Number(moveNumber) % 2 === 0 ? "w" : "b";
    }

    const urlMove = new URL(location.href).searchParams.get("move");
    if (urlMove !== null && /^\d+$/.test(urlMove)) {
      return Number(urlMove) % 2 === 0 ? "w" : "b";
    }

    return "w";
  }

  function clearArrows(board) {
    board.querySelector(".cmh-arrow-layer")?.remove();
  }

  function classifyMove(move, index, bestScore, isBook) {
    if (index === 0) return "best";
    if (isBook) {
      const ratio = bestScore > 0 ? move.score / bestScore : 0;
      if (ratio >= 0.65) return "good";
      if (ratio >= 0.35) return "ok";
      return "bad";
    }

    const loss = bestScore - move.score;
    if (loss <= 30) return "good";
    if (loss <= 100) return "ok";
    return "bad";
  }

  function drawArrows(board, result) {
    clearArrows(board);
    if (hidden) return;

    const candidates = result.alternatives?.length
      ? result.alternatives
      : [result];
    const moves = showAlternatives ? candidates : [candidates[0]];
    const orientation = getOrientation(board);
    const categories = new Set();

    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.classList.add("cmh-arrow-layer");
    svg.setAttribute("viewBox", "0 0 100 100");

    const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
    for (const category of ["best", "good", "ok", "bad"]) {
      const marker = document.createElementNS("http://www.w3.org/2000/svg", "marker");
      marker.setAttribute("id", "cmh-arrow-head-" + category);
      marker.setAttribute("viewBox", "0 0 10 10");
      marker.setAttribute("refX", "8.5");
      marker.setAttribute("refY", "5");
      marker.setAttribute("markerWidth", "5");
      marker.setAttribute("markerHeight", "5");
      marker.setAttribute("orient", "auto");

      const head = document.createElementNS("http://www.w3.org/2000/svg", "path");
      head.classList.add("cmh-arrow-head", "cmh-" + category);
      head.setAttribute("d", "M 0 0 L 10 5 L 0 10 z");
      marker.appendChild(head);
      defs.appendChild(marker);
    }
    svg.appendChild(defs);

    moves.forEach((move, index) => {
      const category = classifyMove(move, index, result.score, result.book);
      categories.add(category);

      const source = indexToSquare(move.from);
      const target = indexToSquare(move.to);

      const sourceX = orientation.flipped ? 7 - source.file : source.file;
      const targetX = orientation.flipped ? 7 - target.file : target.file;
      const sourceY = orientation.flipped ? source.rank - 1 : 8 - source.rank;
      const targetY = orientation.flipped ? target.rank - 1 : 8 - target.rank;

      const sourcePoint = { x: sourceX * 12.5 + 6.25, y: sourceY * 12.5 + 6.25 };
      const targetPoint = { x: targetX * 12.5 + 6.25, y: targetY * 12.5 + 6.25 };

      const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
      line.setAttribute("x1", String(sourcePoint.x));
      line.setAttribute("y1", String(sourcePoint.y));
      line.setAttribute("x2", String(targetPoint.x));
      line.setAttribute("y2", String(targetPoint.y));
      line.setAttribute("marker-end", "url(#cmh-arrow-head-" + category + ")");
      line.classList.add("cmh-arrow", "cmh-" + category);
      svg.appendChild(line);
    });

    if (categories.size) board.appendChild(svg);
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

  async function lookupBook(position, side) {
    if (!bookEnabled) return null;

    try {
      const response = await chrome.runtime.sendMessage({
        type: "bookLookup",
        position,
        side,
        castlingRights: getCastlingRights(position)
      });

      if (!response?.ok || !response.found || !response.moves?.length) return null;

      return {
        from: response.moves[0].from,
        to: response.moves[0].to,
        promotion: response.moves[0].promotion,
        score: response.moves[0].score,
        depth: 0,
        nodes: 0,
        alternatives: response.moves,
        book: true,
        bookName: response.name
      };
    } catch {
      return null;
    }
  }

  async function scan() {
    if (busy) return stateResponse();
    busy = true;

    try {
      const board = getBoardElement();
      if (!board) {
        setStatus("No chessboard", "This page does not currently contain a Chess.com board.");
        return stateResponse();
      }

      const engine = window.__CMH_ENGINE__;
      if (!engine) {
        setStatus("Local engine loading", "The built-in engine has not finished loading yet.");
        return stateResponse();
      }

      const position = readPosition(board);
      const pieceCount = position.filter(Boolean).length;
      if (!pieceCount) {
        clearArrows(board);
        setStatus("Board not loaded", "Waiting for the pieces to appear.");
        return stateResponse();
      }

      const side = getSideToMove();
      const key = getPositionKey(position, side);

      if (key === lastPositionKey && board.querySelector(".cmh-arrow-layer")) return stateResponse();

      setStatus("Thinking...", "Checking the opening book before engine search.");
      await new Promise(resolve => setTimeout(resolve, 0));

      const bookResult = await lookupBook(position, side);
      const result = bookResult || engine.search(position, side, 4, 40000, 4);

      if (!result) {
        clearArrows(board);
        lastResult = null;
        lastBookName = "";
        lastPositionKey = key;
        setStatus("No legal move", "The current position has no legal move available.");
        return stateResponse();
      }

      lastResult = result;
      lastBookName = result.bookName || "";
      drawArrows(board, result);
      lastPositionKey = key;

      if (result.book) {
        setStatus(
          "Book " + moveName(result),
          (result.bookName || "Opening book") + " • " + (result.alternatives?.length || 1) + " book moves"
        );
      } else {
        setStatus(
          "Best " + moveName(result),
          "Depth " + result.depth + " • " + result.nodes + " nodes • " + (result.alternatives?.length || 1) + " candidates"
        );
      }

      return stateResponse();
    } finally {
      busy = false;
    }
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === "getState") {
      sendResponse(stateResponse());
      return;
    }

    if (message?.type === "scan") {
      scan()
        .then(sendResponse)
        .catch(error => sendResponse({ ok: false, error: error.message }));
      return true;
    }

    if (message?.type === "setHidden") {
      hidden = Boolean(message.value);
      const board = getBoardElement();
      if (hidden) {
        if (board) clearArrows(board);
        setStatus("Arrows hidden", "The local engine is still running.");
      } else if (board && lastResult) {
        drawArrows(board, lastResult);
        setStatus(
          lastResult.book ? "Book " + moveName(lastResult) : "Best " + moveName(lastResult),
          lastResult.book ? (lastResult.bookName || "Opening book") : "Depth " + lastResult.depth + " • " + lastResult.nodes + " nodes"
        );
      }
      sendResponse(stateResponse());
      return;
    }

    if (message?.type === "setAlternatives") {
      showAlternatives = Boolean(message.value);
      const board = getBoardElement();
      if (board && lastResult && !hidden) drawArrows(board, lastResult);
      sendResponse(stateResponse());
      return;
    }

    if (message?.type === "setBookEnabled") {
      bookEnabled = Boolean(message.value);
      lastPositionKey = "";
      scan().then(() => sendResponse(stateResponse())).catch(error => sendResponse({ok: false, error: error.message}));
      return true;
    }

    if (message?.type === "bookChanged") {
      lastPositionKey = "";
      lastBookName = "";
      scan().catch(() => {});
      sendResponse({ok: true});
      return;
    }
  });

  setInterval(() => {
    scan().catch(() => {});
  }, 900);

  scan().catch(() => {});
})();
