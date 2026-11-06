# spec: multiple choice fixes (space after selecting, auto-flip)

repo: ankitab. read `extension/app/js/sandbox.js`, `extension/app/js/keys.js`, `extension/app/js/cards.js`, `extension/app/js/main.js`, `extension/libs/settings.js`, `extension/bg.js`, `extension/options/index.html`, `extension/options/options.js` first.

## context

the user's multiple-choice note type ("Carnet B", the AnkiDroid-style multiple choice template) renders options as `<input type="radio">` or `<input type="checkbox">` inside `#qa`, with `onInput="onCheck()"` on the surrounding `<td>` (converted to a listener by sandbox.js). `onCheck()` stores the selection in `Persistence` (sessionStorage) so the back side can grade it. three layouts:

- single choice: radios, all sharing `name="ans_A"`
- kprim (yes/no per statement): one radio group per row, `name="ans_1"`, `name="ans_2"`, …
- multiple answers: checkboxes

## bug 1: space does nothing after selecting an option

clicking an option focuses the input. `isEditable` (sandbox.js) and `isEditableTarget` (keys.js) treat every `<input>` as editable, so space is never forwarded / handled.

fix both functions identically: an `<input>` is editable only when its type is a text-entry type. non-editable input types: `radio`, `checkbox`, `button`, `submit`, `reset`, `range`, `color`, `file`, `image`. `textarea`, `select` and contenteditable stay editable. keep the existing `preventDefault()` for space in sandbox.js, so space on a focused checkbox shows the answer instead of toggling it.

## feature: selecting an option flips the card

new setting `autoFlipChoice`, default `true`, in `DEFAULT_SETTINGS` (settings.js) and the duplicated defaults in bg.js. options page: a checkbox in the "Appearance" section (or a new "Reviewing" section placed before "When you're done"): "Show the answer as soon as a multiple choice option is picked". it saves like the other settings.

behavior, implemented in sandbox.js (it sees the card's dom) with the decision gated by the parent:

- the parent includes `autoFlip: <bool>` in the `render` message: `settings.autoFlipChoice && !isAnswer`. sandbox.js stores it per render (`false` for answer renders).
- sandbox.js adds one `change` listener on `document` (capture phase is fine). when `autoFlip` is on for the current render and the event target is an `input[type=radio]` inside `#qa`:
  - if `#qa` contains any `input[type=checkbox]`, do nothing (multi-answer: the user decides when they are done and presses space).
  - collect all radio groups in `#qa` by `name` (radios without a name count as their own group). if every group has a checked radio, schedule a flip.
  - flip = after 200 ms (lets the card's own `onInput`/`onCheck` handler save the selection, and lets the user see the dot), post `{command: 'showAnswer'}` to `window.parent`. cancel a pending flip if a new `render` arrives first. never post more than once per render.
- the parent's existing `message` listener in main.js (which already checks `event.source === frame.contentWindow`) handles `command === 'showAnswer'` by calling `renderAnswer()` (it already returns early unless the state is `question`).

## acceptance

1. single-choice card: click an option → answer shows ~0.2 s later with the selection graded by the back template.
2. kprim card: answer shows only after every row has yes or no picked.
3. checkbox card: picking options never flips; space then shows the answer.
4. after clicking any option, space shows the answer (with auto-flip off too).
5. typing in a text `<input>` (type-in-the-answer cards) still never triggers shortcuts.
6. setting off → no auto-flip.
7. answer side: clicking radios never triggers anything.

constraints: plain js, no inline scripts/handlers, don't touch the card-script emulation in sandbox.js beyond adding the above. list changed files at the end. do not commit.
