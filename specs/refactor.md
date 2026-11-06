# spec: modularize ankitab (behavior-preserving refactor)

repo: ankitab. the test suite in `tests/` pins current behavior. this refactor splits the big modules, removes duplication and cleans up branching. **behavior must not change.** run `bash test.sh` after every step; every step ends green.

the work is split into numbered steps. you will be told which step to do. do only that step, then stop and report. do not commit (the reviewer commits between steps).

## ground rules

- plain js es modules, tabs for indentation (match the files), no build step, no new dependencies, no new permissions.
- `sandbox.js`, `theme-init.js` and `bg.js` are classic scripts (sandbox page / early theme paint / background). they cannot import modules. leave their loading model alone.
- tests: when a function moves, update the test's import path and `vi.mock` paths, and move its tests into the test file named after the new module (`tests/<module>.test.js`). do not weaken or delete assertions. if a test asserts on an implementation detail that no longer exists (a removed duplicate), replace it with an equivalent test on the new shared helper and say so in the report.
- clean code: small functions with one job, names that say what they do, no flag arguments that switch a function between two unrelated behaviors, early returns over nested ifs, no dead code, no comments that restate the code (keep comments that explain *why*).
- keep every exported name that other modules or tests use, unless the step says to move it.

## step 1: shared helpers

create:

- `extension/libs/dom.js`
  - `el(tag, className, text)` (the current duplicate from doneScreen.js / offlineScreen.js).
  - `showOverlay(content)` → replaces `#overlay` children with `content`, unhides it. `hideOverlay()` → hides and empties it. use these everywhere `#overlay` is shown/hidden today (doneScreen, offlineScreen, cards.js batch continue).
- `extension/libs/chromeApi.js` — every chrome api that is callback-or-promise goes through one helper:
  - `callChrome(fn, ...args)` → promise; works whether `fn` takes a callback or returns a promise; reads `chrome.runtime.lastError`.
  - `storageGet(keys)`, `storageSet(values)`.
  - `permissionsContains(perms, fallback)` (resolves `fallback` when the api is missing or throws — ankiConnect uses `true`, doneScreen uses `!!chrome.topSites`), `permissionsRequest(perms)` (false when missing/throws).
  - `getTopSites()`.
- `extension/libs/url.js`: `isRemoteUrl(src)` (the `/^[a-z][a-z0-9+.-]*:|^\/\//i` test used three times in cards.js) and `mediaFilename(src)` (`decodeURIComponent(src.split(/[?#]/)[0])`, used three times).

replace the duplicates in `ankiConnect.js`, `settings.js` (may use `storageGet`/`storageSet`), `rotateDeck.js`, `doneScreen.js`, `offlineScreen.js`, `options.js`, `cards.js`. tests for the new modules go in `tests/dom.test.js`, `tests/chromeApi.test.js`, `tests/url.test.js`.

## step 2: done screen

split `doneScreen.js`:

- `extension/app/js/done/stats.js`: `startOfAnkiDay`, `formatDuration`, `reviewedToday`, `timeStudiedToday`, `nextDueTomorrow`, `buildStats(settings)` (returns the `.done-stats` element and fills it async).
- `extension/app/js/done/fallback.js`: `searchUrl`, `buildSearch`, `buildTopSites`, `buildFallback(settings)` (async, returns a fragment or null). resolve the mode with a small `resolveFallbackMode(mode, topSitesAllowed)` pure function instead of the current reassignment chain.
- `extension/app/js/doneScreen.js`: composition only. replace the `if (!blank && batch) … else if (!blank)` chain with a header builder chosen once:
  ```js
  function buildHeader({blank, batch}, settings) {
  	if (blank) return [];
  	if (batch) return batchHeader(batch);
  	return [el('h1', '', 'Congratulations! You have finished for now.')];
  }
  ```
  `batchHeader(batch)` returns `[h1, p.batch-sub, button.batch-continue]`. the stats block and the Options/Sync links are added once, after the header, whenever `!blank` (today both branches duplicate them). `showDoneScreen(options)` reads like: settings → header → stats+links (unless blank) → fallback → showOverlay → focus search. dom order and text must stay exactly as today.

## step 3: card rendering pipeline out of cards.js

- `extension/app/js/sandboxFrame.js`: `frameReady` promise, `postToSandbox(message, transfer)`, `postTheme()` (merge cards.js `postThemeToSandbox` and main.js `postTheme`; main.js imports it), `setDimmed(bool)` for the 0.4 opacity.
- `extension/app/js/media.js`: `bufferToText`, `base64ToBuffer`, `replaceAudioTags`, `buildCardHTML`, `inlineMediaScripts`, the media cache, `getMediaDataUri`, `resolveMedia`.
- `extension/app/js/fonts.js`: `cssValue`, `extractLocalFontFaces`, `sendFontToSandbox`, `prepareCardCss`.
- `extension/app/js/renderCard.js`: `renderInSandbox(card, content, {answer, autoFlip})` (takes the card and flags as arguments instead of reading cards.js module state) and `prefetchAnswer(card)`.

## step 4: answer bar

`extension/app/js/answerBar.js`: due counts (`clearDueCounts`, `renderDueCounts`, `fetchDueCounts(deckName, enabled)` with its own request counter), `showQuestionControls`, `showAnswerControls(names, intervals, onAnswer)`, `buttonNames(count)`, `setAnswerButtonsDisabled`. cards.js keeps `currentButtonNames`/`goodIndex` as thin wrappers or moves them here with the card passed in.

## step 5: batch mode

`extension/app/js/batch.js`, no dom outside its own render function, no anki calls:

- `createBatch()` → `{count, off}` state object, or a tiny class; methods/functions: `limit(settings)`, `recordAnswer(settings)` → returns `true` when the batch is complete, `undoAnswer()`, `keepGoing()`.
- `isOnBreak(settings, now)`, `breakEndsAt(settings, now)` (returns 0 when no break is configured).
- `renderBatchProgress(container, batch, settings)`.

cards.js uses it; the batch-done screen wiring stays in cards.js (`showBatchDone`).

## step 6: reviewer core and options

- `cards.js` keeps only the review state machine: `start`, `startStudy`, `continueStudy`, `getCard`, `renderQuestion`, `renderAnswer`, `answerQuestion`, `undo`, `suspendCard`, `buryCard`, `editNote`, error routing, keyboard wiring. `startStudy` and `continueStudy` are identical today: keep one implementation and alias the other name if tests or callers need it. target well under 300 lines.
- `options.js`: split into `readForm()` / `fillForm(settings)` / `renderDecks` / `loadDeckNames()` / `saved` so `saved` no longer mixes validation, topSites permission and saving inline; extract `validateSearchUrl(input)` and `ensureTopSitesPermission(settings, select)`.
- delete any export that existed only for the old layout and is no longer imported by anything (check with grep, including tests).

## report after each step

files created/changed, tests run (pass count), anything you could not do.
