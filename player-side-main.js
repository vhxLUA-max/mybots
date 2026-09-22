(() => {
  if (window.__cmhPlayerSideBridgeLoaded) return;
  window.__cmhPlayerSideBridgeLoaded = true;

  const normalize = value => {
    if (value === 1 || value === "1" || value === "w" || value === "white") return "w";
    if (value === 2 || value === "2" || value === "b" || value === "black") return "b";
    return null;
  };

  const sync = () => {
    const board = document.querySelector("wc-chess-board");
    if (!board) return;

    try {
      const side = normalize(board.game?.getPlayingAs?.());
      if (side && board.getAttribute("data-cmh-player-side") !== side) {
        board.setAttribute("data-cmh-player-side", side);
      }
    } catch {}
  };

  sync();
  new MutationObserver(sync).observe(document.documentElement, {
    childList: true,
    subtree: true
  });
  setInterval(sync, 500);
})();