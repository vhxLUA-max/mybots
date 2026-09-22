# Chess Move Helper

Chess Move Helper is a cross-browser chess analysis extension for analyzing Chess.com positions locally.

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

## Browser Compatibility

The project is designed around the WebExtension model and targets major browsers that support the required extension APIs.

The current repository uses a Manifest V3 package and is directly suited to Chromium-based desktop browsers such as:

- Google Chrome
- Microsoft Edge
- Brave
- Opera
- Other Chromium-based browsers with compatible extension APIs

Firefox uses the WebExtension model as well, but browser-specific API and manifest differences may require a Firefox-compatible build before this exact package can be installed there.

Browser compatibility should be tested on the target browser before distribution. Chromium-based browsers generally share the same extension APIs, while some browser-specific differences can still exist.

## PC Installation

### Chrome

1. Download the repository as a ZIP from GitHub.
2. Extract the ZIP file to a normal folder.
3. Open `chrome://extensions/`.
4. Enable **Developer mode**.
5. Click **Load unpacked**.
6. Select the extracted `mybots` folder.
7. Pin **Chess Move Helper** from the extensions menu.
8. Open a Chess.com board.
9. Open the extension and use **Analyze Position**.

Chrome's official extension documentation covers desktop installation, and Chrome does not support installing extensions directly on mobile devices. See the [Chrome extension installation guide](https://support.google.com/chrome/answer/2664769) and [Chrome Web Store troubleshooting](https://support.google.com/chrome_webstore/answer/1698338).

### Microsoft Edge

1. Download the repository as a ZIP from GitHub.
2. Extract the ZIP file to a normal folder.
3. Open `edge://extensions/`.
4. Enable **Developer mode**.
5. Click **Load unpacked**.
6. Select the extracted `mybots` folder.
7. Open a Chess.com board and use the extension.

Edge supports Chromium-compatible extensions and can install compatible extensions from the Chrome Web Store when extensions from other stores are allowed. See [Microsoft's Edge extension guide](https://support.microsoft.com/en-us/edge/add-turn-off-or-remove-extensions-in-microsoft-edge).

### Brave, Opera, and other Chromium browsers

1. Download the repository as a ZIP from GitHub.
2. Extract the ZIP file to a normal folder.
3. Open the browser's extension-management page.
4. Enable its developer or developer-mode option.
5. Choose **Load unpacked** or the equivalent local-extension option.
6. Select the extracted `mybots` folder.
7. Open Chess.com and launch the extension.

The exact menu names can differ between browsers.

## Mobile Installation

Mobile installation depends on whether the browser supports loading unpacked WebExtensions.

### Android

1. Download the repository as a ZIP from GitHub.
2. Extract the ZIP file on your phone.
3. Use a mobile browser that supports installing or loading unpacked WebExtensions.
4. Open that browser's extension-management or developer page.
5. Choose **Load unpacked** or the browser's equivalent option.
6. Select the extracted `mybots` folder.
7. Open Chess.com in that browser.
8. Open the extension and use **Analyze Position**.

Not every mobile browser supports loading unpacked extensions. Chrome for Android and many other mobile browsers do not provide the same extension-management features as their desktop versions.

### iPhone / iPad

1. Download the repository ZIP.
2. Extract the project files using the device's file manager or another archive tool.
3. A browser that supports loading unpacked WebExtensions is required.
4. If the browser does not support unpacked WebExtensions, this repository cannot be installed directly as an extension on that browser.

The exact mobile installation steps depend on the browser because mobile extension support varies by browser.

## Dashboard

The extension includes two interfaces:

- **Popup**: available from the browser toolbar.
- **Full Dashboard**: opened from the popup with **Full Dashboard**.

The popup remains available even when the dashboard is used.

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
| `manifest.json` | Browser extension configuration |
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

Support for a specific browser is determined by that browser's extension API and manifest compatibility. Chromium-based browsers generally share the same extension APIs, but browser-specific differences can still require adjustments. See [Microsoft's browser compatibility documentation](https://learn.microsoft.com/en-us/microsoft-edge/extensions/).

Opening-book files may have licensing terms separate from the project source code. Check the terms of any bundled or custom book files before redistributing them.

## License

The project source code is released under the MIT License. See [LICENSE](LICENSE).
