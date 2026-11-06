# spec: batch mode (do n cards, then the tab is yours)

repo: ankitab. read `extension/app/js/cards.js`, `extension/app/js/doneScreen.js`, `extension/app/js/main.js`, `extension/app/index.html`, `extension/app/css/main.css`, `extension/libs/settings.js`, `extension/bg.js`, `extension/options/index.html`, `extension/options/options.js` first.

## idea

today every new tab is an endless review session. batch mode caps it: each new tab asks for `n` answered cards, then swaps to a "batch done" screen with the search box / top sites so the user can go do what they opened the tab for. optional break: after finishing a batch, new tabs skip the cards for `m` minutes.

## settings

add to `DEFAULT_SETTINGS` in `extension/libs/settings.js` and the duplicated `defaults` in `extension/bg.js`:

- `batchSize: 0` — cards per tab. `0` = off (current endless behavior).
- `batchBreakMinutes: 0` — minutes new tabs stay free after a finished batch. `0` = no break.
- `batchFreeUntil: 0` — runtime state, epoch ms. not shown in options.

options page (`extension/options/index.html`): new section "Batch mode" placed right after the "Reviewing" section (before "When you're done"), same markup style as its neighbors:

- number input `id="batchSize"`, class `form-control save`, `min="0" max="200" step="1"`, label "Cards per new tab (0 = no limit)".
- number input `id="batchBreakMinutes"`, class `form-control save`, `min="0" max="1440" step="1"`, label "After a batch, keep new tabs free for this many minutes (0 = off)".
- small help text under the section: "Once you answer this many cards, the tab switches to search and your top sites."

`options.js` saves `.save` elements as strings for non-checkboxes. make `getValue` return a `Number` for `type="number"` inputs: `parseInt`, clamp to the input's `min`/`max`, `NaN` → `0`. `setValue` already works.

## behavior (cards.js)

module state in cards.js:

- `let batchCount = 0;` answered cards in this tab.
- `let batchOff = false;` set when the user chooses to keep going; disables the cap for the rest of this tab.

helper `batchLimit()` → `batchOff ? 0 : (Number(settings.batchSize) || 0)`.

counting: in `answerQuestion`, after `guiAnswerCard` resolves, `batchCount++`. then if `batchLimit() > 0 && batchCount >= batchLimit()`:
- `state = 'busy'` (it already is).
- if `Number(settings.batchBreakMinutes) > 0`, write `batchFreeUntil = Date.now() + minutes * 60000` with `chrome.storage.local.set`.
- call `showBatchDone()` (below) and return without calling `continueStudy()`.

otherwise continue as today. suspend and bury do not count. `undo()` decrements `batchCount` (not below 0) after a successful `guiUndo`.

startup: in `start()`, after `loadSettings()` and after the existing `blank=1` branch, before `startStudy()`: if `batchSize > 0` and `Date.now() < settings.batchFreeUntil`, set `state = 'busy'`, `clearDueCounts()`, call `showBatchDone({onBreak: true})` and return. no anki calls are made in that case (the tab must open instantly and must not move anki's reviewer).

`showBatchDone(opts)` in cards.js calls `showDoneScreen({batch: {count: batchCount, onBreak: !!opts?.onBreak, freeUntil: settings.batchFreeUntil, onContinue}})` where `onContinue`:
- sets `batchOff = true`.
- hides `#overlay` (`overlay.hidden = true; overlay.replaceChildren()`).
- if it came from the break (`onBreak`), call `startStudy()`; otherwise `continueStudy()`.

if the deck runs out before the batch is done, the normal done screen shows, as today.

## progress indicator

`index.html`: inside `#questionControls`, before `#dueCounts`, add `<div id="batchProgress" class="batch-progress" hidden aria-label="batch progress"></div>`.

`renderBatchProgress()` in cards.js, called from `renderQuestion()` and whenever `batchSize` changes via the storage listener:
- hidden when `batchLimit() === 0`.
- limit ≤ 12: one `<span class="batch-dot">` per card, the first `batchCount` get class `filled`. the dot for the card on screen (index `batchCount`) gets class `current`.
- limit > 12: text `"{batchCount + 1} / {limit}"`.
- `title` attribute: `"card {batchCount + 1} of {limit} in this tab"`.

css (`main.css`): `.batch-progress` is a centered flex row, gap 5px, margin-bottom 4px. `.batch-dot` 7px circle, `border: 1px solid currentColor`, opacity 0.45, transparent fill. `.filled` filled with currentColor, opacity 0.8. `.current` opacity 0.9 (outline only). text variant: font-size 12px, opacity 0.7, tabular numbers. both themes inherit color, no hard-coded colors. transition the fill (150ms) so a dot visibly fills; honor `prefers-reduced-motion`.

## batch done screen (doneScreen.js)

extend `showDoneScreen(options)` with `options.batch`. when present:

- heading: `"{count} cards done"` (`"1 card done"` for 1). when `onBreak`: heading `"Break time"` and a `<p class="batch-sub">` with `"Cards are back at {HH:MM}"` (locale time of `freeUntil`, `toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'})`).
- not on break: a `<p class="batch-sub">` with `"The rest can wait."`.
- stats block as today (respects `doneShowStats` / `doneShowNextDue`).
- the fallback (search / top sites) as today. search input still gets focus.
- a button `class="anki-btn batch-continue"`: text `"Keep studying"` (or `"Study anyway"` on break), click → `options.batch.onContinue()`. place it under the heading/sub, above the stats.
- keep the `addLinks` row (Options, Sync).
- the old "Congratulations!" heading is not shown in batch mode.

css: `.batch-sub` muted (opacity 0.7), margin below. `.batch-continue` margin 8px auto 16px, centered.

## edge cases

- `batchSize` changed in options while a tab is open: the storage listener already copies into `settings`; re-render the progress indicator. if the new limit is already ≤ `batchCount` the cap triggers on the next answer, not instantly.
- multiple tabs: each tab counts its own batch. `batchFreeUntil` is shared through storage.
- `batchSize = 0`: zero visible change vs today (progress hidden, no new screen, `batchFreeUntil` ignored).
- the answered card that completes the batch is saved in anki before the screen swaps (await `guiAnswerCard` first).
- key shortcuts do nothing while the batch screen shows (state stays `busy`).
- clicking "Keep studying" must not leave the sandbox at 0.4 opacity (render already resets it; verify).

## acceptance

1. `batchSize=3`: new tab shows 3 dots; each answer fills one; after the 3rd answer the batch screen appears with search focused.
2. "Keep studying" → next card appears, dots hidden, no further cap in that tab.
3. `batchBreakMinutes=10`: after a batch, a new tab opens straight to "Break time / Cards are back at …" with no card flash and no AnkiConnect call; "Study anyway" starts reviewing.
4. undo after answering decrements the dots.
5. `batchSize=0`: behavior identical to before.
6. options page round-trips both numbers (saved as numbers, reload shows them).

constraints: plain js modules, no inline scripts/handlers, no new permissions, no build step. do not touch sandbox.js. do not bump versions. list changed files at the end. do not commit.
