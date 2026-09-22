(() => {
  if (window.__chessMoveHelperLoaded) return;
  window.__chessMoveHelperLoaded = true;

  const ARROW_COLORS = {
    best: "rgba(20, 160, 80, 0.75)",
    good: "rgba(90, 190, 120, 0.6)",
    human: "rgba(240, 170, 40, 0.75)",
    mistake: "rgba(240, 120, 40, 0.7)",
    blunder: "rgba(220, 50, 50, 0.75)",
    response: "rgba(60, 120, 220, 0.6)",
    ok: "rgba(240, 170, 40, 0.6)"
  };

  function arrowColor(move, bestScore, isHumanPick, isBook) {
    const category = arrowCategory(move, bestScore, isHumanPick, isBook);
    return ARROW_COLORS[category];
  }

  function arrowCategory(move, bestScore, isHumanPick, isBook) {
    if (isHumanPick) return "human";
    if (isBook) return "good";
    const loss = Math.max(0, bestScore - move.score);
    if (loss <= 20) return "best";
    if (loss <= 50) return "good";
    if (loss <= 100) return "ok";
    if (loss <= 250) return "mistake";
    return "blunder";
  }

  let hidden = false;
  let showAlternatives = true;
  let humanMode = false;
  let humanRating = null;
  let opponentRating = null;
  let gameMode = null;
  let humanConfidence = null;
  let playerSide = null;
  let sideToMove = null;
  let bookEnabled = true;
  let bookMode = "random";
  let engineMode = "maia";
  let busy = false;
  let scanQueuedWhileBusy = false;
  let scanTimer = null;
  let observedBoard = null;
  let boardObserver = null;
  let engineWorker = null;
  let engineWorkerFailed = false;
  let engineWorkerRequestId = 0;
  const engineWorkerPending = new Map();
  let lastMetadataRefreshAt = 0;
  let metadataBoard = null;
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

  function buildAnalysisCandidates(result, side) {
    const candidates = (result?.alternatives?.length ? result.alternatives : result ? [result] : []).slice(0, 6);
    const bestScore = candidates[0]?.score ?? result?.score ?? 0;

    return candidates.map((move, index) => ({
      move: moveName(move),
      evaluation: result?.book
        ? "Book"
        : formatEvaluation(move.score, side, false, Boolean(result?.maia)),
      loss: result?.book ? null : Math.max(0, move.loss ?? bestScore - move.score),
      lossUnit: result?.maia ? "pp" : result?.book ? "book" : "cp",
      category: arrowCategory(move, bestScore, move === result?.humanMove, Boolean(result?.book))
    }));
  }

  function analysisState() {
    const result = lastResult;
    if (!result || !sideToMove) {
      return {
        source: null,
        evaluation: null,
        mate: null,
        pv: "",
        bookName: "",
        candidates: []
      };
    }

    return {
      source: result.book
        ? "Opening book"
        : result.stockfish
          ? "Stockfish 19 Lite"
          : "Maia 3 • Human predictor",
      evaluation: result.book
        ? "BOOK"
        : formatEvaluation(result.score, sideToMove, false, Boolean(result.maia)),
      mate: result.mate ?? null,
      pv: result.book ? "" : formatPrincipalVariation(result.pv),
      bookName: result.bookName || "",
      candidates: buildAnalysisCandidates(result, sideToMove)
    };
  }

  function stateResponse() {
    const analysis = analysisState();
    return {
      ok: true,
      status: currentStatus,
      detail: currentDetail,
      hidden,
      showAlternatives,
      humanMode,
      humanRating,
      opponentRating,
      gameMode,
      humanConfidence,
      playerSide,
      sideToMove,
      isPlayerTurn: playerSide && sideToMove ? playerSide === sideToMove : null,
      bookEnabled,
      bookMode,
      engineMode,
      bookName: lastBookName,
      gameId: currentGameId,
      analysisSource: analysis.source,
      analysisEvaluation: analysis.evaluation,
      analysisMate: analysis.mate,
      analysisPV: analysis.pv,
      analysisBookName: analysis.bookName,
      analysisCandidates: analysis.candidates
    };
  }

  function getBoardElement() {
    return document.querySelector("wc-chess-board.board, wc-chess-board");
  }

  function getEngineWorker() {
    if (engineWorker || engineWorkerFailed) return engineWorker;

    try {
      engineWorker = new Worker(chrome.runtime.getURL("engine-worker.js"));
      engineWorker.onmessage = event => {
        const {taskId, ok, result, error} = event.data || {};
        const pending = engineWorkerPending.get(taskId);
        if (!pending) return;
        engineWorkerPending.delete(taskId);
        if (ok) pending.resolve(result);
        else pending.reject(new Error(error || "Engine worker error."));
      };
      engineWorker.onerror = error => {
        for (const pending of engineWorkerPending.values()) {
          pending.reject(new Error(error.message || "Engine worker stopped."));
        }
        engineWorkerPending.clear();
        engineWorker.terminate();
        engineWorker = null;
        engineWorkerFailed = true;
      };
      return engineWorker;
    } catch {
      engineWorker = null;
      engineWorkerFailed = true;
      return null;
    }
  }

  function requestEngineInBackground(type, payload) {
    return new Promise((resolve, reject) => {
      try {
        chrome.runtime.sendMessage(
          {
            type: "engineTask",
            task: type,
            payload
          },
          response => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
              return;
            }
            if (!response?.ok) {
              reject(new Error(response?.error || "Engine service unavailable."));
              return;
            }
            resolve(response.result);
          }
        );
      } catch (error) {
        reject(error);
      }
    });
  }

  let stockfishWorker = null;
  let stockfishWorkerFailed = false;
  let stockfishWorkerRequestId = 0;
  const stockfishWorkerPending = new Map();

  function getStockfishWorker() {
    if (stockfishWorker || stockfishWorkerFailed) return stockfishWorker;

    try {
      stockfishWorker = new Worker(chrome.runtime.getURL("stockfish-worker.js"));
      stockfishWorker.onmessage = event => {
        const {taskId, ok, result, error} = event.data || {};
        const pending = stockfishWorkerPending.get(taskId);
        if (!pending) return;
        stockfishWorkerPending.delete(taskId);
        if (ok) pending.resolve(result);
        else pending.reject(new Error(error || "Stockfish worker error."));
      };
      stockfishWorker.onerror = error => {
        for (const pending of stockfishWorkerPending.values()) {
          pending.reject(new Error(error.message || "Stockfish worker stopped."));
        }
        stockfishWorkerPending.clear();
        stockfishWorker.terminate();
        stockfishWorker = null;
        stockfishWorkerFailed = true;
      };
      return stockfishWorker;
    } catch {
      stockfishWorker = null;
      stockfishWorkerFailed = true;
      return null;
    }
  }

  function requestStockfish(fen, depth = 16, alternativeCount = 4) {
    const worker = getStockfishWorker();
    if (!worker) return Promise.reject(new Error("Stockfish worker is unavailable."));

    return new Promise((resolve, reject) => {
      const taskId = ++stockfishWorkerRequestId;
      stockfishWorkerPending.set(taskId, {resolve, reject});

      try {
        worker.postMessage({
          type: "stockfishSearch",
          taskId,
          fen,
          depth,
          multiPV: alternativeCount
        });
      } catch (error) {
        stockfishWorkerPending.delete(taskId);
        reject(error);
      }
    });
  }

  function positionToFen(position, side, rights, ep) {
    const ranks = [];

    for (let rank = 8; rank >= 1; rank--) {
      let empty = 0;
      let row = "";

      for (let file = 0; file < 8; file++) {
        const piece = position[(rank - 1) * 8 + file];
        if (!piece) {
          empty++;
          continue;
        }
        if (empty) {
          row += empty;
          empty = 0;
        }
        row += piece;
      }

      if (empty) row += empty;
      ranks.push(row);
    }

    const castling =
      (rights & 1 ? "K" : "") +
      (rights & 2 ? "Q" : "") +
      (rights & 4 ? "k" : "") +
      (rights & 8 ? "q" : "");

    let epSquare = "-";
    if (Number.isInteger(ep)) {
      const files = "abcdefgh";
      epSquare = files[ep & 7] + (Math.floor(ep / 8) + 1);
    }

    return ranks.join("/") + " " + side + " " + (castling || "-") + " " + epSquare + " 0 1";
  }

  function isLiveGamePage() {
    return /^\/(?:game\/live|live\/game)\//.test(location.pathname);
  }

  function requestEngine(type, payload) {
    const worker = getEngineWorker();

    if (!worker) return requestEngineInBackground(type, payload);

    return new Promise((resolve, reject) => {
      const taskId = ++engineWorkerRequestId;
      engineWorkerPending.set(taskId, {resolve, reject});

      try {
        worker.postMessage({type, taskId, ...payload});
      } catch (error) {
        engineWorkerPending.delete(taskId);
        engineWorker = null;
        engineWorkerFailed = true;
        requestEngineInBackground(type, payload).then(resolve, reject);
      }
    }).catch(error => {
      engineWorker = null;
      return requestEngineInBackground(type, payload).catch(fallbackError => {
        throw new Error(error.message + " | " + fallbackError.message);
      });
    });
  }

  function scheduleScan(force = false) {
    if (scanTimer !== null) clearTimeout(scanTimer);
    scanTimer = setTimeout(() => {
      scanTimer = null;
      scan(force).catch(() => {});
    }, force ? 0 : 120);
  }

  function observeBoard(board) {
    if (board === observedBoard) return;

    boardObserver?.disconnect();
    observedBoard = board || null;
    if (!board) return;

    boardObserver = new MutationObserver(() => scheduleScan());
    boardObserver.observe(board, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-cmh-fen"]
    });
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
      let squareClass = null;
      let pieceClass = null;

      for (const value of node.classList) {
        if (/^square-\d+$/.test(value)) squareClass = value;
        else if (/^[wb][pnbrqk]$/.test(value)) pieceClass = value;
      }

      if (!squareClass || !pieceClass) continue;

      const parsed = parseSquareNumber(squareClass.slice(7));
      if (!parsed) continue;

      pieces[squareIndex(parsed)] = pieceClass[0] === "w"
        ? pieceClass[1].toUpperCase()
        : pieceClass[1];
    }

    return pieces;
  }

  function readFenState(board) {
    const fen = board?.getAttribute("data-cmh-fen");
    if (!fen) return null;

    const fields = fen.trim().split(/\s+/);
    if (fields.length < 4) return null;

    const ranks = fields[0].split("/");
    if (ranks.length !== 8 || !/^[wb]$/.test(fields[1])) return null;

    const position = Array(64).fill(null);
    for (let rankIndex = 0; rankIndex < 8; rankIndex++) {
      let file = 0;
      for (const symbol of ranks[rankIndex]) {
        if (/[1-8]/.test(symbol)) {
          file += Number(symbol);
          continue;
        }
        if (!/[prnbqkPRNBQK]/.test(symbol) || file >= 8) return null;
        position[(7 - rankIndex) * 8 + file] = symbol === symbol.toUpperCase()
          ? symbol
          : symbol;
        file++;
      }
      if (file !== 8) return null;
    }

    let rights = 0;
    if (fields[2] !== "-") {
      if (fields[2].includes("K")) rights |= 1;
      if (fields[2].includes("Q")) rights |= 2;
      if (fields[2].includes("k")) rights |= 4;
      if (fields[2].includes("q")) rights |= 8;
    }

    let ep = null;
    if (fields[3] !== "-" && /^[a-h][1-8]$/.test(fields[3])) {
      ep = squareIndex({
        file: fields[3].charCodeAt(0) - 97,
        rank: Number(fields[3][1])
      });
    }

    return {
      position,
      side: fields[1],
      castlingRights: rights,
      epSquare: ep
    };
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
    const board = getBoardElement();
    const bridgedTurn = board?.getAttribute("data-cmh-turn");
    if (bridgedTurn === "w" || bridgedTurn === "b") return bridgedTurn;

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
    board.querySelector(".cmh-eval-bar")?.remove();
  }

  function formatEvaluation(score, side, isBook, isMaia = false) {
    if (isBook) return "B " + Math.round(score);
    if (isMaia) return (Math.max(0, Math.min(1000, Number(score) || 0)) / 10).toFixed(1) + "%";
    const whiteScore = side === "w" ? score : -score;
    if (whiteScore >= 990000 || whiteScore <= -990000) {
      const mateMoves = Math.max(1, Math.ceil((1000000 - Math.abs(whiteScore)) / 2));
      return (whiteScore >= 0 ? "+" : "-") + "M" + mateMoves;
    }
    const pawns = whiteScore / 100;
    return (pawns >= 0 ? "+" : "") + pawns.toFixed(2);
  }

  function formatCandidateEvaluation(score, side, isBook, bestScore, isMaia = false) {
    const value = formatEvaluation(score, side, isBook, isMaia);
    if (isBook || !Number.isFinite(bestScore) || !Number.isFinite(score)) return value;
    const loss = Math.max(0, bestScore - score);
    return loss > 0
      ? value + " (-" + (isMaia ? (loss / 10).toFixed(1) + "pp" : (loss / 100).toFixed(2)) + ")"
      : value;
  }

  function evaluationPercent(score, side) {
    const whiteScore = side === "w" ? score : -score;
    return Math.max(0.02, Math.min(0.98, 0.5 + 0.5 * Math.tanh(whiteScore / 400)));
  }

  function estimateHumanConfidence(result, side) {
    if (result.book || result.maia || playerSide !== side) return null;
    const userScore = result.score;
    if (userScore >= 990000) return 95;
    if (userScore <= -990000) return 5;
    const ratingEdge = Math.max(-300, Math.min(300, (Number(humanRating) || 1600) - (Number(opponentRating) || 1600)));
    const adjustedScore = userScore + ratingEdge * 0.08;
    return Math.max(5, Math.min(95, Math.round(50 + 45 * Math.tanh(adjustedScore / 350))));
  }

  function parseRatingValue(raw) {
    const match = String(raw || "").replace(/,/g, "").match(/\b(\d{3,4})\b/);
    if (!match) return null;
    const rating = Number(match[1]);
    return rating >= 100 && rating <= 4000 ? rating : null;
  }

  function readPlayerRating() {
    const selectors = [
      "#board-layout-player-bottom [class*='rating']",
      ".board-layout-player-bottom [class*='rating']",
      ".player-component.player-bottom .user-tagline-rating",
      ".player-bottom .user-tagline-rating",
      ".player-bottom .rating"
    ];

    for (const selector of selectors) {
      const elements = document.querySelectorAll(selector);
      for (const element of elements) {
        const rating = parseRatingValue(element.textContent);
        if (rating) return rating;
      }
    }

    const candidates = [];
    for (const element of document.querySelectorAll(".user-tagline-rating, .cc-user-rating")) {
      const rect = element.getBoundingClientRect();
      if (!rect.width || !rect.height) continue;
      const rating = parseRatingValue(element.textContent);
      if (rating) candidates.push({rating, top: rect.top});
    }

    candidates.sort((a, b) => b.top - a.top);
    return candidates[0]?.rating ?? null;
  }

  function readPlayerSide() {
    const board = getBoardElement();

    const bridgedSide = board?.getAttribute("data-cmh-player-side");
    if (bridgedSide === "w" || bridgedSide === "b") return bridgedSide;

    const zones = [
      {
        selectors: [
          "#board-layout-player-bottom",
          ".board-layout-player-bottom",
          ".player-component.player-bottom",
          ".player-bottom"
        ]
      },
      {
        selectors: [
          "#board-layout-player-top",
          ".board-layout-player-top",
          ".player-component.player-top",
          ".player-top"
        ]
      }
    ];

    const detect = element => {
      if (!element) return null;
      const parts = [
        element.getAttribute("data-color"),
        element.getAttribute("data-player-color"),
        element.getAttribute("color"),
        element.className
      ];

      for (const child of element.querySelectorAll("[data-color], [data-player-color], [color], [class*='rating']")) {
        parts.push(child.getAttribute("data-color"));
        parts.push(child.getAttribute("data-player-color"));
        parts.push(child.getAttribute("color"));
        parts.push(child.className);
      }

      const raw = parts.filter(Boolean).join(" ").toLowerCase();
      if (/\bcc-user-rating-white\b|\bcolor-white\b|\bwhite-player\b/.test(raw)) return "w";
      if (/\bcc-user-rating-black\b|\bcolor-black\b|\bblack-player\b/.test(raw)) return "b";
      return null;
    };

    for (const zone of zones) {
      for (const selector of zone.selectors) {
        const element = document.querySelector(selector);
        const side = detect(element);
        if (side) return side;
      }
    }

    return null;
  }

  function refreshMetadata(board, force = false) {
    const detectedPlayerSide = readPlayerSide();
    if (detectedPlayerSide) playerSide = detectedPlayerSide;

    const now = Date.now();
    if (!force && metadataBoard === board && now - lastMetadataRefreshAt < 2000) return;

    const detectedRating = readPlayerRating();
    if (detectedRating) humanRating = detectedRating;
    const detectedOpponentRating = readOpponentRating();
    if (detectedOpponentRating) opponentRating = detectedOpponentRating;
    const detectedGameMode = readGameMode();
    if (detectedGameMode) gameMode = detectedGameMode;

    metadataBoard = board;
    lastMetadataRefreshAt = now;
  }

  function readOpponentRating() {
    const selectors = [
      "#board-layout-player-top [class*='rating']",
      ".board-layout-player-top [class*='rating']",
      ".player-component.player-top .user-tagline-rating",
      ".player-top .user-tagline-rating",
      ".player-top .rating"
    ];

    for (const selector of selectors) {
      const elements = document.querySelectorAll(selector);
      for (const element of elements) {
        const rating = parseRatingValue(element.textContent);
        if (rating) return rating;
      }
    }

    const candidates = [];
    for (const element of document.querySelectorAll(".user-tagline-rating, .cc-user-rating")) {
      const rect = element.getBoundingClientRect();
      if (!rect.width || !rect.height) continue;
      const rating = parseRatingValue(element.textContent);
      if (rating) candidates.push({rating, top: rect.top});
    }

    candidates.sort((a, b) => a.top - b.top);
    return candidates[0]?.rating ?? null;
  }

  function classifyGameMode(raw) {
    const value = String(raw || "").toLowerCase();
    if (/\bbullet\b/.test(value)) return "Bullet";
    if (/\bblitz\b/.test(value)) return "Blitz";
    if (/\brapid\b/.test(value)) return "Rapid";
    if (/\bclassical\b|\bclassic\b/.test(value)) return "Classical";

    const match = value.match(/\b(\d{1,3})\s*(?:\+|\|)\s*(\d{1,3})\b/);
    if (!match) return null;

    const base = Number(match[1]);
    const minutes = base >= 60 ? base / 60 : base;
    if (minutes < 3) return "Bullet";
    if (minutes <= 5) return "Blitz";
    if (minutes <= 25) return "Rapid";
    return "Classical";
  }

  function readGameMode() {
    const selectors = [
      "[data-time-control]",
      "[data-game-type]",
      "[class*='time-control']",
      "[class*='game-type']",
      ".game-info",
      ".game-type"
    ];

    for (const selector of selectors) {
      for (const element of document.querySelectorAll(selector)) {
        const raw = [
          element.textContent,
          element.getAttribute("data-time-control"),
          element.getAttribute("data-game-type"),
          element.getAttribute("aria-label"),
          element.className
        ].filter(Boolean).join(" ");
        const mode = classifyGameMode(raw);
        if (mode) return mode;
      }
    }

    return classifyGameMode(document.body?.innerText);
  }

  function chooseHumanCandidate(result, side) {
    if (playerSide !== side) return null;

    const candidates = (result.alternatives?.length
      ? result.alternatives
      : [result]).slice(0, 8);

    if (candidates.length <= 1) return candidates[0];

    const rating = Math.max(800, Math.min(2800, Number(humanRating) || 1600));
    const enemyRating = Math.max(800, Math.min(2800, Number(opponentRating) || rating));
    const ratingGap = Math.max(-400, Math.min(400, enemyRating - rating));
    const modeBoost = ({Bullet: -35, Blitz: -10, Rapid: 25, Classical: 45})[gameMode] || 0;
    const effectiveRating = Math.max(
      800,
      Math.min(3000, rating + ratingGap * 0.2 + modeBoost + 100)
    );
    const skill = (effectiveRating - 800) / 2200;
    const lossScale = 62 - skill * 30;
    const maxLoss = 125 - skill * 70;
    const bookSpread = 3.0 - skill * 1.3;
    const bestScore = result.score;
    const distinctPool = candidates.length > 1
      ? candidates.filter(move => move !== candidates[0])
      : candidates;

    if (!result.book) {
      const safePool = distinctPool.filter(move => bestScore - move.score <= maxLoss);
      const pool = safePool.length ? safePool : distinctPool.slice().sort((a, b) =>
        (bestScore - a.score) - (bestScore - b.score)
      ).slice(0, 1);
      const targetLoss = Math.max(5, Math.min(maxLoss, 65 - skill * 55));
      const weighted = pool.map((move, index) => {
        const loss = Math.max(0, bestScore - move.score);
        return {
          move,
          weight: Math.exp(-Math.abs(loss - targetLoss) / lossScale) / Math.pow(index + 1, 0.35)
        };
      });
      const total = weighted.reduce((sum, entry) => sum + entry.weight, 0);
      let threshold = Math.random() * total;

      for (const entry of weighted) {
        threshold -= entry.weight;
        if (threshold <= 0) return entry.move;
      }

      return weighted[weighted.length - 1].move;
    }

    const weighted = distinctPool.map((move, index) => ({
      move,
      weight: Math.exp(-index / bookSpread)
    }));
    const total = weighted.reduce((sum, entry) => sum + entry.weight, 0);
    let threshold = Math.random() * total;

    for (const entry of weighted) {
      threshold -= entry.weight;
      if (threshold <= 0) return entry.move;
    }

    return weighted[weighted.length - 1].move;
  }

  function getHumanDisplayMoves(result, side) {
    const candidates = (result.alternatives?.length
      ? result.alternatives
      : [result]).slice(0, 8);
    const humanMove = result.humanMove || chooseHumanCandidate(result, side);
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
      bestMove.score - move.score > 20 &&
      bestMove.score - move.score <= 50
    );
    add(goodMove, "good");

    const okMove = candidates.find(move => {
      const loss = bestMove.score - move.score;
      return move !== bestMove && move !== humanMove && loss > 50 && loss <= 100;
    });
    add(okMove, "ok");

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

  function drawEvaluationBar(board, result, side, orientation) {
    board.querySelector(".cmh-eval-bar")?.remove();
    if (hidden) return;

    const bar = document.createElement("div");
    bar.classList.add("cmh-eval-bar");
    if (orientation.flipped) bar.classList.add("cmh-flipped");

    const blackFill = document.createElement("div");
    blackFill.classList.add("cmh-eval-bar-black");
    bar.appendChild(blackFill);

    if (!result.book) {
      const whiteRatio = result.maia
        ? Math.max(0.02, Math.min(0.98, (Number(result.score) || 0) / 1000))
        : evaluationPercent(result.score, side);
      const whiteFill = document.createElement("div");
      whiteFill.classList.add("cmh-eval-bar-white");
      whiteFill.style.height = (whiteRatio * 100) + "%";
      if (orientation.flipped) {
        whiteFill.style.top = "0";
        whiteFill.style.bottom = "auto";
      }
      bar.appendChild(whiteFill);

      const score = document.createElement("span");
      score.classList.add("cmh-eval-bar-score");
      score.textContent = formatEvaluation(result.score, side, false, Boolean(result.maia));
      score.style.top = ((orientation.flipped ? whiteRatio : 1 - whiteRatio) * 100) + "%";
      bar.appendChild(score);
    } else {
      bar.classList.add("cmh-eval-book");
    }

    board.appendChild(bar);
  }

  function drawArrows(board, result, side = getSideToMove()) {
    clearArrows(board);
    if (hidden) return;

    const candidates = (result.alternatives?.length
      ? result.alternatives
      : [result]).slice(0, 8);
    const bestScore = candidates[0]?.score ?? result.score;
    const studySet = humanMode ? getHumanDisplayMoves(result, side) : null;
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
        category: arrowCategory(move, bestScore, false, result.book)
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
    drawEvaluationBar(board, result, side, orientation);
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

    drawEntries.forEach(entry => {
      const {move, isHumanPick, category} = entry;
      const color = ARROW_COLORS[category];

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
      label.textContent = formatCandidateEvaluation(move.score, side, result.book, bestScore, Boolean(result.maia));
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

  function formatPrincipalVariation(pv) {
    return (pv || []).map(moveName).join(" ");
  }

  function getMaiaRatings(side) {
    const player = Math.max(600, Math.min(2600, Number(humanRating) || 1500));
    const opponent = Math.max(600, Math.min(2600, Number(opponentRating) || 1500));

    if (playerSide && side === playerSide) {
      return {selfElo: player, oppoElo: opponent};
    }

    if (playerSide && side !== playerSide) {
      return {selfElo: opponent, oppoElo: player};
    }

    return {selfElo: player, oppoElo: opponent};
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
    if (busy) {
      scanQueuedWhileBusy = true;
      return stateResponse();
    }
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
        humanRating = null;
        opponentRating = null;
        gameMode = null;
        humanConfidence = null;
        playerSide = null;
        sideToMove = null;
        stateInitialized = false;
        lastObservedPosition = null;
        const existingBoard = getBoardElement();
        if (existingBoard) clearArrows(existingBoard);
      }

      const board = getBoardElement();
      observeBoard(board);
      if (!board) {
        setStatus("No chessboard", "This page does not currently contain a Chess.com board.");
        return stateResponse();
      }

      refreshMetadata(board);

      const fenState = readFenState(board);
      const position = fenState?.position || readPosition(board);
      const pieceCount = position.filter(Boolean).length;
      if (!pieceCount) {
        clearArrows(board);
        setStatus("Board not loaded", "Waiting for the pieces to appear.");
        return stateResponse();
      }

      const side = fenState?.side || getSideToMove();
      sideToMove = side;
      if (fenState) {
        castlingRights = fenState.castlingRights;
        epSquare = fenState.epSquare;
        stateInitialized = true;
        lastObservedPosition = position.slice();
      } else {
        updatePositionState(position);
      }

      const key = getPositionKey(position, side);

      if (engineMode === "stockfish" && isLiveGamePage()) {
        clearArrows(board);
        lastResult = null;
        lastBookName = "";
        lastPositionKey = key;
        setStatus("Stockfish disabled for Live Chess", "Use the Analysis board or a supported bot game.");
        return stateResponse();
      }

      if (force) {
        lastPositionKey = "";
        lastBookName = "";
      }

      if (key === lastPositionKey && board.querySelector(".cmh-arrow-layer") &&
          (lastResult?.book || lastResult?.maia)) return stateResponse();

      setStatus("Thinking...", "Checking the opening book before Maia search.");
      await new Promise(resolve => setTimeout(resolve, 0));

      const bookResult = await lookupBook(position, side);
      let result = bookResult;

      if (!result) {
        try {
          if (engineMode === "stockfish") {
            const fen = board.getAttribute("data-cmh-fen") ||
              positionToFen(position, side, castlingRights, epSquare);
            result = await requestStockfish(fen, 16, humanMode ? 8 : 4);
          } else {
            const maiaRatings = getMaiaRatings(side);
            result = await requestEngine("maiaSearch", {
              position,
              side,
              alternativeCount: humanMode ? 8 : 4,
              castlingRights,
              epSquare,
              selfElo: maiaRatings.selfElo,
              oppoElo: maiaRatings.oppoElo
            });
          }
        } catch (error) {
          setStatus("Maia unavailable", error.message);
          return stateResponse();
        }
      }

      if (!result) {
        clearArrows(board);
        lastResult = null;
        lastBookName = "";
        lastPositionKey = key;
        setStatus("No legal move", "The current position has no legal move available.");
        return stateResponse();
      }

      if (result.gameState === "checkmate" || result.gameState === "stalemate" || result.gameState === "no-move") {
        clearArrows(board);
        lastResult = null;
        lastBookName = "";
        lastPositionKey = key;
        setStatus(
          result.gameState === "checkmate" ? "Checkmate" : result.gameState === "stalemate" ? "Stalemate" : "No legal move",
          "No legal moves remain."
        );
        return stateResponse();
      }

      const latestFenState = readFenState(board);
      const latestPosition = latestFenState?.position || readPosition(board);
      const latestSide = latestFenState?.side || getSideToMove();
      const latestKey = latestPosition.filter(Boolean).length
        ? getPositionKey(latestPosition, latestSide)
        : null;
      if (latestKey && latestKey !== key) {
        scheduleScan();
        return stateResponse();
      }

      const isPlayerTurn = playerSide === side;
      humanConfidence = humanMode && isPlayerTurn ? estimateHumanConfidence(result, side) : null;
      const humanMove = humanMode && isPlayerTurn ? chooseHumanCandidate(result, side) : null;
      const displayResult = humanMode
        ? {...result, humanMove}
        : result;
      lastResult = displayResult;
      lastBookName = result.bookName || "";
      drawArrows(board, displayResult, side);
      lastPositionKey = key;

      const turnDetail = playerSide
        ? (isPlayerTurn ? "Your turn" : "Opponent turn")
        : ("Side to move " + (side === "w" ? "White" : "Black"));

      if (result.book) {
        setStatus(
          humanMode ? "Study candidates" : "Book " + moveName(result),
          turnDetail + " • " + (result.bookName || "Opening book") + " • " + (result.alternatives?.length || 1) + " book moves"
        );
      } else if (result.stockfish) {
        setStatus(
          humanMode ? "Stockfish study candidates" : "Stockfish " + moveName(result),
          turnDetail +
            " • Stockfish 19 Lite" +
            " • depth " + (result.depth || 0) +
            " • " + (result.alternatives?.length || 1) + " candidates"
        );
      } else if (result.maia) {
        setStatus(
          humanMode ? "Maia study candidates" : "Maia " + moveName(result),
          turnDetail +
            " • Maia 3 5M" +
            " • " + (result.alternatives?.length || 1) + " candidates" +
            (humanMode && humanRating ? " • Rating " + humanRating : "") +
            (humanMode && opponentRating ? " • Opponent " + opponentRating : "") +
            (humanMode && gameMode ? " • " + gameMode : "")
        );
      } else {
        setStatus(
          humanMode ? "Study candidates" : "Maia " + moveName(result),
          turnDetail +
            " • Maia 3 5M" +
            " • " + (result.alternatives?.length || 1) + " candidates" +
            (humanMode && humanRating ? " • Rating " + humanRating : "") +
            (humanMode && opponentRating ? " • Opponent " + opponentRating : "") +
            (humanMode && gameMode ? " • " + gameMode : "")
        );
      }

      return stateResponse();
    } finally {
      busy = false;
      if (scanQueuedWhileBusy) {
        scanQueuedWhileBusy = false;
        scheduleScan();
      }
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
            ? (humanMode ? "Study candidates" : "Book " + moveName(lastResult))
            : lastResult.stockfish
              ? (humanMode ? "Stockfish study candidates" : "Stockfish " + moveName(lastResult))
              : lastResult.maia
                ? (humanMode ? "Maia study candidates" : "Maia " + moveName(lastResult))
                : (humanMode ? "Study candidates" : "Best " + moveName(lastResult)),
          lastResult.book
            ? (lastResult.bookName || "Opening book")
            : lastResult.stockfish
              ? "Stockfish 19 Lite"
              : "Maia 3 5M"
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

    if (message?.type === "setEngineMode") {
      const nextEngineMode = message.value === "stockfish" ? "stockfish" : "maia";
      if (nextEngineMode !== engineMode) {
        engineMode = nextEngineMode;
        lastPositionKey = "";
        lastResult = null;
        lastBookName = "";
      }
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

  observeBoard(getBoardElement());
  setInterval(() => {
    const board = getBoardElement();
    if (board !== observedBoard) observeBoard(board);
    scheduleScan();
  }, 3000);

  scheduleScan(true);
})();
