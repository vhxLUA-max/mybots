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

1. Download or clone this repository.
2. Open `chrome://extensions`.
3. Enable **Developer mode**.
4. Click **Load unpacked**.
5. Select the repository folder.
6. Pin **Chess Move Helper** from the extensions menu.
7. Open a Chess.com board.
8. Open the extension and use **Analyze Position**.

Chrome's official extension documentation covers desktop installation, and Chrome does not support installing extensions directly on mobile devices. See the [Chrome extension installation guide](https://support.google.com/chrome/answer/2664769) and [Chrome Web Store troubleshooting](https://support.google.com/chrome_webstore/answer/1698338).

### Microsoft Edge

1. Download or clone this repository.
2. Open `edge://extensions`.
3. Enable **Developer mode**.
4. Choose **Load unpacked**.
5. Select the repository folder.
6. Open a Chess.com board and use the extension.

Edge supports Chromium-compatible extensions and can install compatible extensions from the Chrome Web Store when extensions from other stores are allowed. See [Microsoft's Edge extension guide](https://support.microsoft.com/en-us/edge/add-turn-off-or-remove-extensions-in-microsoft-edge).

### Brave, Opera, and other Chromium browsers

1. Open the browser's extension-management page.
2. Enable its developer or developer-mode option.
3. Choose **Load unpacked** or the equivalent local-extension option.
4. Select the repository folder.
5. Open Chess.com and launch the extension.

The exact menu names can differ between browsers.

## Mobile Installation

Mobile extension support depends on the browser.

### Android: Firefox

Firefox for Android supports extensions/add-ons through its Add-ons Manager and the Firefox Add-ons website. See [Mozilla's Firefox for Android extension guide](https://support.mozilla.org/en-US/kb/find-and-install-add-ons-firefox-android).

For a published Firefox-compatible version:

1. Install **Firefox for Android**.
2. Open the Firefox menu.
3. Tap **Add-ons** or **Extensions**.
4. Find the compatible Chess Move Helper add-on.
5. Tap **+** to install it.
6. Open Chess.com and use the extension.

The current GitHub repository is an unpacked desktop extension package. A Firefox-specific, published build may be required for installation on Firefox for Android.

### Android: Chrome

Chrome for Android does not support installing extensions directly. Google documents extension installation as a desktop feature, while Chrome's mobile help states that extensions and themes cannot be installed on mobile devices. citeturn160471search5turn160471search6

### iPhone / iPad

This repository is not directly installable as an unpacked extension in Safari on iPhone or iPad. A Safari Web Extension build and the corresponding Apple packaging/distribution process would be required.

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
