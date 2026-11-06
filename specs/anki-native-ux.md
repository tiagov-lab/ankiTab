# spec: anki-native reviewer ux

repo: ankitab, a browser extension that replaces the new tab page with anki flashcards via the AnkiConnect add-on (`http://127.0.0.1:8765`, api version 6).

goal: make the new tab feel like anki desktop's reviewer, fix theme and keyboard bugs, add anki keybinds, show due counts and intervals, make the "done" and "anki not running" screens useful, and add settings for them.

## ground rules

- plain javascript es modules, no build step, no new libraries, no frameworks. keep bootstrap.css (it is in `extension/libs`).
- no inline `<script>` and no inline `on*=` attributes in extension pages: the CSP forbids them. use separate `.js` files.
- never use `innerHTML +=` in loops with user data (deck names). build elements with `document.createElement` and set `textContent`.
- the card is rendered inside `extension/app/sandbox.html` (an iframe, `#flashcardSandbox`). in chrome it is a sandboxed page (opaque origin, no `chrome.*`, no localStorage shared with the extension). communicate only through `postMessage`. in the parent, accept messages only when `event.source === iframe.contentWindow`.
- do not touch `extension/libs/MathJax*`, `extension/libs/jax`, `extension/libs/extensions`, or the card-script emulation logic in `sandbox.js` (render(), convertInlineHandlers, withLoadEventCapture). only add to sandbox.js.
- both `manifests/chromeManifest.json` and `manifests/firefoxManifest.json` must get the same permission changes. `extension/manifest.json` is a copy of the chrome one; update it too.
- AnkiConnect calls go through `ankiConnectInvoke(action, params)` in `extension/libs/ankiConnect.js` (returns a promise).

## files involved

- `extension/app/index.html`, `extension/app/css/main.css`, `extension/app/js/main.js`, `extension/app/js/cards.js`, `extension/app/js/extended/rotateDeck.js`
- `extension/app/sandbox.html`, `extension/app/js/sandbox.js`
- `extension/libs/ankiConnect.js`
- `extension/options/index.html`, `extension/options/options.js`
- `extension/bg.js` (defaults)
- new: `extension/app/js/theme-init.js`, `extension/app/js/doneScreen.js`, `extension/app/js/keys.js` (or similar, your call), `extension/libs/settings.js`
- `extension/app/js/extended/beta.js`: dead code (patches a `study` object that no longer exists). delete it and the `betaEnabled` default.

## 1. theme

setting `theme`: `"system"` (default) | `"light"` | `"dark"`.

- store it in `localStorage` key `ankitab-theme` (extension pages share an origin, so the new tab and the options page both see it; localStorage is synchronous, which avoids a flash).
- new classic (non-module) script `extension/app/js/theme-init.js`, loaded with a plain `<script src>` inside `<head>` of `app/index.html` and `options/index.html`, before the stylesheets finish matter. it:
  - reads `ankitab-theme`, resolves `"system"` with `matchMedia('(prefers-color-scheme: dark)')`
  - sets `document.documentElement.classList.toggle('dark-theme', isDark)` (the `<html>` element, since `<body>` does not exist yet)
  - exposes `window.ankitabTheme = { get(), set(value), isDark(), onChange(cb) }`; `onChange` fires when the setting changes or, in system mode, when the os scheme changes.
