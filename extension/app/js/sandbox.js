// Renders card HTML and runs card JavaScript the way Anki desktop does, so that
// templates with dynamic content (multiple choice, cloze reveal, randomisers,
// persistence between front and back...) keep working.
//
// What Anki desktop gives a card's scripts, and how it is emulated here:
// - scripts run in order, in the global scope       -> indirect (global) eval
// - inline handlers (onclick="...") work              -> converted to listeners
// - DOMContentLoaded / load / window.onload fire      -> captured and fired after render
// - onUpdateHook / onShownHook arrays                 -> provided and called after render
// - the same document lives through front and back    -> this iframe is never reloaded,
//   so globals, sessionStorage and window state persist (e.g. the selected choice)
// - the card container is #qa inside body.card        -> same ids/classes are provided

const globalEval = eval; // calling through a reference makes eval run in the global scope

window.onUpdateHook = [];
window.onShownHook = [];

// Theme. The parent re-sends it before every render too; the query param is only
// the initial hint so the document does not paint white before the first message.
function applyTheme(dark) {
	currentDark = !!dark;
	document.documentElement.classList.toggle('dark-theme', currentDark);
	if (document.body) {
		document.body.classList.toggle('dark-theme', currentDark);
		document.body.classList.toggle('nightMode', currentDark);
		document.body.classList.toggle('night_mode', currentDark);
	}
}

let currentDark = new URLSearchParams(location.search).get('theme') === 'dark';
applyTheme(currentDark);
document.addEventListener('DOMContentLoaded', () => applyTheme(currentDark));

function runCode(code, label) {
  try {
    globalEval(code);
  } catch (e) {
    console.warn('AnkiTab: card script failed (' + label + ')', e);
  }
}

// Inline event handler attributes are blocked by the extension CSP; rebuild them
// as real listeners. `this` is the element and `event` is available, as in HTML.
function convertInlineHandlers(root) {
  const elems = root.querySelectorAll ? Array.from(root.querySelectorAll('*')) : [];
  if (root.nodeType === Node.ELEMENT_NODE) elems.unshift(root);
  elems.forEach((elem) => {
    for (const attr of Array.from(elem.attributes)) {
      if (!attr.name.startsWith('on')) continue;
      const code = attr.value;
      const type = attr.name.slice(2);
      elem.removeAttribute(attr.name);
      let fn;
      try {
        fn = new Function('event', code);
      } catch (e) {
        console.warn('AnkiTab: bad inline handler', attr.name, e);
        continue;
      }
      elem.addEventListener(type, function (event) {
        try {
          if (fn.call(this, event) === false) event.preventDefault();
        } catch (e) {
          console.warn('AnkiTab: inline handler failed', attr.name, e);
        }
      });
    }
    // <a href="javascript:..."> links
    if (elem.tagName === 'A' && /^\s*javascript:/i.test(elem.getAttribute('href') || '')) {
      const code = elem.getAttribute('href').replace(/^\s*javascript:/i, '');
      elem.setAttribute('href', '#');
      elem.addEventListener('click', (event) => {
        event.preventDefault();
        runCode(decodeURIComponent(code), 'javascript: link');
      });
    }
  });
}

// Scripts usually wait for the page to load, but this document loaded long ago.
// Collect those listeners while the card's scripts run and fire them afterwards.
function withLoadEventCapture(run) {
  const captured = [];
  const origDocAdd = document.addEventListener;
  const origWinAdd = window.addEventListener;
  const capture = (target, orig) => function (type, listener, options) {
    if ((type === 'DOMContentLoaded' || type === 'load') && listener) {
      captured.push({target, type, listener});
      return;
    }
    return orig.call(this, type, listener, options);
  };
  document.addEventListener = capture(document, origDocAdd);
  window.addEventListener = capture(window, origWinAdd);
  const origOnload = window.onload;
  window.onload = null;
  try {
    run();
  } finally {
    document.addEventListener = origDocAdd;
    window.addEventListener = origWinAdd;
  }
  const newOnload = window.onload;
  window.onload = origOnload;
  return () => {
    for (const {target, type, listener} of captured) {
      try {
        const event = new Event(type);
        if (typeof listener === 'function') listener.call(target, event);
        else if (listener && typeof listener.handleEvent === 'function') listener.handleEvent(event);
      } catch (e) {
        console.warn('AnkiTab: ' + type + ' handler failed', e);
      }
    }
    if (typeof newOnload === 'function') {
      try { newOnload.call(window, new Event('load')); } catch (e) { console.warn('AnkiTab: onload failed', e); }
    }
  };
}

