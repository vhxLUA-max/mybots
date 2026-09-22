(() => {
  if (window.__chessMoveHelperLoaded) return;
  window.__chessMoveHelperLoaded = true;

  const ARROW_COLORS = {
    best: "rgba(20, 160, 80, 0.75)",
    good: "rgba(90, 190, 120, 0.6)",
    human: "rgba(240, 170, 40, 0.75)",
    mistake: "rgba(240, 120, 40, 0.7)",
    blunder: "rgba(220, 50, 50, 0.75)",
    response: "rgba(60, 120, 220, 0.6)"
  };

  function arrowColor(cpEval, isHumanPick) {
    if (isHumanPick) return ARROW_COLORS.human;
    const cp = Math.abs(cpEval);
    if (cp < 30) return ARROW_COLORS.good;
    if (cp < 100) return ARROW_COLORS.best;
    if (cp < 250) return ARROW_COLORS.mistake;
    return ARROW_COLORS.blunder;
  }

  function arrowCategory(cpEval, isHumanPick) {
    if (isHumanPick) return "human";
    const cp = Math.abs(cpEval);
    if (cp < 30) return "good";
    if (cp < 100) return "best";
    if (cp < 250) return "mistake";
    return "blunder";
  }

  let hidden = false;
  let showAlternatives = true;
  let humanMode = false;
  let bookEnabled = true;
  let bookMode = "random";
  let engineDepth = 4;
  let busy = false;
  let lastPositionKey = "";
  let lastResult = null;
  let lastBookName = "";
  let currentGameId = "";
  let castlingRights = 0;
  let epSquare = null;
  let stateInitialized = false;
  let lastObservedPosition = null;
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
      humanMode,
      bookEnabled,
      bookMode,
      engineDepth,
      bookName: lastBookName,
      gameId: currentGameId
    };
  }

  function getBoardElement() {
    return document.querySelector("wc-chess-board.board, wc-chess-board");
  }

  function getGameId() {
    const match = location.pathname.match(/\/(?:game\/live|analysis\/game\/live|live\/game)\/(\d+)/);
    return match ? match[1] : "";
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

  function samePosition(a, b) {
    if (!a || !b || a.length !== b.length) return false;
    for (let index = 0; index < a.length; index++) {
      if (a[index] !== b[index]) return false;
    }
    return true;
  }

  function updatePositionState(position) {
    if (!stateInitialized) {
      castlingRights = getCastlingRights(position);
      epSquare = null;
      stateInitialized = true;
      lastObservedPosition = position.slice();
      return;
    }

    if (samePosition(lastObservedPosition, position)) return;

    if (lastObservedPosition[4] !== "K" || position[4] !== "K") castlingRights &= ~3;
    if (lastObservedPosition[60] !== "k" || position[60] !== "k") castlingRights &= ~12;
    if (lastObservedPosition[0] !== "R" || position[0] !== "R") castlingRights &= ~2;
    if (lastObservedPosition[7] !== "R" || position[7] !== "R") castlingRights &= ~1;
    if (lastObservedPosition[56] !== "r" || position[56] !== "r") castlingRights &= ~8;
    if (lastObservedPosition[63] !== "r" || position[63] !== "r") castlingRights &= ~4;

    epSquare = null;
    for (let from = 0; from < 64 && epSquare === null; from++) {
      const previousPiece = lastObservedPosition[from];
      if (!previousPiece || previousPiece.toUpperCase() !== "P" || position[from] === previousPiece) continue;
      for (let to = 0; to < 64; to++) {
        if (position[to] === previousPiece && lastObservedPosition[to] !== previousPiece &&
            Math.abs(to - from) === 16) {
          epSquare = (from + to) >> 1;
          break;
        }
      }
    }

    lastObservedPosition = position.slice();
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

  function formatEvaluation(score, side, isBook) {
    if (isBook) return "B " + Math.round(score);
    const whiteScore = side === "w" ? score : -score;
    if (whiteScore >= 990000 || whiteScore <= -990000) {
      const mateMoves = Math.max(1, Math.ceil((999999 - Math.abs(whiteScore)) / 2));
      return (whiteScore >= 0 ? "+" : "-") + "M" + mateMoves;
    }
    const pawns = whiteScore / 100;
    return (pawns >= 0 ? "+" : "") + pawns.toFixed(2);
  }

  function evaluationPercent(score, side) {
    const whiteScore = side === "w" ? score : -score;
    return Math.max(0.02, Math.min(0.98, 0.5 + 0.5 * Math.tanh(whiteScore / 400)));
  }

  function chooseHumanCandidate(result) {
    const candidates = (result.alternatives?.length
      ? result.alternatives
      : [result]).slice(0, 8);

    if (candidates.length <= 1) return candidates[0];

    const bestScore = result.score;
    const eligible = candidates.filter(move => result.book || bestScore - move.score <= 80);
    const pool = eligible.length ? eligible : candidates;
    const weighted = pool.map((move, index) => ({
      move,
      weight: result.book
        ? 1 / (index + 1)
        : Math.exp(-Math.max(0, bestScore - move.score) / 35) / (index + 1)
    }));
    const total = weighted.reduce((sum, entry) => sum + entry.weight, 0);
    let threshold = Math.random() * total;

    for (const entry of weighted) {
      threshold -= entry.weight;
      if (threshold <= 0) return entry.move;
    }

    return weighted[weighted.length - 1].move;
  }

  function getHumanDisplayMoves(result) {
    const candidates = (result.alternatives?.length
      ? result.alternatives
      : [result]).slice(0, 8);
    const humanMove = result.humanMove || chooseHumanCandidate(result);
    const bestMove = candidates[0];
    const used = new Set();
    const output = [];

    const add = (move, category) => {
      if (!move || used.has(move.from + ":" + move.to + ":" + (move.promotion || ""))) return;
      used.add(move.from + ":" + move.to + ":" + (move.promotion || ""));
      output.push({move, category});
    };

    add(bestMove, "best");

    const goodMove = candidates.find(move =>
      move !== bestMove &&
      bestMove.score - move.score > 0 &&
      bestMove.score - move.score <= 30
    );
    add(goodMove, "good");

    add(humanMove, "human");

    const mistakeMove = candidates.find(move => {
      const loss = bestMove.score - move.score;
      return move !== bestMove && move !== humanMove && loss > 100 && loss <= 250;
    });
    add(mistakeMove, "mistake");

    const blunderMove = candidates.find(move => {
      const loss = bestMove.score - move.score;
      return move !== bestMove && move !== humanMove && loss > 250;
    });
    add(blunderMove, "blunder");

    return {moves: output, humanMove};
  }

  function drawArrows(board, result, side = getSideToMove()) {
    clearArrows(board);
    if (hidden) return;

    const candidates = (result.alternatives?.length
      ? result.alternatives
      : [result]).slice(0, 8);
    const studySet = humanMode ? getHumanDisplayMoves(result) : null;
    const humanMove = result.humanMove || (humanMode ? studySet?.humanMove : null);
    const moves = humanMode
      ? studySet.moves.map(entry => entry.move)
      : (showAlternatives ? candidates : [candidates[0]]);
    const entries = humanMode
      ? studySet.moves.map((entry, index) => ({
        move: entry.move,
        index,
        isHumanPick: entry.category === "human",
        category: entry.category
      }))
      : moves.map((move, index) => ({
        move,
        index,
        isHumanPick: false,
        category: arrowCategory(move.score, false)
      }));
    const drawEntries = entries.sort((a, b) => {
      if (a.index === 0) return 1;
      if (b.index === 0) return -1;
      return a.index - b.index;
    });
    const orientation = getOrientation(board);

    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.classList.add("cmh-arrow-layer");
    svg.setAttribute("viewBox", "0 0 100 100");
    svg.setAttribute("shape-rendering", "geometricPrecision");

    const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
    const categories = [...new Set(entries.map(entry => entry.category))];
    const evaluationTrack = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    evaluationTrack.setAttribute("x", "98.2");
    evaluationTrack.setAttribute("y", "0.5");
    evaluationTrack.setAttribute("width", "1.3");
    evaluationTrack.setAttribute("height", "99");
    evaluationTrack.classList.add("cmh-eval-bar-track");
    svg.appendChild(evaluationTrack);

    if (!result.book) {
      const whiteRatio = evaluationPercent(result.score, side);
      const whiteHeight = whiteRatio * 99;
      const whiteY = orientation.flipped ? 0.5 : 99.5 - whiteHeight;
      const whiteBar = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      whiteBar.setAttribute("x", "98.2");
      whiteBar.setAttribute("y", String(whiteY));
      whiteBar.setAttribute("width", "1.3");
      whiteBar.setAttribute("height", String(whiteHeight));
      whiteBar.classList.add("cmh-eval-bar-white");
      svg.appendChild(whiteBar);

      const centerLine = document.createElementNS("http://www.w3.org/2000/svg", "line");
      centerLine.setAttribute("x1", "97.9");
      centerLine.setAttribute("x2", "99.8");
      centerLine.setAttribute("y1", "50");
      centerLine.setAttribute("y2", "50");
      centerLine.classList.add("cmh-eval-bar-center");
      svg.appendChild(centerLine);
    }

    const evaluationLabel = document.createElementNS("http://www.w3.org/2000/svg", "text");
    evaluationLabel.setAttribute("x", "97");
    evaluationLabel.setAttribute("y", "4.5");
    evaluationLabel.setAttribute("text-anchor", "end");
    evaluationLabel.textContent = formatEvaluation(result.score, side, result.book);
    evaluationLabel.classList.add("cmh-eval-score");
    if (result.book) evaluationLabel.classList.add("cmh-eval-book");
    svg.appendChild(evaluationLabel);
    for (const category of categories) {
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
      head.style.setProperty("fill", ARROW_COLORS[category], "important");
      marker.appendChild(head);
      defs.appendChild(marker);
    }
    svg.appendChild(defs);

    moves.forEach((move, index) => {
      const isHumanPick = humanMode && move === humanMove;
      const category = arrowCategory(move.score, isHumanPick);
      const color = arrowColor(move.score, isHumanPick);

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
      line.style.setProperty("stroke", color, "important");
      svg.appendChild(line);

      const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
      const dx = targetPoint.x - sourcePoint.x;
      const dy = targetPoint.y - sourcePoint.y;
      const length = Math.hypot(dx, dy) || 1;
      const normalX = -dy / length;
      const normalY = dx / length;
      const labelX = Math.max(7, Math.min(93, (sourcePoint.x + targetPoint.x) / 2 + normalX * 2.3));
      const labelY = Math.max(5, Math.min(95, (sourcePoint.y + targetPoint.y) / 2 + normalY * 2.3));
      label.setAttribute("x", String(labelX));
      label.setAttribute("y", String(labelY));
      label.setAttribute("text-anchor", "middle");
      label.setAttribute("dominant-baseline", "middle");
      label.textContent = formatEvaluation(move.score, side, result.book);
      label.classList.add("cmh-eval-label", "cmh-" + category);
      label.style.setProperty("fill", color, "important");
      svg.appendChild(label);
    });

    if (entries.length) board.appendChild(svg);
  }

  function getPositionKey(position, side) {
    return position.map((piece, index) => piece ? index + ":" + piece : "").filter(Boolean).join("|") +
      "|" + side + "|" + castlingRights + "|" + (epSquare ?? -1);
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
        bookMode,
        castlingRights,
        epFile: Number.isInteger(epSquare) ? epSquare & 7 : null
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
        bookName: response.name,
        bookSourceId: response.sourceId
      };
    } catch {
      return null;
    }
  }

  async function scan(force = false) {
    if (busy) return stateResponse();
    busy = true;

    try {
      const gameId = getGameId();
      if (gameId !== currentGameId) {
        currentGameId = gameId;
        lastPositionKey = "";
        lastResult = null;
        lastBookName = "";
        castlingRights = 0;
        epSquare = null;
        stateInitialized = false;
        lastObservedPosition = null;
        const existingBoard = getBoardElement();
        if (existingBoard) clearArrows(existingBoard);
      }

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
      updatePositionState(position);
      const gameState = engine.getGameState(position, side, castlingRights, epSquare);
      const key = getPositionKey(position, side);

      if (force) {
        lastPositionKey = "";
        lastBookName = "";
      }

      if (key === lastPositionKey && board.querySelector(".cmh-arrow-layer") &&
          (lastResult?.book || lastResult?.depth === engineDepth)) return stateResponse();

      setStatus("Thinking...", "Checking the opening book before engine search.");
      await new Promise(resolve => setTimeout(resolve, 0));

      if (gameState === "checkmate" || gameState === "stalemate") {
        clearArrows(board);
        lastResult = null;
        lastBookName = "";
        lastPositionKey = key;
        setStatus(gameState === "checkmate" ? "Checkmate" : "Stalemate", "No legal moves remain.");
        return stateResponse();
      }

      const bookResult = await lookupBook(position, side);
      const nodeLimit = ({2: 25000, 3: 50000, 4: 100000, 5: 220000, 6: 400000})[engineDepth] || 100000;
      const result = bookResult || engine.search(
        position,
        side,
        engineDepth,
        nodeLimit,
        humanMode ? 8 : 4,
        castlingRights,
        epSquare
      );

      if (!result) {
        clearArrows(board);
        lastResult = null;
        lastBookName = "";
        lastPositionKey = key;
        setStatus("No legal move", "The current position has no legal move available.");
        return stateResponse();
      }

      const displayResult = humanMode
        ? {...result, humanMove: chooseHumanCandidate(result)}
        : result;
      lastResult = displayResult;
      lastBookName = result.bookName || "";
      drawArrows(board, displayResult, side);
      lastPositionKey = key;

      if (result.book) {
        setStatus(
          humanMode ? "Study candidate " + moveName(displayResult.humanMove || result) : "Book " + moveName(result),
          (result.bookName || "Opening book") + " • " + (result.alternatives?.length || 1) + " book moves"
        );
      } else {
        setStatus(
          humanMode ? "Study candidate " + moveName(displayResult.humanMove || result) : "Best " + moveName(result),
          humanMode
            ? "Engine-assisted study candidates"
            : "Depth " + result.depth + " • " + result.nodes + " nodes • " + (result.alternatives?.length || 1) + " candidates"
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
      scan(true)
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
        drawArrows(board, lastResult, getSideToMove());
        setStatus(
          lastResult.book
            ? (humanMode ? "Study candidate " + moveName(lastResult.humanMove || lastResult) : "Book " + moveName(lastResult))
            : (humanMode ? "Study candidate " + moveName(lastResult.humanMove || lastResult) : "Best " + moveName(lastResult)),
          lastResult.book
            ? (lastResult.bookName || "Opening book")
            : "Depth " + lastResult.depth + " • " + lastResult.nodes + " nodes"
        );
      }
      sendResponse(stateResponse());
      return;
    }

    if (message?.type === "setHumanMode") {
      humanMode = Boolean(message.value);
      lastPositionKey = "";
      scan().then(() => sendResponse(stateResponse())).catch(error => sendResponse({ok: false, error: error.message}));
      return true;
    }

    if (message?.type === "setAlternatives") {
      showAlternatives = Boolean(message.value);
      const board = getBoardElement();
      if (board && lastResult && !hidden) drawArrows(board, lastResult, getSideToMove());
      sendResponse(stateResponse());
      return;
    }

    if (message?.type === "setEngineDepth") {
      const value = Number(message.value);
      if (!Number.isInteger(value) || value < 2 || value > 6) {
        sendResponse({ok: false, error: "Engine depth must be between 2 and 6."});
        return;
      }
      engineDepth = value;
      scan().then(() => sendResponse(stateResponse())).catch(error => sendResponse({ok: false, error: error.message}));
      return true;
    }

    if (message?.type === "setBookEnabled") {
      bookEnabled = Boolean(message.value);
      lastPositionKey = "";
      scan().then(() => sendResponse(stateResponse())).catch(error => sendResponse({ok: false, error: error.message}));
      return true;
    }

    if (message?.type === "setBookMode") {
      bookMode = message.value || "random";
      lastPositionKey = "";
      lastBookName = "";
      scan(true).then(() => sendResponse(stateResponse())).catch(error => sendResponse({ok: false, error: error.message}));
      return true;
    }

    if (message?.type === "bookChanged") {
      lastPositionKey = "";
      lastBookName = "";
      scan(true).catch(() => {});
      sendResponse({ok: true});
      return;
    }
  });

  setInterval(() => {
    scan().catch(() => {});
  }, 900);

  scan().catch(() => {});
})();
