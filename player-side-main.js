(() => {
  if (window.__cmhPlayerSideBridgeLoaded) return;
  window.__cmhPlayerSideBridgeLoaded = true;

  const normalize = value => {
    if (value === 1 || value === "1" || value === "w" || value === "white") return "w";
    if (value === 2 || value === "2" || value === "b" || value === "black") return "b";
    return null;
  };

  const setAttributeValue = (board, name, value) => {
    if (value === null) {
      board.removeAttribute(name);
      return;
    }
    if (board.getAttribute(name) !== value) board.setAttribute(name, value);
  };

  const sync = () => {
    const board = document.querySelector("wc-chess-board");
    if (!board) return;

    try {
      const game = board.game;
      const playerSide = normalize(game?.getPlayingAs?.());
      const turn = normalize(game?.getTurn?.());
      const fen = typeof game?.getFEN === "function" ? game.getFEN() : null;

      setAttributeValue(board, "data-cmh-player-side", playerSide);
      setAttributeValue(board, "data-cmh-turn", turn);
      setAttributeValue(board, "data-cmh-fen", typeof fen === "string" && fen.split(" ").length >= 4 ? fen : null);
    } catch {}
  };

  sync();
  new MutationObserver(sync).observe(document.documentElement, {
    childList: true,
    subtree: true
  });
  setInterval(sync, 500);
})();