- move the dark variables in `extension/libs/bootstrap.css` from `body.dark-theme` to `html.dark-theme body` (or `.dark-theme`) so the class on `<html>` works. keep `body.dark-theme` working too for the sandbox.
- remove the old toggle code in `main.js` that uses `localStorage.theme` and `body.classList`. migrate once: if old key `theme` is `"dark"` or `"light"` and `ankitab-theme` is unset, copy it over.
- all colors in `main.css` become css variables defined for light and dark (`--bkg-color`, `--text-color`, `--bar-bg`, `--bar-border`, `--btn-bg`, `--btn-border`, `--btn-text`, `--muted`, `--new-color`, `--learn-color`, `--review-color`). no hard-coded `#000` for the answer bar.
- sandbox: the parent posts `{command: 'theme', dark: true|false}` to the iframe after the iframe loads and whenever the theme changes. sandbox.js toggles on `document.body`: `nightMode`, `night_mode` (what anki desktop sets, card templates style themselves with these) and `dark-theme` (for bootstrap vars). the sandbox body background must match the page background in both themes. also re-send the theme before each `render` so it is never stale.
- the iframe must not flash white while loading in dark mode: give `#flashcardSandbox` `background: transparent` and `color-scheme: light dark` handling as needed; in sandbox.html add `<meta name="color-scheme" content="light dark">`.

## 2. anki-desktop look

mimic anki desktop (2.1.50+ / 23.x) reviewer:

- card area: card html centered in the page as the note's css dictates. remove the bootstrap `card` component styling from the sandbox body: the sandbox `<body class="card">` gets bootstrap's `.card` flex/border rules. add a sandbox-only stylesheet `extension/app/css/reviewer.css` loaded after bootstrap in sandbox.html that resets them: `body.card { display:block; border:0; border-radius:0; background: var(--bkg-color); margin: 20px; overflow-wrap: break-word; }` plus anki's defaults `img { max-width: 100%; max-height: 95vh; }`, `hr#answer` visible. keep the card's own css (`card.css` from AnkiConnect) winning: it is injected inside the rendered html, after these sheets.
- bottom bar (fixed to bottom, full width, `--bar-bg` background, 1px top border, ~60px tall), three zones, like anki's:
  - left: `Edit` button (opens the note editor in anki, see keybinds).
  - center: on the question side, the due counts line above a `Show Answer` button (min-width ~150px). on the answer side, the answer buttons, each with its interval label above it in small muted text.
  - right: `More` button opening a small menu: `Options`, `Sync`, `Theme: System/Light/Dark` (cycles), `Undo`, `Suspend card`. the old top-right `Options | Sync / Toggle Theme` links are removed.