// Card scripts often build their UI later (e.g. multiple-choice buttons with
// onclick="..."), so keep converting handlers on anything added afterwards.
const handlerObserver = new MutationObserver((mutations) => {
  for (const m of mutations) {
    if (m.type === 'attributes') {
      if (m.attributeName.startsWith('on') || m.attributeName === 'href') convertInlineHandlers(m.target);
    } else {
      m.addedNodes.forEach((node) => node.nodeType === Node.ELEMENT_NODE && convertInlineHandlers(node));
    }
  }
});

function observeHandlers(container) {
  handlerObserver.disconnect();
  handlerObserver.observe(container, {subtree: true, childList: true, attributes: true});
}

function runHooks(hooks) {
  for (const hook of hooks.splice(0)) {
    try { hook(); } catch (e) { console.warn('AnkiTab: hook failed', e); }
  }
}

function loadExternalScript(src) {
  return new Promise((resolve) => {
    const tag = document.createElement('script');
    tag.src = src;
    tag.onload = tag.onerror = () => resolve();
    document.head.appendChild(tag);
  });
}

// Multiple choice: once every radio group has an option picked, show the back
// side without waiting for space. The parent decides whether this is allowed
// (setting on, question side) and sends it with each render.
let autoFlip = false;
let flipTimer = null;
let flippedThisRender = false;

function cancelAutoFlip() {
  if (flipTimer !== null) {
    clearTimeout(flipTimer);
    flipTimer = null;
  }
}

// Radios are grouped by name; unnamed radios are each a group of their own.
function allRadioGroupsAnswered(container) {
  const groups = new Map();
  Array.from(container.querySelectorAll('input[type="radio"]')).forEach((radio, index) => {
    const key = radio.name ? 'name:' + radio.name : 'anon:' + index;
    groups.set(key, groups.get(key) || radio.checked);
  });
  return groups.size > 0 && Array.from(groups.values()).every(Boolean);
}

document.addEventListener('change', (event) => {
  if (!autoFlip || flippedThisRender) return;
  const target = event.target;
  if (!target || target.tagName !== 'INPUT' || target.type !== 'radio') return;
  const container = document.querySelector('#qa');
  if (!container || !container.contains(target)) return;
  // Multi-answer cards: the user decides when they are done and presses space.
  if (container.querySelector('input[type="checkbox"]')) return;
  if (!allRadioGroupsAnswered(container)) return;
  // The card's own onInput/onCheck handler saves the selection first; the short
  // delay also lets the user see the dot before the answer replaces the card.
  cancelAutoFlip();
  flipTimer = setTimeout(() => {
    flipTimer = null;
    if (!autoFlip || flippedThisRender) return;
    flippedThisRender = true;
    window.parent.postMessage({command: 'showAnswer'}, '*');
  }, 200);
}, true);

