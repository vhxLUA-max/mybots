var ext = globalThis.browser ?? globalThis.chrome;

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

  

  function arrowCategory(move,bestScore){
    const loss=Math.max(0,bestScore-move.score);
    if(loss<=20)return "best";
    if(loss<=50)return "good";
    if(loss<=100)return "ok";
    if(loss<=250)return "mistake";
    return "blunder";
  }

  let hidden = false;
  let showAlternatives = true;
  let humanRating = null;
  let opponentRating = null;
  let gameMode = null;
  let playerSide = null;
  let sideToMove = null;
  let busy = false;
  let scanQueuedWhileBusy = false;
  let scanTimer = null;
  let observedBoard = null;
  let boardObserver = null;
  let lastMetadataRefreshAt = 0;
  let metadataBoard = null;
  let lastPositionKey = "";
  let lastResult = null;
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

  function buildAnalysisCandidates(result,side){
    const candidates=(result?.alternatives?.length?result.alternatives:result?[result]:[]).slice(0,8);
    const bestScore=candidates[0]?.score??result?.score??0;
    return candidates.map(move=>({
      move:moveName(move),
      evaluation:formatEvaluation(move.score,side),
      loss:Math.max(0,move.loss??bestScore-move.score),
      lossUnit:"cp",
      category:arrowCategory(move,bestScore)
    }));
  }

  function analysisState(){
    const result=lastResult;
    if(!result||!sideToMove)return {source:null,evaluation:null,mate:null,pv:"",candidates:[]};
    return {
      source:"Stockfish 19 Lite Single",
      evaluation:formatEvaluation(result.score,sideToMove),
      mate:result.mate??null,
      pv:formatPrincipalVariation(result.pv),
      candidates:buildAnalysisCandidates(result,sideToMove)
    };
  }

  function stateResponse(){
    const analysis=analysisState();
    return {
      ok:true,
      status:currentStatus,
      detail:currentDetail,
      hidden,
      showAlternatives,
      humanRating,
      opponentRating,
      gameMode,
      playerSide,
      sideToMove,
      isPlayerTurn:playerSide&&sideToMove?playerSide===sideToMove:null,
      analysisSource:analysis.source,
      analysisEvaluation:analysis.evaluation,
      analysisMate:analysis.mate,
      analysisPV:analysis.pv,
      analysisCandidates:analysis.candidates
    };
  }

  function getBoardElement() {
    return document.querySelector("wc-chess-board.board, wc-chess-board");
  }

  

  



  

  

  async function requestStockfish(fen,depth=16,alternativeCount=4){
    const response=await ext.runtime.sendMessage({
      type:"stockfishSearch",
      fen,
      depth,
      alternativeCount
    });

    if(!response?.ok){
      throw new Error(response?.error||"Stockfish service unavailable.");
    }

    return response.result;
  }

  function normalizeEngineFen(fen){
    const fields=String(fen||"").trim().split(/\s+/);
    if(fields.length<4)return null;
    while(fields.length<6)fields.push(fields.length===4?"0":"1");
    fields[4]=/^\d+$/.test(fields[4])?fields[4]:"0";
    fields[5]=/^\d+$/.test(fields[5])?fields[5]:"1";
    return fields.slice(0,6).join(" ");
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

  function formatEvaluation(score,side){
    const whiteScore=side==="w"?score:-score;
    if(whiteScore>=990000||whiteScore<=-990000){
      const mateMoves=Math.max(1,Math.ceil((1000000-Math.abs(whiteScore))/2));
      return (whiteScore>=0?"+":"-")+"M"+mateMoves;
    }
    const pawns=whiteScore/100;
    return (pawns>=0?"+":"")+pawns.toFixed(2);
  }

  function formatCandidateEvaluation(score,side,isBook,bestScore){
    const value=formatEvaluation(score,side);
    if(!Number.isFinite(bestScore)||!Number.isFinite(score))return value;
    const loss=Math.max(0,bestScore-score);
    return loss>0?value+" (-"+(loss/100).toFixed(2)+")":value;
  }

  function evaluationPercent(score, side) {
    const whiteScore = side === "w" ? score : -score;
    return Math.max(0.02, Math.min(0.98, 0.5 + 0.5 * Math.tanh(whiteScore / 400)));
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

  

  

  function drawEvaluationBar(board,result,side,orientation){
    board.querySelector(".cmh-eval-bar")?.remove();
    if(hidden)return;
    const bar=document.createElement("div");
    bar.classList.add("cmh-eval-bar");
    if(orientation.flipped)bar.classList.add("cmh-flipped");
    const whiteRatio=evaluationPercent(result.score,side);
    const whiteFill=document.createElement("div");
    whiteFill.classList.add("cmh-eval-bar-white");
    whiteFill.style.height=(whiteRatio*100)+"%";
    if(orientation.flipped){whiteFill.style.top="0";whiteFill.style.bottom="auto";}
    bar.appendChild(whiteFill);
    const score=document.createElement("span");
    score.classList.add("cmh-eval-bar-score");
    score.textContent=formatEvaluation(result.score,side);
    score.style.top=((orientation.flipped?whiteRatio:1-whiteRatio)*100)+"%";
    bar.appendChild(score);
    board.appendChild(bar);
  }

  function drawArrows(board,result,side=getSideToMove()){
    clearArrows(board);
    if(hidden)return;

    if(getComputedStyle(board).position==="static") board.style.position="relative";
    const candidates=(result.alternatives?.length?result.alternatives:[result]).slice(0,8);
    const bestScore=candidates[0]?.score??result.score;
    const orientation=getOrientation(board);
    const svg=document.createElementNS("http://www.w3.org/2000/svg","svg");
    svg.classList.add("cmh-arrow-layer");
    svg.style.setProperty("position","absolute","important");
    svg.style.setProperty("inset","0","important");
    svg.style.setProperty("width","100%","important");
    svg.style.setProperty("height","100%","important");
    svg.style.setProperty("z-index","2147483647","important");
    svg.style.setProperty("display","block","important");
    svg.style.setProperty("pointer-events","none","important");
    svg.setAttribute("viewBox","0 0 100 100");
    svg.setAttribute("shape-rendering","geometricPrecision");
    const defs=document.createElementNS("http://www.w3.org/2000/svg","defs");
    const categories=[...new Set(candidates.map(move=>arrowCategory(move,bestScore)))];
    drawEvaluationBar(board,result,side,orientation);

    for(const category of categories){
      const marker=document.createElementNS("http://www.w3.org/2000/svg","marker");
      marker.setAttribute("id","cmh-arrow-head-"+category);
      marker.setAttribute("viewBox","0 0 10 10");
      marker.setAttribute("refX","8.5");
      marker.setAttribute("refY","5");
      marker.setAttribute("markerWidth","5");
      marker.setAttribute("markerHeight","5");
      marker.setAttribute("orient","auto");
      const head=document.createElementNS("http://www.w3.org/2000/svg","path");
      head.classList.add("cmh-arrow-head","cmh-"+category);
      head.setAttribute("d","M 0 0 L 10 5 L 0 10 z");
      head.style.setProperty("fill",ARROW_COLORS[category],"important");
      marker.appendChild(head);
      defs.appendChild(marker);
    }

    svg.appendChild(defs);
    candidates.forEach(move=>{
      const category=arrowCategory(move,bestScore);
      const color=ARROW_COLORS[category];
      const source=indexToSquare(move.from);
      const target=indexToSquare(move.to);
      const sourceX=orientation.flipped?7-source.file:source.file;
      const targetX=orientation.flipped?7-target.file:target.file;
      const sourceY=orientation.flipped?source.rank-1:8-source.rank;
      const targetY=orientation.flipped?target.rank-1:8-target.rank;
      const sourcePoint={x:sourceX*12.5+6.25,y:sourceY*12.5+6.25};
      const targetPoint={x:targetX*12.5+6.25,y:targetY*12.5+6.25};

      const line=document.createElementNS("http://www.w3.org/2000/svg","line");
      line.setAttribute("x1",String(sourcePoint.x));
      line.setAttribute("y1",String(sourcePoint.y));
      line.setAttribute("x2",String(targetPoint.x));
      line.setAttribute("y2",String(targetPoint.y));
      line.setAttribute("marker-end","url(#cmh-arrow-head-"+category+")");
      line.classList.add("cmh-arrow","cmh-"+category);
      line.style.setProperty("stroke",color,"important");
      svg.appendChild(line);

      const label=document.createElementNS("http://www.w3.org/2000/svg","text");
      const dx=targetPoint.x-sourcePoint.x;
      const dy=targetPoint.y-sourcePoint.y;
      const length=Math.hypot(dx,dy)||1;
      const normalX=-dy/length;
      const normalY=dx/length;
      const labelX=Math.max(7,Math.min(93,(sourcePoint.x+targetPoint.x)/2+normalX*2.3));
      const labelY=Math.max(5,Math.min(95,(sourcePoint.y+targetPoint.y)/2+normalY*2.3));
      label.setAttribute("x",String(labelX));
      label.setAttribute("y",String(labelY));
      label.setAttribute("text-anchor","middle");
      label.setAttribute("dominant-baseline","middle");
      label.textContent=formatCandidateEvaluation(move.score,side,false,bestScore);
      label.classList.add("cmh-eval-label","cmh-"+category);
      label.style.setProperty("fill",color,"important");
      svg.appendChild(label);
    });

    if(candidates.length)board.appendChild(svg);
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

  

  

  async function scan(force=false){
    if(busy){scanQueuedWhileBusy=true;return stateResponse();}
    busy=true;

    try{
      const gameId=getGameId();
      if(gameId!==currentGameId){
        currentGameId=gameId;
        lastPositionKey="";
        lastResult=null;
        humanRating=null;
        opponentRating=null;
        gameMode=null;
        playerSide=null;
        sideToMove=null;
        castlingRights=0;
        epSquare=null;
        stateInitialized=false;
        lastObservedPosition=null;
        const existingBoard=getBoardElement();
        if(existingBoard)clearArrows(existingBoard);
      }

      const board=getBoardElement();
      observeBoard(board);
      if(!board){
        setStatus("No chessboard","This page does not currently contain a Chess.com board.");
        return stateResponse();
      }

      refreshMetadata(board);
      const fenState=readFenState(board);
      const position=fenState?.position||readPosition(board);

      if(!position.filter(Boolean).length){
        clearArrows(board);
        setStatus("Board not loaded","Waiting for the pieces to appear.");
        return stateResponse();
      }

      const side=fenState?.side||getSideToMove();
      sideToMove=side;

      if(/^\/(?:game\/live|live\/game)\//.test(location.pathname)){
        clearArrows(board);
        lastResult=null;
        lastPositionKey=getPositionKey(position,side);
        setStatus("Analysis disabled on Live Chess","Use the Analysis board or a supported bot game.");
        return stateResponse();
      }

      if(fenState){
        castlingRights=fenState.castlingRights;
        epSquare=fenState.epSquare;
        stateInitialized=true;
        lastObservedPosition=position.slice();
      }else{
        updatePositionState(position);
      }

      const key=getPositionKey(position,side);
      if(force)lastPositionKey="";

      if(key===lastPositionKey&&board.querySelector(".cmh-arrow-layer")&&lastResult?.stockfish){
        return stateResponse();
      }

      setStatus("Stockfish thinking...","Analyzing with Stockfish 19 Lite Single.");
      await new Promise(resolve=>setTimeout(resolve,0));

      let result;
      try{
        const bridgedFen=normalizeEngineFen(board.getAttribute("data-cmh-fen"));
        const fen=bridgedFen||positionToFen(position,side,castlingRights,epSquare);
        result=await requestStockfish(fen,16,showAlternatives?4:1);
      }catch(error){
        setStatus("Stockfish unavailable",error.message);
        return stateResponse();
      }

      if(!result||result.gameState==="no-move"){
        clearArrows(board);
        lastResult=null;
        lastPositionKey=key;
        setStatus("No legal move","The current position has no legal move available.");
        return stateResponse();
      }

      if(result.gameState==="checkmate"||result.gameState==="stalemate"){
        clearArrows(board);
        lastResult=null;
        lastPositionKey=key;
        setStatus(result.gameState==="checkmate"?"Checkmate":"Stalemate","No legal moves remain.");
        return stateResponse();
      }

      const latestFenState=readFenState(board);
      const latestPosition=latestFenState?.position||readPosition(board);
      const latestSide=latestFenState?.side||getSideToMove();
      const latestKey=latestPosition.filter(Boolean).length?getPositionKey(latestPosition,latestSide):null;
      if(latestKey&&latestKey!==key){
        scheduleScan();
        return stateResponse();
      }

      lastResult=result;
      drawArrows(board,result,side);
      lastPositionKey=key;

      const turnDetail=playerSide
        ? (playerSide===side?"Your turn":"Opponent turn")
        : ("Side to move "+(side==="w"?"White":"Black"));

      setStatus(
        "Stockfish "+moveName(result),
        turnDetail+" • Stockfish 19 Lite Single • depth "+(result.depth||0)+" • "+(result.alternatives?.length||1)+" candidates"
      );
      return stateResponse();
    }finally{
      busy=false;
      if(scanQueuedWhileBusy){
        scanQueuedWhileBusy=false;
        scheduleScan();
      }
    }
  }

  ext.runtime.onMessage.addListener((message,sender,sendResponse)=>{
    if(message?.type==="getState"){
      sendResponse(stateResponse());
      return;
    }
    if(message?.type==="scan"){
      scan(true).then(sendResponse).catch(error=>sendResponse({ok:false,error:error.message}));
      return true;
    }
    if(message?.type==="setHidden"){
      hidden=Boolean(message.value);
      const board=getBoardElement();
      if(hidden){
        if(board)clearArrows(board);
        setStatus("Arrows hidden","Stockfish remains available for manual analysis.");
      }else if(board&&lastResult){
        drawArrows(board,lastResult,getSideToMove());
        setStatus("Stockfish "+moveName(lastResult),"Stockfish 19 Lite Single");
      }
      sendResponse(stateResponse());
      return;
    }
    if(message?.type==="setAlternatives"){
      showAlternatives=Boolean(message.value);
      const board=getBoardElement();
      if(board&&lastResult&&!hidden)drawArrows(board,lastResult,getSideToMove());
      sendResponse(stateResponse());
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
