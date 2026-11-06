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

async function render(html, options = {}) {
  const container = document.querySelector('#qa');
  window.onUpdateHook = [];
  window.onShownHook = [];
  handlerObserver.disconnect();
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
    } else {
      const fire = withLoadEventCapture(() => runCode(script.textContent, 'inline script'));
      const prev = fireLoadEvents;
      fireLoadEvents = () => { prev(); fire(); };
    }
  }
  fireLoadEvents();
  runHooks(window.onUpdateHook);
  runHooks(window.onShownHook);
  typeset();
  if (options.answer) {
    // Anki scrolls the answer separator into view after showing the back.
    setTimeout(() => {
      const answer = container.querySelector('hr#answer') || container.querySelector('#answer');
      if (answer) answer.scrollIntoView({block: 'start'});
    }, 0);
  }
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

function isEditable(target) {
  if (!target || !target.tagName) return false;
  const tag = target.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable;
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
  case 'render':
    window.mutex = render(event.data.html, {answer: !!event.data.answer});
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

function typeset(){
  try{
    MathJax.Hub.Queue(["Typeset", MathJax.Hub, document.querySelector('#qa')]);
  } catch(e){
    setTimeout(typeset, 300);
  }
}