// A card can need finishing after its html is in the document: MathJax has to
// typeset and images have to decode. Only then is the new content shown, so a
// flip swaps in one finished paint instead of popping media and raw TeX in.
const TEX_DELIMITERS = /\\\(|\\\[|\$\$|\\begin\{/;
const FINISH_TIMEOUT = 250;

// Only MathJax needs the container hidden: it typesets in place, so raw TeX
// would show for a moment. Images are decoded before the swap instead (see
// predecodeImages), which keeps the old card on screen rather than a blank.
function needsFinishing(html) {
	return TEX_DELIMITERS.test(html);
}

// Decode the new card's images off-screen before its html replaces the old
// card. Decoded data URIs are then painted in the same frame as the swap.
function predecodeImages(html) {
	const tpl = document.createElement('template');
	tpl.innerHTML = html;
	const decodes = Array.from(tpl.content.querySelectorAll('img[src]')).map((elem) => {
		const img = new Image();
		img.src = elem.getAttribute('src');
		return typeof img.decode === 'function' ? img.decode() : Promise.resolve();
	});
	if (!decodes.length) return Promise.resolve();
	return Promise.race([
		Promise.allSettled(decodes),
		new Promise((resolve) => setTimeout(resolve, FINISH_TIMEOUT)),
	]);
}

// Every render bumps this. An older render that is still awaiting something
// (scripts, media, typesetting) checks it and stops touching the document.
let renderToken = 0;

// MathJax is loaded at the end of sandbox.html, so early renders have to retry
// until it is ready. The promise resolves once typesetting has actually run.
function typesetAndWait(container) {
	return new Promise((resolve) => {
		const attempt = () => {
			try {
				MathJax.Hub.Queue(["Typeset", MathJax.Hub, container], resolve);
			} catch (e) {
				setTimeout(attempt, 300);
			}
		};
		attempt();
	});
}

async function finish(container) {
	const token = renderToken;
	const pending = [];
	if (TEX_DELIMITERS.test(container.innerHTML)) pending.push(typesetAndWait(container));
	if (!pending.length) return;
	// A slow or broken asset must never leave the card invisible.
	await Promise.race([
		Promise.all(pending),
		new Promise((resolve) => setTimeout(resolve, FINISH_TIMEOUT)),
	]);
	if (token !== renderToken) return; // a newer render owns the container now
}

// Fonts from the card's @font-face rules arrive as raw bytes (see cards.js) and
// are registered here once. A render waits for faces still loading so the card
// does not paint in a fallback font and then reflow.
const fontFaces = new Map(); // key -> load promise
const FONT_TIMEOUT = 3000;

// Firefox's font sanitizer rejects TrueType collections (.ttc), which Anki
// desktop (Chromium) accepts and renders with the collection's first font.
// Rebuild that first font as a standalone sfnt so both engines show the same.
function ttcToSfnt(buffer) {
  const src = new DataView(buffer);
  if (buffer.byteLength < 16 || src.getUint32(0) !== 0x74746366) return buffer; // 'ttcf'
  const fontOffset = src.getUint32(12);
  const numTables = src.getUint16(fontOffset + 4);
  const tables = [];
  for (let i = 0; i < numTables; i++) {
    const rec = fontOffset + 12 + i * 16;
    tables.push({
      tag: src.getUint32(rec),
      checksum: src.getUint32(rec + 4),
      offset: src.getUint32(rec + 8),
      length: src.getUint32(rec + 12),
    });
  }
  const headerSize = 12 + numTables * 16;
  const total = tables.reduce((sum, t) => sum + ((t.length + 3) & ~3), headerSize);
  const out = new ArrayBuffer(total);
  const dst = new DataView(out);
  const bytes = new Uint8Array(out);
  // sfntVersion, numTables, searchRange, entrySelector, rangeShift
  bytes.set(new Uint8Array(buffer, fontOffset, 12), 0);
  let cursor = headerSize;
  tables.forEach((t, i) => {
    const rec = 12 + i * 16;
    dst.setUint32(rec, t.tag);
    dst.setUint32(rec + 4, t.checksum);
    dst.setUint32(rec + 8, cursor);
    dst.setUint32(rec + 12, t.length);
    bytes.set(new Uint8Array(buffer, t.offset, t.length), cursor);
    cursor += (t.length + 3) & ~3;
  });
  return out;
}

function addFont(key, family, descriptors, data) {
  if (fontFaces.has(key)) return;
  let face;
  try {
    data = ttcToSfnt(data);
    face = new FontFace(family, data, descriptors || {});
  } catch (e) {
    console.warn('AnkiTab: invalid font', family, e);
    return;
  }
  const loading = face.load().then(() => {
    document.fonts.add(face);
  }).catch((e) => {
    console.warn('AnkiTab: font failed to load', family, e);
  });
  fontFaces.set(key, loading);
}

function fontsSettled() {
  if (!fontFaces.size) return Promise.resolve();
  return Promise.race([
    Promise.all(fontFaces.values()),
    new Promise((resolve) => setTimeout(resolve, FONT_TIMEOUT)),
  ]);
}

async function render(html, options = {}) {
	const token = ++renderToken;
	await fontsSettled();
	if (token !== renderToken) return;
	const container = document.querySelector('#qa');
	// A new card (or its back) invalidates any pending auto-flip.
	cancelAutoFlip();
	flippedThisRender = false;
	autoFlip = !options.answer && !!options.autoFlip;
	window.onUpdateHook = [];
	window.onShownHook = [];
	handlerObserver.disconnect();
	await predecodeImages(html);
	if (token !== renderToken) return;
	// Hide the container only while the new html is being finished; anything
	// else is complete within this task, so hiding it would be a visible blank.
	const hide = needsFinishing(html);
	container.classList.toggle('rendering', hide);
	container.innerHTML = html;
	convertInlineHandlers(container);
	observeHandlers(container);

	// Scripts inserted via innerHTML don't run; run them in document order.
	const scripts = Array.from(container.getElementsByTagName('script'));
	let fireLoadEvents = () => {};
	const inlineQueue = [];
	for (const script of scripts) {
		const type = (script.getAttribute('type') || '').toLowerCase();
		if (type && !/javascript|ecmascript|^module$/.test(type)) continue; // e.g. text/template, json
		inlineQueue.push(script);
	}
	for (const script of inlineQueue) {
		if (script.src) {
			await loadExternalScript(script.src);
			if (token !== renderToken) return;
		} else {
			const fire = withLoadEventCapture(() => runCode(script.textContent, 'inline script'));
			const prev = fireLoadEvents;
			fireLoadEvents = () => { prev(); fire(); };
		}
	}
	fireLoadEvents();
	runHooks(window.onUpdateHook);
	runHooks(window.onShownHook);
	await finish(container);
	if (token !== renderToken) return;
	if (options.answer) {
		// Anki scrolls the answer separator into view after showing the back.
		// Scrolling before the reveal keeps the jump invisible.
		const answer = container.querySelector('hr#answer') || container.querySelector('#answer');
		if (answer) answer.scrollIntoView({block: 'start'});
	}
	container.classList.remove('rendering');
}

function replayAudio() {
  const media = Array.from(document.querySelectorAll('#qa audio, #qa video'));
  let index = 0;
  const playNext = () => {
    if (index >= media.length) return;
    const elem = media[index++];
    const advance = () => {
      elem.removeEventListener('ended', advance);
      playNext();
    };
    elem.addEventListener('ended', advance);
    try {
      elem.currentTime = 0;
    } catch (e) { /* not seekable yet */ }
    try {
      const promise = elem.play();
      if (promise && typeof promise.catch === 'function') promise.catch(advance);
    } catch (e) {
      advance();
    }
  };
  playNext();
}

// Only inputs that accept text count as editable: the answer's radio and
// checkbox options also take focus, but typing there must still reach the
// reviewer shortcuts.
const NON_TEXT_INPUT_TYPES = ['radio', 'checkbox', 'button', 'submit', 'reset', 'range', 'color', 'file', 'image'];

function isEditable(target) {
  if (!target || !target.tagName) return false;
  const tag = target.tagName.toLowerCase();
  if (tag === 'input') return NON_TEXT_INPUT_TYPES.indexOf((target.type || 'text').toLowerCase()) === -1;
  return tag === 'textarea' || tag === 'select' || target.isContentEditable;
}

// The iframe steals focus when the card is clicked, so keyboard input has to be
// forwarded to the parent's dispatcher.
window.addEventListener('keydown', (event) => {
  if (isEditable(event.target)) return;
  if (event.key === ' ') event.preventDefault();
  window.parent.postMessage({
    command: 'key',
    key: event.key,
    code: event.code,
    ctrlKey: event.ctrlKey,
    shiftKey: event.shiftKey,
    altKey: event.altKey,
    metaKey: event.metaKey,
    repeat: event.repeat
  }, '*');
});

window.addEventListener('message', async function(event) {
  if (!event.data || typeof event.data !== 'object') return;
  switch(event.data.command) {
  case 'theme':
    applyTheme(event.data.dark);
    break;
  case 'font':
    addFont(event.data.key, event.data.family, event.data.descriptors, event.data.data);
    break;
  case 'render':
    window.mutex = render(event.data.html, {answer: !!event.data.answer, autoFlip: !!event.data.autoFlip});
    break;
  case 'replayAudio':
    replayAudio();
    break;
  case 'replaceMedia':
    await window.mutex;
    document.querySelectorAll(`[src="${CSS.escape(decodeURI(event.data.oldSrc))}"]`).forEach((elem)=>{
      elem.src = event.data.newSrc;
    });
  }
});