- anki-style buttons: neutral, not bootstrap colored. light: background `#fcfcfc`, border `#c4c4c4`, radius 5px, text `#202020`, hover slightly darker. dark: background `#3a3a3a`, border `#202020`, text `#dddddd`. padding ~6px 14px, font-size 14px.
- answer buttons: `Again`, `Hard`, `Good`, `Easy` (fewer when `buttons.length` < 4, same mapping as today's code). the interval labels come from `nextReviews` in the `guiCurrentCard` result (array of strings like `"<1m"`, `"<10m"`, `"4d"`, aligned with `buttons`). if `nextReviews` is missing, leave the labels empty. remove the commented-out getIntervals code and `processIntervals`.
- due counts: `getDeckStats` with `{decks: [card.deckName]}` returns an object keyed by deck id with `new_count`, `learn_count`, `review_count`. show `new + learn + review` as three numbers separated by ` + `, colored `--new-color` (blue, light `#1976d2` / dark `#64b5f6`), `--learn-color` (red, `#d32f2f` / `#ef9a9a`), `--review-color` (green, `#2e7d32` / `#81c784`). underline the number matching the current card's queue if known (it is not in guiCurrentCard; skip underlining unless cheap). fetch counts in parallel with rendering, never block the card on it; on failure hide the line.
- deck name: small muted text, top center as today.
- page bottom padding equals the bar height so the card end is never covered: the iframe's height area must stop above the bar.
- tab title: `AnkiTab · <deck name>` while reviewing, `AnkiTab` otherwise. (the browser may show "New Tab" anyway on the newtab override; that's fine.)
- answer side: the sandbox scrolls `hr#answer` (if present) into view after rendering the answer, like anki.
- while waiting for the next card, keep the previous card faded (opacity .4) rather than blanking the page and the deck name.

## 3. keyboard

replace the `keyup` listeners in `cards.js` with a single `keydown` dispatcher (state machine: `question` | `answer` | `busy`). ignore `event.repeat`. ignore events whose target is an `input`, `textarea`, `select` or contenteditable (this is the "type in the answer" bug). ignore keys with alt/meta modifiers, and ctrl unless the binding is ctrl+z.

the sandbox iframe gets focus whenever the user clicks the card, and then key events never reach the parent. in sandbox.js add a `keydown` listener that, unless the target is an editable element, posts `{command: 'key', key, code, ctrlKey, shiftKey, altKey, metaKey, repeat}` to `window.parent` and calls `preventDefault()` for space so the iframe does not scroll. the parent feeds these into the same dispatcher.

bindings (anki desktop parity):

| key | question side | answer side |
|---|---|---|
| space, enter | show answer | answer `Good` (ease = index of Good + 1; 2 when only 2-3 buttons where good is 2) |
| 1-4 | — | answer with that ease if it exists |
| e | edit note | edit note |
| r, f5 | replay audio | replay audio |
| ctrl+z | undo | undo |
| @ (shift+2) | suspend card | suspend card |
| - | bury card | bury card |

careful: `@` is shift+2 on us layouts; check `event.key === '@'` before treating `2` as an answer key, and only treat digits when `event.key` is the digit itself.

actions:

- **edit**: `cardsInfo({cards:[cardId]})` → `result[0].note` → `guiEditNote({note})`. this opens anki's editor window; show a small toast "opened in anki".
- **replay audio**: parent posts `{command: 'replayAudio'}`; sandbox plays every `audio, video` element in `#qa` in sequence from time 0 (on the answer side anki replays the answer's audio; fine to replay all audio on the current side).
- **undo**: `guiUndo`. on success, `getCard()` then `renderQuestion()` (no deck rotation). on failure toast "nothing to undo".
- **suspend**: `suspend({cards:[cardId]})`, then `guiDeckReview` the same deck (so anki moves on), then the normal next-card flow. toast "card suspended".
- **bury**: AnkiConnect has no bury action. try `ankiConnectInvoke('buryCards', {cards:[cardId]})`; if it errors with unsupported action, toast "bury isn't supported by AnkiConnect" and do nothing else. do not fake it.
- auto-answer from `Show Answer` click still works as today.

toasts: one small helper (bottom-center above the bar, fades after 2.5s).

update the options page "Shortcuts" list to the table above with the correct mapping `1 Again · 2 Hard · 3 Good · 4 Easy` (note that cards with fewer buttons map 1 Again · 2 Good · 3 Easy).

## 4. "anki not running" state

today every failed request calls `showError`, which replaces the card with a red alert, and the user has to reload.

- `ankiConnect.js`: stop rendering ui from inside `ankiConnectInvoke`. reject with a typed error: `{type: 'offline'}` on network error when host permission is granted, `{type: 'permission'}` when not, `{type: 'anki', message}` for AnkiConnect errors. add a `timeout` of 5s (xhr.timeout) that rejects as offline. export a `ping()` helper calling `version`.
- the new tab shows a calm full-page state (centered, theme-aware, no red alert) when the initial load or a card fetch fails with `offline`:
  - title "Anki isn't running"
  - text "start anki with the AnkiConnect add-on. this page will continue as soon as it can connect."
  - a small spinner/pulse and "retrying…" text
  - a `Retry now` button and a `Open a blank tab` link (see 5, the blank fallback)
  - poll `ping()` every 3s while the tab is visible (`document.visibilityState === 'visible'`; pause when hidden, resume on `visibilitychange`). on success, restart the study flow without reloading the page.
- `permission` errors keep the existing grant-permission button, restyled in the same calm layout.
- failures of media requests (`retrieveMediaFile`) and of the counts request must never replace the card. log and continue.
- `anki` errors on card fetch keep the existing behavior of marking the deck empty and rotating.

## 5. done screen ("congratulations") and its settings

replace the bare html written in `rotateDeck.js` with a module `doneScreen.js` exporting `showDoneScreen()`. `rotateDeck` calls it instead of writing html. layout, centered, theme-aware:

- heading "Congratulations! You have finished for now." (anki's wording)
- stats block (setting `doneShowStats`, default on):
  - cards reviewed today: `getNumCardsReviewedToday`
  - time studied today: `findCards({query: 'rated:1'})` → `getReviewsOfCards({cards})` → sum `time` (ms) of every review whose `id` (epoch ms) is ≥ the start of today's anki day (local today at 04:00, or yesterday at 04:00 if now is before 04:00). show as `Xm` or `Xh Ym`. if there are more than 2000 cards, skip the time line.
  - next cards due: `findCards({query: 'prop:due=1'})` length → "N cards due tomorrow" (setting `doneShowNextDue`, default on).
- links: `Options`, `Sync`.
- fallback (setting `doneFallback`: `"none"` | `"search"` | `"topsites"` | `"both"`, default `"search"`):
  - search: a search input that submits to `doneSearchUrl` (setting, default `https://duckduckgo.com/?q=%s`, `%s` replaced by the url-encoded query), autofocused.
  - top sites: uses `chrome.topSites.get()`; render the first 8 as links with favicon (`https://www.google.com/s2/favicons?domain=<host>` is not allowed offline; use a letter tile instead, no remote requests). `topSites` is an **optional** permission: add `"optional_permissions": ["topSites"]` to both manifests. the options page requests it (`chrome.permissions.request({permissions:['topSites']})`) when the user picks topsites/both; if denied, fall back to search. the done screen checks `chrome.permissions.contains` before calling the api.
- the done screen must also work when reached from the "Open a blank tab" link of section 4: in that mode show only the fallback (no stats, no anki calls). expose it as `app/index.html?blank=1`.

## 6. settings

new `extension/libs/settings.js`: one place with defaults and `getSettings()` / `setSettings(partial)` over `chrome.storage.local`. `bg.js` imports the same defaults (bg.js is a classic background script in chrome mv2 manifest; if importing is not possible, duplicate the defaults object and keep a comment pointing to settings.js). new defaults:

- `doneShowStats: true`
- `doneShowNextDue: true`
- `doneFallback: "search"`
- `doneSearchUrl: "https://duckduckgo.com/?q=%s"`
- `showDueCounts: true` (hides the counts line in the bar when off)

options page:

- new section "Appearance": theme select (System / Light / Dark) writing `localStorage['ankitab-theme']` immediately, and `showDueCounts` checkbox.
- new section "When you're done": the done-screen settings above (checkboxes, a select for the fallback, a text input for the search url, validated to contain `%s`).
- options page uses `theme-init.js` too, so it honors dark mode.
- render the deck list with `createElement` (deck names can contain quotes/html), keep tick/untick all.
- fix the "Rate & Review" link: firefox (`navigator.userAgent` contains `Firefox`) → `https://addons.mozilla.org/en-US/firefox/addon/ankitab/`, otherwise the chrome web store link.

## acceptance checks (do these mentally / by reading code; there is no test runner)

1. dark theme: card area, bar, menus, options page and done screen are all dark; no white flash on load; `nightMode` class present on the sandbox body.
2. system theme changes live when the os switches, in system mode.
3. clicking a cloze/card and then pressing space still shows the answer; space again answers Good.
4. typing in an `<input>` inside a card never triggers shortcuts.
5. answer buttons show intervals from `nextReviews`.
6. counts line shows three colored numbers and never delays the card.
7. quit anki → calm offline screen with retrying; start anki → card appears without reload.
8. done screen shows stats/next due/search per settings; topsites only after granting the optional permission.
9. no inline scripts or inline handlers added; no `innerHTML` with deck names.
10. `bash build.sh` still produces `ankitab-firefox.xpi` and `chrome.zip`.

when done, list the files you changed and any spec item you could not implement and why. do not commit.
