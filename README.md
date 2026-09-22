# Chess Move Helper

Chess Move Helper is a Chromium browser extension for analyzing supported Chess.com positions with Stockfish 19 Lite Single.

## Features

- Local Stockfish 19 Lite Single analysis
- Automatic Chess.com FEN detection
- Best-move and MultiPV candidate arrows
- Evaluation bar and centipawn loss labels
- Principal variation display
- Castling and en-passant state tracking
- Popup and full dashboard interfaces

## Installation

1. Download or clone this repository.
2. Open `chrome://extensions/`.
3. Enable Developer mode.
4. Click Load unpacked.
5. Select the `mybots` folder.
6. Open a supported Chess.com analysis or bot board.
7. Open Chess Move Helper and use Analyze Position.

## Engine

The extension bundles `stockfish-19-lite-single.js` and `stockfish-19-lite-single.wasm`.

Stockfish is the only analysis engine used by the extension. No external engine service, Maia model, opening book, or secondary engine is required.

## Chess.com usage

Analysis is disabled on Chess.com Live Chess games. Use the extension for supported analysis, study, and bot workflows.

## License

Stockfish.js and Stockfish are distributed under GPLv3. See the bundled engine notices and the upstream Stockfish.js project for license details.
