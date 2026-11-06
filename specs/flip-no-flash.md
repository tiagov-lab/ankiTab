# flip without flashing

## problem

flipping a card (question → answer) visibly flashes. causes, in order of impact:

1. **media round trip.** `renderInSandbox` (extension/app/js/cards.js) posts html whose `<img>`/`<audio>`/`<video>` `src` is a bare anki filename (e.g. `paste-123.jpg`). inside the sandbox that resolves to a non-existent extension url, so the image renders broken/empty. only afterwards `retrieveMedia()` fetches each file through ankiconnect and posts `replaceMedia` with a data uri. the back side usually repeats the front's images, so on every flip the images vanish and pop back in, shifting layout.
2. **mathjax.** `typeset()` in extension/app/js/sandbox.js runs after the html is already painted, so raw `\(...\)` / `\[...\]` text shows for a moment, then gets replaced by rendered math (layout jumps).
3. **image decode.** even data-uri images decode asynchronously; the frame can paint before they decode, showing a zero-height image then a jump.
4. **answer scroll.** `scrollIntoView` on `#answer` runs in a `setTimeout` after paint, so the card paints at the top then jumps.

## goal

a flip (and a new card) replaces the old content with the fully finished new content in one paint: no broken images, no raw tex, no jump. keep every existing behaviour of card scripts (see header comment of sandbox.js) intact.

## changes

### 1. media cache + pre-resolution (extension/app/js/cards.js)

- add a module-level `mediaCache = new Map()` mapping decoded filename → promise of data uri string (or `null` on failure). store the promise, not the value, so concurrent requests share one fetch.
- `getMediaDataUri(filename)`: returns cached promise or starts `ankiConnectInvoke("retrieveMediaFile", {filename})` → `"data:" + (MIME[ext] || "application/octet-stream") + ";base64," + data`; resolve `null` on error or empty data (log with `console.warn` like the current code) and delete the entry on failure so a later render can retry.
- cap the cache: when it holds more than 200 entries, delete the oldest (map insertion order) — keeps memory bounded over long sessions.
- new `async function resolveMedia(html)`: parse with a `<template>` (same pattern as `inlineMediaScripts`), find every element with a `src` attribute except `<script>` (img, audio, video, source, embed, etc.), skip srcs that already have a scheme (`/^[a-z][a-z0-9+.-]*:|^\/\//i`, same regex as `inlineMediaScripts`), and replace `src` with the data uri. filename = `decodeURIComponent(src.split(/[?#]/)[0])`. fetch all in parallel. if one fails leave its src untouched. return `tpl.innerHTML`.
- also resolve `url(...)` references inside the card css? **no** — out of scope, leave css alone.
- `renderInSandbox`: build html as `await resolveMedia(await inlineMediaScripts(buildCardHTML(...)))` before posting. keep the `seq !== renderSeq` guard *after* all awaits.
- delete `retrieveMedia()` and the `#flashcard` hidden-div write (`document.querySelector("#flashcard").innerHTML = html`) — they only existed for the old lazy media path. check extension/app/index.html: if `#flashcard` exists only for this, remove that element too.
- **prefetch the back:** at the end of `renderQuestion()` (after starting the question render), fire-and-forget a prefetch of the answer: `inlineMediaScripts` is not needed, just run `resolveMedia(buildCardHTML(card.css, card.answer))` without awaiting and ignore the result, so the answer's media is in the cache by the time the user flips. catch and ignore errors.
- because the answer html now waits on media before posting, a flip must not feel slower than before: thanks to the prefetch the common case resolves from cache instantly. no spinner needed.

### 2. atomic swap in the sandbox (extension/app/js/sandbox.js + css/reviewer.css)

- in `render()`, right before `container.innerHTML = html`, hide the container with `container.style.visibility = 'hidden'` **only when the new html needs async finishing**, i.e. when it contains tex delimiters (`\(`, `\[`, `$$`, `\begin{`) or `<img`. otherwise do nothing — everything else is synchronous in the same task and never paints half-done.
- after scripts and hooks have run, call a new `async function finish(container)` that:
  - awaits mathjax typesetting via a promise: `MathJax.Hub.Queue(["Typeset", MathJax.Hub, container], resolve)`. if `MathJax` is not ready yet, keep the existing retry behaviour but resolve the promise once typesetting eventually runs. skip mathjax entirely when the html has no tex delimiters.
  - awaits `img.decode()` for every `#qa img` (use `Promise.allSettled`, ignore failures).
  - races all of that against a **250 ms timeout** so a slow or broken asset never leaves the card invisible.
- after `finish` resolves (or times out): if `options.answer`, do the `#answer` scroll synchronously (no `setTimeout`), then set `container.style.visibility = ''`. scroll then reveal in the same task, so no jump is visible.
- **stale render guard:** add a module-level `renderToken` counter incremented at the start of every `render()`. after each `await` inside `render()`/`finish`, bail out if the token changed (a newer card arrived), without touching visibility — the newer render owns it.
- `window.mutex` must still resolve only after the render (including finish) completes, so the `replaceMedia` handler keeps working if the parent still sends it for any reason. keep the `replaceMedia` handler as-is.
- the auto-flip `change` listener and keyboard forwarding stay untouched.

### 3. answer-button fade (extension/app/js/cards.js, css/main.css)

- leave the `opacity: 0.4` busy dim on answering as-is — it is feedback for the next card, not the flip.

## acceptance checks

- card with an image on front and back: flipping shows the image continuously, no blank/broken frame, no layout shift.
- card with mathjax (`\(x^2\)`): neither side ever shows raw tex.
- card with a long back: after flip the view is already scrolled to `#answer`, no visible jump.
- plain-text card: flip is instant, never invisible.
- broken media filename: card still appears within ~250 ms, other media still loads.
- multiple-choice template (`_mc.js` style, inline scripts + onclick handlers + auto-flip): selection persists to the back, auto-flip still works.
- rapid space presses / fast answering: no stale card shows up, no card stuck invisible.
- `node --check` passes on every edited js file (they are es modules / plain scripts; use `node --check --input-type=module < file` for cards.js).

## don't

- don't touch manifests, build.sh, sign.sh, libs/.
- don't add dependencies.
- don't change the theme logic.
