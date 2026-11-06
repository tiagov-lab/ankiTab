"""Render README screenshots of the new tab page against a fake AnkiConnect.

usage: python3 tools/screenshots.py   (writes promo/screenshots/*.png)
serves extension/ on a local port, stubs the chrome.* apis the pages use and
answers AnkiConnect requests with a small fixed deck.
"""
import functools
import http.server
import json
import pathlib
import threading

from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
EXT = ROOT / "extension"
OUT = ROOT / "promo" / "screenshots"
PORT = 8799

CARD_CSS = """.card { font-family: Georgia, serif; font-size: 26px; text-align: center; color: inherit; background: transparent; }
.hint { font-family: system-ui, sans-serif; font-size: 15px; opacity: .6; margin-top: 10px; }"""

CARDS = [
    ("What does <b>saudade</b> mean?<div class='hint'>Portuguese</div>",
     "a deep longing for something or someone absent"),
    ("Which organelle produces most of a cell's ATP?", "the mitochondrion"),
    ("<i>e<sup>iπ</sup> + 1 = ?</i>", "0 (Euler's identity)"),
]

CHROME_SHIM = """
(() => {
  const store = Object.assign({
    deckNames: ['Languages::Portuguese', 'Science'], excludedDecks: [], emptyDecks: [], lastDeck: '',
    interleavingDisabled: false, interleavingTrigger: 1, doneShowStats: true, doneShowNextDue: true,
    doneFallback: 'both', doneSearchUrl: 'https://duckduckgo.com/?q=%s', showDueCounts: true,
    autoFlipChoice: true, batchSize: 0, batchBreakMinutes: 0, batchFreeUntil: 0,
  }, SEED);
  const listeners = [];
  const pick = (keys) => {
    if (keys == null) return Object.assign({}, store);
    if (typeof keys === 'string') keys = [keys];
    if (Array.isArray(keys)) { const r = {}; keys.forEach(k => { if (k in store) r[k] = store[k]; }); return r; }
    const r = Object.assign({}, keys); Object.keys(keys).forEach(k => { if (k in store) r[k] = store[k]; }); return r;
  };
  const cb = (f, v) => { setTimeout(() => f && f(v), 0); };
  window.chrome = {
    runtime: { getURL: p => location.origin + '/' + p, lastError: undefined },
    storage: {
      local: {
        get: (k, f) => cb(f, pick(k)),
        set: (o, f) => { const ch = {}; for (const k in o) { ch[k] = {oldValue: store[k], newValue: o[k]}; store[k] = o[k]; } listeners.forEach(l => l(ch, 'local')); cb(f); },
      },
      onChanged: { addListener: l => listeners.push(l) },
    },
    permissions: { contains: (p, f) => cb(f, true), request: (p, f) => cb(f, true) },
    topSites: { get: f => cb(f, [
      {url: 'https://github.com', title: 'GitHub'}, {url: 'https://news.ycombinator.com', title: 'HN'},
      {url: 'https://www.wikipedia.org', title: 'Wikipedia'}, {url: 'https://mail.proton.me', title: 'Mail'},
      {url: 'https://www.youtube.com', title: 'YouTube'}, {url: 'https://ankiweb.net', title: 'AnkiWeb'},
    ]) },
  };
  try { localStorage.setItem('ankitab-theme', THEME); } catch (e) {}
})();
"""


class Anki:
    def __init__(self):
        self.index = 0
        self.answered = 0

    def card(self):
        q, a = CARDS[self.index % len(CARDS)]
        return {
            "cardId": 1000 + self.index, "deckName": "Languages::Portuguese" if self.index == 0 else "Science",
            "question": q, "answer": q + "<hr id=answer>" + a, "css": CARD_CSS,
            "buttons": [1, 2, 3, 4], "nextReviews": ["<1m", "<6m", "<10m", "4d"],
        }

    def handle(self, action, params):
        if action == "guiCurrentCard":
            return self.card()
        if action == "guiAnswerCard":
            self.index += 1
            self.answered += 1
            return True
        if action == "deckNames":
            return ["Languages::Portuguese", "Science"]
        if action == "getDeckStats":
            return {"1": {"new_count": 12, "learn_count": 3, "review_count": 41}}
        if action == "getNumCardsReviewedToday":
            return 37 + self.answered
        if action == "findCards":
            return []
        if action == "retrieveMediaFile":
            return False
        return True


def serve():
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(EXT))
    handler.log_message = lambda *a: None
    server = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


def new_page(browser, theme="light", seed=None, size=(1280, 760)):
    context = browser.new_context(viewport={"width": size[0], "height": size[1]}, device_scale_factor=2,
                                  color_scheme="dark" if theme == "dark" else "light")
    anki = Anki()

    def route(r):
        body = json.loads(r.request.post_data or "{}")
        result = anki.handle(body.get("action"), body.get("params", {}))
        r.fulfill(status=200, headers={"Access-Control-Allow-Origin": "*", "Content-Type": "application/json"},
                  body=json.dumps({"result": result, "error": None}))

    context.route("http://127.0.0.1:8765/**", route)
    shim = CHROME_SHIM.replace("SEED", json.dumps(seed or {})).replace("THEME", json.dumps(theme))
    context.add_init_script(shim)
    page = context.new_page()
    return page


def card_ready(page):
    page.wait_for_function("document.querySelector('#flashcardSandbox').contentDocument?.querySelector('#qa')?.textContent.trim().length > 0")
    page.wait_for_timeout(600)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    server = serve()
    base = f"http://127.0.0.1:{PORT}/app/index.html"
    with sync_playwright() as p:
        browser = p.chromium.launch()

        page = new_page(browser, "light")
        page.goto(base)
        card_ready(page)
        page.screenshot(path=str(OUT / "question.png"))
        page.keyboard.press("Space")
        card_ready(page)
        page.screenshot(path=str(OUT / "answer.png"))

        page = new_page(browser, "dark", {"batchSize": 5})
        page.goto(base)
        card_ready(page)
        for _ in range(2):
            page.keyboard.press("Space")
            page.wait_for_timeout(400)
            page.keyboard.press("3")
            page.wait_for_timeout(700)
        card_ready(page)
        page.screenshot(path=str(OUT / "batch-progress-dark.png"))

        page = new_page(browser, "light", {"batchSize": 2, "batchBreakMinutes": 0})
        page.goto(base)
        card_ready(page)
        for _ in range(2):
            page.keyboard.press("Space")
            page.wait_for_timeout(400)
            page.keyboard.press("3")
            page.wait_for_timeout(700)
        page.wait_for_selector(".batch-continue")
        page.wait_for_timeout(500)
        page.screenshot(path=str(OUT / "batch-done.png"))

        page = new_page(browser, "dark", {"batchSize": 5, "batchFreeUntil": 4102444800000})
        page.goto(base)
        page.wait_for_selector(".batch-continue")
        page.wait_for_timeout(500)
        page.screenshot(path=str(OUT / "break-dark.png"))

        page = new_page(browser, "light", {"batchSize": 10, "batchBreakMinutes": 20}, size=(900, 1500))
        page.goto(f"http://127.0.0.1:{PORT}/options/index.html")
        page.wait_for_selector("#decks .deck")
        page.wait_for_timeout(400)
        page.screenshot(path=str(OUT / "options.png"), full_page=True)

        browser.close()
    server.shutdown()
    print("wrote", *sorted(x.name for x in OUT.glob("*.png")))


if __name__ == "__main__":
    main()
