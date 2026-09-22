# Stockfish assets

This extension expects the Stockfish 19 lite single-threaded browser build in this directory.

Required files:

- stockfish-19-lite-single.js
- stockfish-19-lite-single.wasm

Download the matching v19.0.0 release assets from the official nmrugg/stockfish.js project and place them here without renaming them.

The worker loads the JavaScript engine from stockfish-19-lite-single.js. The WASM file must remain beside it so the engine can resolve its packaged WASM asset.

Stockfish.js is licensed under GPL-3.0. See the upstream project for the full license and attribution requirements.

Upstream:
https://github.com/nmrugg/stockfish.js
