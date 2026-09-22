# Chess Move Helper

Chess Move Helper is a Chrome Manifest V3 extension for analyzing Chess.com positions locally.

It combines a local chess engine with Polyglot opening-book support and displays recommended moves directly on Chess.com.

## Features

- Local chess position analysis
- Engine depth control
- Best move and alternative candidate arrows
- Move classification: Best, Good, Okay, and Bad
- Built-in randomized Polyglot opening books
- Support for loading a custom `.bin` Polyglot book
- Full dashboard page in addition to the extension popup
- Castling and en-passant state tracking for local analysis
- No external engine service is required for position analysis

## Installation

1. Download or clone this repository.
2. Open `chrome://extensions` in Chrome.
3. Enable **Developer mode**.
4. Select **Load unpacked**.
5. Choose the repository folder.
6. Open a Chess.com board and open the extension.

The extension popup remains available from the Chrome toolbar. Use **Full Dashboard** in the popup to open the larger dashboard page.

## Usage

Open a Chess.com position and use **Analyze Position** to request a local analysis.

You can adjust:

- **Alternative arrows** to show additional candidate moves.
- **Opening book** to use book moves before engine analysis.
- **Book selection** to choose a built-in or custom book.
- **Engine depth** to trade analysis strength for speed.

To load a custom opening book, use a valid Polyglot `.bin` file from the popup or dashboard.

## Project Structure

| File | Purpose |
| --- | --- |
| `manifest.json` | Chrome extension configuration |
| `background.js` | Background service worker and opening-book management |
| `book.js` | Polyglot opening-book lookup logic |
| `engine.js` | Local chess move generation, evaluation, and search |
| `content.js` | Chess.com board detection, position state, and analysis display |
| `popup.html` / `popup.css` / `popup.js` | Extension popup interface |
| `dashboard.html` / `dashboard.css` | Full-page dashboard interface |
| `styles.css` | Chess.com analysis overlay styles |
| `books/` | Bundled Polyglot opening-book files |

## Notes

This project is a browser extension that interacts with Chess.com pages. Chess.com can change its page structure or behavior, which may affect compatibility.

Opening-book files may have licensing terms separate from the project source code. Check the terms of any bundled or custom book files before redistributing them.

## License

The project source code is released under the MIT License. See [LICENSE](LICENSE).

