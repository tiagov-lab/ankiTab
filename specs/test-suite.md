# spec: test suite for ankitab

repo: ankitab. goal: a characterization test suite that pins the current behavior of every function in the extension, so a later refactor can move code around safely. the tests describe what the code does today. do not change behavior.

## tooling

- `package.json` at the repo root (private, `"type": "module"`), devDependencies pinned exactly: `vitest@3.2.4`, `@vitest/coverage-v8@3.2.4`, `jsdom@26.1.0`. scripts: `"test": "vitest run"`, `"coverage": "vitest run --coverage"`.
- `vitest.config.js`: `environment: 'jsdom'`, `include: ['tests/**/*.test.js']`, `setupFiles: ['tests/setup/chrome.js']`, `restoreMocks: true`, coverage `include: ['extension/**/*.js']`, `exclude: ['extension/libs/MathJax.js', 'extension/libs/tether.js', 'extension/libs/config/**', 'extension/libs/extensions/**', 'extension/libs/jax/**']`, reporters `text-summary` + `text`.
- `test.sh` at the repo root (node is not installed on the host; docker is):
  ```sh
  #!/bin/sh
  set -e
  cd "$(dirname "$0")"
  docker run --rm -v "$PWD":/w -w /w node:22-alpine sh -c "npm install --no-audit --no-fund --loglevel=error && npx vitest run $*"
  ```
  run tests with `bash test.sh`, coverage with `bash test.sh --coverage`. commit `package-lock.json`. `node_modules/` and `coverage/` are already gitignored.
- `build.sh` zips only `extension/`, so nothing test-related ships. keep it that way.

## shared test helpers (`tests/setup/`, `tests/helpers/`)

- `tests/setup/chrome.js`: before each test, install a fresh `globalThis.chrome` fake:
  - `storage.local.get(keys, cb)` supporting `null`, a string, an array and an object-of-defaults (stored values override defaults, exactly like the real api). `set(obj, cb)`, `remove`, `clear`. `onChanged.addListener` / `removeListener`; `set` fires listeners with `(changes, 'local')` where `changes[key] = {oldValue, newValue}`.
  - `runtime.getURL(p)` → `'moz-extension://test/' + p`, `runtime.lastError` undefined, `runtime.onInstalled.addListener`.
  - `permissions.contains/request` (callback style, default granted `true`, configurable), `topSites.get(cb)`, `tabs.create`, `action.onClicked.addListener`.
  - expose `chrome.__store` (the backing object) and `chrome.__reset()` for tests.
  - also reset `document.body.innerHTML`, `document.title`, `localStorage`.
- `tests/helpers/anki.js`: `mockAnki(handlers)` returning a `vi.fn(action, params)` that resolves `handlers[action](params)` or rejects `{type: 'anki', message: 'unknown action'}`. used with `vi.mock('../extension/libs/ankiConnect.js', ...)` (path relative to the test file).
- `tests/helpers/dom.js`: `loadAppHtml()` injects the `<body>` of `extension/app/index.html` (read with `fs`), `loadOptionsHtml()` the same for `extension/options/index.html`. strip `<script>` tags.
- `tests/helpers/classic.js`: `loadClassicScript(path, exportNames)` for non-module scripts (`sandbox.js`, `theme-init.js`, `bg.js`): read the file, append `;globalThis.__exports = {name1, name2, ...};`, run it with indirect eval `(0, eval)(src)` in the jsdom global, return `globalThis.__exports`. this reaches top-level functions without changing the source.

modules with top-level state (`cards.js`, `toast.js`, `offlineScreen.js`, `main.js`) must be imported fresh per test: `vi.resetModules()` then `await import(...)`. use `vi.useFakeTimers()` wherever timers matter.

## making helpers reachable

module-private functions that hold logic may get an `export` keyword added, nothing else (no renames, no signature changes). for `cards.js` export: `bufferToText`, `replaceAudioTags`, `buildCardHTML`, `inlineMediaScripts`, `resolveMedia`, `extractLocalFontFaces`, `cssValue`, `base64ToBuffer`, `buttonNames`, `renderDueCounts`, `renderBatchProgress`, `batchLimit` and anything else with branching logic. for `doneScreen.js`: `startOfAnkiDay`, `formatDuration`, `searchUrl`, `batchHeading`, `batchSub`. for `options.js`: `getValue`, `setValue` — note options.js runs `init()` at import; test it as a whole page (load the options html first, mock ankiConnect + rotateDeck). classic scripts use `loadClassicScript` instead of exports.

## what to cover (one test file per source file, `tests/<name>.test.js`)

every function gets at least one test; every branch that is cheap to reach gets one. minimum list:

- `libs/ankiConnect.js`: fake `XMLHttpRequest` class on `globalThis`. request body is `{action, version: 6, params}` posted to `http://127.0.0.1:8765` with a 5000 ms timeout; result resolves; `{error}` → `{type:'anki', message}`; invalid json / non-object / missing `result` → `type:'anki'`; network error and timeout → `'offline'` when permission granted, `'permission'` when not; settles once. `ping` calls `version`. `requestPermission` true/false/no api/throws.
- `libs/settings.js`: `getSettings` fills defaults, stored values win; `setSettings` writes.
- `app/js/keys.js`: `isEditableTarget` for every input type listed plus textarea/select/contenteditable/null. `createKeyHandler`: repeat/alt/meta ignored, ctrl only for z, busy state ignored, `#menu` targets ignored, `@` suspend, `-` bury, space/enter in question and answer state (answer uses `goodIndex`), digits 1-4 bounded by `answerCount`, digits ignored in question state, e/E edit, r/R/F5 replay, `preventDefault` called on handled keys only.
- `app/js/toast.js`: shows text, adds `visible` on the next frame, removes after 2500 ms, hides 250 ms later, a second toast resets timers, missing element is a no-op.
- `app/js/offlineScreen.js`: offline vs permission markup and titles, polling every 3 s only while visible, a successful ping hides the overlay and calls `onRetry` once, grant button success/failure, retry button, blank-tab link url, `hideOffline` clears everything.
- `app/js/extended/rotateDeck.js`: interleaving disabled → true without anki calls; empty deck cache fetches `deckNames`; cached names refresh in the background; empty decks older than 1 h expire; excluded and empty decks skipped; picks the next name after `lastDeck` alphabetically with wraparound; calls `guiDeckReview` and stores `lastDeck`; nothing left → `showDoneScreen` (mocked) and false, not shown when `DOMchange=false`.
- `app/js/doneScreen.js`: pure helpers (`startOfAnkiDay` before/after 4am, `formatDuration` <1m, minutes, hours, `searchUrl` with/without `%s` and encoding). `showDoneScreen`: normal heading, `blank` mode has no heading/stats/links, stats toggled by `doneShowStats`/`doneShowNextDue`, `timeStudiedToday` sums only reviews since the anki day start and returns null over 2000 cards, fallback modes `none`/`search`/`topsites`/`both` incl. topSites permission missing → search, invalid mode → search, search submit navigates (stub `location` via `vi.stubGlobal` or by spying on a setter you can observe — pick what works in jsdom and document it), top sites grid (max 8, host letter, hidden when empty or on error), Options/Sync links, search gets focus. batch mode: heading singular/plural, `Break time` + "Cards are back at", sub text, continue button label and callback, no "Congratulations".
- `app/js/cards.js` (mock `ankiConnect.js`, `rotateDeck.js`, `doneScreen.js`, `offlineScreen.js`, `toast.js`; load app html; give `#flashcardSandbox` a `contentWindow.postMessage` spy and fire its `load` after setting `src`): every exported helper above; `start()` happy path renders question (deck name, title, due counts, posts `render` with `answer:false` and `autoFlip`), `blank=1` path, break path (no anki call, batch screen); `renderAnswer` builds 2/3/4 buttons with intervals and calls `guiShowAnswer`; `answerQuestion` via button click → `guiAnswerCard` with ease, next card; error → buttons re-enabled + toast / offline screen by error type; batch counting: dots fill, cap triggers the batch screen, `batchFreeUntil` written only with a break, `onContinue` resumes and hides dots; undo decrements and handles "nothing to undo"; suspend, bury (unsupported → toast), edit note; `getCard` retries after anki errors by marking the deck empty (max 5); due-count race (an old response does not overwrite a newer one); settings changes through `chrome.storage.onChanged` refresh due counts / batch dots; media cache dedupes concurrent `retrieveMediaFile` calls and drops failures; fonts sent once per key.
- `app/js/main.js` (mock `cards.js`, `ankiConnect.js`, `toast.js`; load app html; a minimal `window.ankitabTheme` stub): menu open/close/escape/outside click, Options navigates, Sync success/failure toast, theme button cycles system→light→dark and updates its label, undo/suspend/edit/show-answer buttons call through, sandbox `message` from the frame forwards `key` events and `showAnswer`, messages from other sources ignored, `onbeforeunload` calls `guiDeckBrowser` except with `?blank=1`, frame src includes `?theme=`.
- `app/js/sandbox.js` (classic): `isEditable`, `allRadioGroupsAnswered`, `needsFinishing`, `convertInlineHandlers`, `ttcToSfnt` (build a tiny fake ttc buffer), `predecodeImages`, render message → `#qa` content, auto-flip posts `showAnswer` once after 200 ms for radios, never with checkboxes or on answer renders, cancelled by a new render, keydown forwarding to parent with editable targets skipped, `replayAudio` plays in order, theme message toggles the dark class. stub `MathJax` as absent unless a test needs it.
- `app/js/theme-init.js` (classic): stored value read, `isDark` for system/light/dark with a `matchMedia` stub, `set` persists and notifies `onChange`, html class toggled, storage event sync.
- `options/options.js`: page fills from stored settings, number inputs save as clamped numbers (`NaN`→0), checkboxes as booleans, search url without `%s` blocks save with a validity message, deck list rendered with exclusions, tick/untick all, topSites permission requested when a fallback needs it, "saved" alert shows then fades.
- `bg.js` (classic): `onInstalled` writes only missing defaults; defaults object equals `DEFAULT_SETTINGS` from settings.js (this guards the duplicated copy); action click opens a tab.
- `app/js/mimeTypes.js`: spot-check a few entries (`.mp3`, `.png`, `.mp4`, `.svg`).

## rules

- tests must pass against the code as it is now. if you find a real bug, do not fix it: write the test for the current behavior, add a `// BUG:` comment explaining it, and list it in your final message.
- no snapshot tests; assert concrete values.
- keep each test small and named after the behavior (`it('skips decks marked empty within the last hour')`).
- run `bash test.sh` until everything is green, then `bash test.sh --coverage` and include the summary (functions %) in your final message. aim for every source function covered.
- only source change allowed: adding `export` to existing functions. do not commit. list created/changed files at the end.
