import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest';
import {loadClassicScript} from './helpers/classic.js';
import {stubLocation, restoreLocation, sleep} from './helpers/dom.js';

const EXPORTS = [
	'applyTheme',
	'runCode',
	'convertInlineHandlers',
	'withLoadEventCapture',
	'observeHandlers',
	'runHooks',
	'loadExternalScript',
	'allRadioGroupsAnswered',
	'needsFinishing',
	'predecodeImages',
	'typesetAndWait',
	'finish',
	'ttcToSfnt',
	'addFont',
	'fontsSettled',
	'render',
	'replayAudio',
	'isEditable',
	'cancelAutoFlip',
];

function loadSandbox({search = ''} = {}) {
	if (search) stubLocation(search);
	return loadClassicScript('extension/app/js/sandbox.js', EXPORTS);
}

let sb;

beforeEach(() => {
	document.body.innerHTML = '<div id="qa"></div>';
	document.documentElement.className = '';
	delete globalThis.MathJax;
	delete window.MathJax;
	Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
	vi.useRealTimers();
	restoreLocation();
});

function load() {
	sb = loadSandbox();
	return sb;
}

async function sendRender(html, options = {}) {
	window.dispatchEvent(
		new MessageEvent('message', {
			data: {command: 'render', html, answer: !!options.answer, autoFlip: options.autoFlip !== false},
		})
	);
	await window.mutex;
	await Promise.resolve();
}

const qa = () => document.querySelector('#qa');

describe('isEditable', () => {
	it.each(['text', 'search', 'email', 'number', 'password'])('treats input type %s as editable', (type) => {
		load();
		const input = document.createElement('input');
		input.type = type;
		expect(sb.isEditable(input)).toBe(true);
	});

	it.each(['radio', 'checkbox', 'button', 'range'])('keeps shortcuts on input type %s', (type) => {
		load();
		const input = document.createElement('input');
		input.type = type;
		expect(sb.isEditable(input)).toBe(false);
	});

	it('treats contenteditable, textarea and select as editable', () => {
		load();
		const div = document.createElement('div');
		Object.defineProperty(div, 'isContentEditable', {value: true});
		expect(sb.isEditable(div)).toBe(true);
		expect(sb.isEditable(document.createElement('textarea'))).toBe(true);
		expect(sb.isEditable(document.createElement('select'))).toBe(true);
	});

	it('returns false for null and plain elements', () => {
		load();
		expect(sb.isEditable(null)).toBe(false);
		expect(sb.isEditable(document.createElement('div'))).toBeFalsy();
	});
});

describe('allRadioGroupsAnswered', () => {
	it('is false with no radios', () => {
		load();
		expect(sb.allRadioGroupsAnswered(qa())).toBe(false);
	});

	it('is true when every named group has a checked option', () => {
		load();
		qa().innerHTML =
			'<input type="radio" name="a" checked><input type="radio" name="a"><input type="radio" name="b"><input type="radio" name="b" checked>';
		expect(sb.allRadioGroupsAnswered(qa())).toBe(true);
	});

	it('is false when one group is unanswered', () => {
		load();
		qa().innerHTML = '<input type="radio" name="a" checked><input type="radio" name="b">';
		expect(sb.allRadioGroupsAnswered(qa())).toBe(false);
	});

	it('treats every unnamed radio as its own group', () => {
		load();
		qa().innerHTML = '<input type="radio" checked><input type="radio" checked>';
		expect(sb.allRadioGroupsAnswered(qa())).toBe(true);
		qa().innerHTML = '<input type="radio" checked><input type="radio">';
		expect(sb.allRadioGroupsAnswered(qa())).toBe(false);
	});
});

describe('needsFinishing', () => {
	it('detects tex delimiters', () => {
		load();
		expect(sb.needsFinishing('x \\( y')).toBe(true);
		expect(sb.needsFinishing('\\[x\\]')).toBe(true);
		expect(sb.needsFinishing('$$x$$')).toBe(true);
		expect(sb.needsFinishing('\\begin{align}')).toBe(true);
	});

	it('does not hide ordinary html', () => {
		load();
		expect(sb.needsFinishing('<b>plain</b>')).toBe(false);
	});
});

describe('convertInlineHandlers', () => {
	it('turns onclick attributes into listeners with this and event', () => {
		load();
		const button = document.createElement('button');
		button.setAttribute('onclick', "this.dataset.clicked = '1'; window.__eventType = event.type;");
		document.body.appendChild(button);
		sb.convertInlineHandlers(button);
		expect(button.hasAttribute('onclick')).toBe(false);
		button.click();
		expect(button.dataset.clicked).toBe('1');
		expect(window.__eventType).toBe('click');
	});

	it('converts handlers on descendants too', () => {
		load();
		const container = document.createElement('div');
		container.innerHTML = '<span onclick="window.__child = 1"></span>';
		document.body.appendChild(container);
		sb.convertInlineHandlers(container);
		container.querySelector('span').click();
		expect(window.__child).toBe(1);
	});

	it('prevents the default when the handler returns false', () => {
		load();
		const link = document.createElement('a');
		link.setAttribute('onclick', 'return false');
		link.href = '#';
		document.body.appendChild(link);
		sb.convertInlineHandlers(link);
		const event = new MouseEvent('click', {bubbles: true, cancelable: true});
		link.dispatchEvent(event);
		expect(event.defaultPrevented).toBe(true);
	});

	it('runs javascript: hrefs and neutralises the href', () => {
		load();
		const link = document.createElement('a');
		link.setAttribute('href', 'javascript:window.__jsLink = 7');
		document.body.appendChild(link);
		sb.convertInlineHandlers(link);
		expect(link.getAttribute('href')).toBe('#');
		link.click();
		expect(window.__jsLink).toBe(7);
	});

	it('drops a handler that does not compile', () => {
		load();
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const div = document.createElement('div');
		div.setAttribute('onclick', '(');
		document.body.appendChild(div);
		sb.convertInlineHandlers(div);
		expect(div.hasAttribute('onclick')).toBe(false);
		expect(warn).toHaveBeenCalled();
	});

	it('warns when an inline handler throws', () => {
		load();
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const button = document.createElement('button');
		button.setAttribute('onclick', 'throw new Error("boom")');
		document.body.appendChild(button);
		sb.convertInlineHandlers(button);
		button.click();
		expect(warn).toHaveBeenCalledWith('AnkiTab: inline handler failed', 'onclick', expect.any(Error));
	});

	it('does nothing for a root without querySelectorAll', () => {
		load();
		expect(() => sb.convertInlineHandlers(document.createTextNode('x'))).not.toThrow();
	});
});

describe('ttcToSfnt', () => {
	function buildTtc() {
		const buffer = new ArrayBuffer(80);
		const view = new DataView(buffer);
		const bytes = new Uint8Array(buffer);
		bytes.set([0x74, 0x74, 0x63, 0x66], 0); // 'ttcf'
		new DataView(buffer).setUint32(12, 24);
		new DataView(buffer).setUint32(24, 0x00010000);
		new DataView(buffer).setUint16(28, 1);
		new DataView(buffer).setUint32(36, 0x636d6170); // 'cmap'
		new DataView(buffer).setUint32(40, 0x11111111);
		new DataView(buffer).setUint32(44, 64);
		new DataView(buffer).setUint32(48, 4);
		bytes.set([1, 2, 3, 4], 64);
		return buffer;
	}

	it('rebuilds the first font of a collection as a standalone sfnt', () => {
		load();
		const out = sb.ttcToSfnt(buildTtc());
		expect(out).toBeInstanceOf(ArrayBuffer);
		expect(out.byteLength).toBe(32);
		const view = new DataView(out);
		expect(view.getUint32(0)).toBe(0x00010000);
		expect(view.getUint16(4)).toBe(1);
		expect(view.getUint32(12)).toBe(0x636d6170);
		expect(view.getUint32(16)).toBe(0x11111111);
		expect(view.getUint32(20)).toBe(28);
		expect(view.getUint32(24)).toBe(4);
		expect(Array.from(new Uint8Array(out, 28))).toEqual([1, 2, 3, 4]);
	});

	it('returns plain fonts untouched', () => {
		load();
		const buffer = new ArrayBuffer(64);
		expect(sb.ttcToSfnt(buffer)).toBe(buffer);
	});

	it('returns short buffers unchanged', () => {
		load();
		const buffer = new ArrayBuffer(8);
		new Uint8Array(buffer).set([0x74, 0x74, 0x63, 0x66], 0);
		expect(sb.ttcToSfnt(buffer)).toBe(buffer);
	});
});

describe('predecodeImages', () => {
	it('resolves right away without images', async () => {
		load();
		await expect(sb.predecodeImages('<b>no images</b>')).resolves.toBeUndefined();
	});

	it('decodes images when the browser supports it', async () => {
		load();
		const decode = vi.fn(() => Promise.resolve());
		Object.defineProperty(HTMLImageElement.prototype, 'decode', {configurable: true, value: decode});
		try {
			await sb.predecodeImages('<img src="a.png"><img src="b.png">');
			expect(decode).toHaveBeenCalledTimes(2);
		} finally {
			delete HTMLImageElement.prototype.decode;
		}
	});

	it('does not wait forever for slow images', async () => {
		vi.useFakeTimers();
		load();
		const decode = vi.fn(() => new Promise((resolve) => setTimeout(resolve, 1000)));
		Object.defineProperty(HTMLImageElement.prototype, 'decode', {configurable: true, value: decode});
		try {
			const promise = sb.predecodeImages('<img src="a.png">');
			await vi.advanceTimersByTimeAsync(250);
			await expect(promise).resolves.toBeUndefined();
		} finally {
			delete HTMLImageElement.prototype.decode;
		}
	});
});

describe('render', () => {
	it('puts the html in #qa', async () => {
		load();
		await sb.render('<b>hello</b>');
		expect(qa().innerHTML).toBe('<b>hello</b>');
	});

	it('runs inline scripts in order and fires load listeners afterwards', async () => {
		load();
		await sb.render(
			'<script>window.__order = ["script"]; document.addEventListener("DOMContentLoaded", () => window.__order.push("dom")); window.addEventListener("load", () => window.__order.push("load")); window.onload = () => window.__order.push("onload");</script>'
		);
		expect(window.__order).toEqual(['script', 'dom', 'load', 'onload']);
	});

	it('skips non-javascript script types', async () => {
		load();
		await sb.render('<script type="text/template">window.__templateRan = 1;</script>');
		expect(window.__templateRan).toBeUndefined();
	});

	it('runs card hooks', async () => {
		load();
		await sb.render('<script>window.onUpdateHook.push(() => { window.__updated = 1; }); window.onShownHook.push(() => { window.__shown = 1; });</script>');
		expect(window.__updated).toBe(1);
		expect(window.__shown).toBe(1);
		expect(window.onUpdateHook).toEqual([]);
	});

	it('converts inline handlers in the rendered card', async () => {
		load();
		await sb.render('<button id="b" onclick="window.__clicked = 1">x</button>');
		document.querySelector('#b').click();
		expect(window.__clicked).toBe(1);
	});

	it('scrolls the answer into view for answer renders', async () => {
		load();
		const scroll = vi.spyOn(Element.prototype, 'scrollIntoView');
		await sb.render('<hr id="answer">', {answer: true});
		expect(scroll).toHaveBeenCalledWith({block: 'start'});
	});

	it('shows the rendering class only while tex is being finished', async () => {
		vi.useFakeTimers();
		load();
		const promise = sb.render('$$x$$');
		await vi.advanceTimersByTimeAsync(0);
		expect(qa().classList.contains('rendering')).toBe(true);
		await vi.advanceTimersByTimeAsync(300);
		await promise;
		expect(qa().classList.contains('rendering')).toBe(false);
	});

	it('uses MathJax when it is available', async () => {
		load();
		const queue = vi.fn((args, done) => done());
		window.MathJax = {Hub: {Queue: queue}};
		await sb.render('$$x$$');
		expect(queue).toHaveBeenCalled();
		expect(qa().textContent).toContain('$$x$$');
	});

	it('loads external scripts before finishing the render', async () => {
		load();
		const promise = sb.render('<script src="card-helper.js"></script><b>after</b>');
		await sleep(0);
		const tags = Array.from(document.head.querySelectorAll('script'));
		const tag = tags[tags.length - 1];
		expect(tag.getAttribute('src')).toContain('card-helper.js');
		tag.dispatchEvent(new Event('load'));
		await promise;
		expect(qa().textContent).toContain('after');
	});

	it('waits for fonts before rendering', async () => {
		load();
		class FakeFontFace {
			constructor() {}
			load() {
				return new Promise((resolve) => setTimeout(() => resolve(this), 10));
			}
		}
		window.FontFace = FakeFontFace;
		Object.defineProperty(document, 'fonts', {configurable: true, value: {add: vi.fn()}});
		vi.useFakeTimers();
		sb.addFont('k1', 'Fam', {}, new ArrayBuffer(8));
		const promise = sb.render('<b>after font</b>');
		await vi.advanceTimersByTimeAsync(20);
		await promise;
		expect(qa().innerHTML).toBe('<b>after font</b>');
	});
});

describe('auto flip', () => {
	it('shows the answer once after a radio group is answered', async () => {
		vi.useFakeTimers();
		load();
		await sendRender('<input type="radio" name="g" value="1">');
		const post = vi.spyOn(window, 'postMessage').mockImplementation(() => {});
		const radio = qa().querySelector('input');
		radio.checked = true;
		radio.dispatchEvent(new Event('change', {bubbles: true}));
		await vi.advanceTimersByTimeAsync(199);
		expect(post).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(1);
		expect(post).toHaveBeenCalledTimes(1);
		expect(post).toHaveBeenCalledWith({command: 'showAnswer'}, '*');
		radio.dispatchEvent(new Event('change', {bubbles: true}));
		await vi.advanceTimersByTimeAsync(300);
		expect(post).toHaveBeenCalledTimes(1);
	});

	it('waits for every radio group', async () => {
		vi.useFakeTimers();
		load();
		await sendRender('<input type="radio" name="a"><input type="radio" name="b">');
		const post = vi.spyOn(window, 'postMessage').mockImplementation(() => {});
		const [first, second] = qa().querySelectorAll('input');
		first.checked = true;
		first.dispatchEvent(new Event('change', {bubbles: true}));
		await vi.advanceTimersByTimeAsync(300);
		expect(post).not.toHaveBeenCalled();
		second.checked = true;
		second.dispatchEvent(new Event('change', {bubbles: true}));
		await vi.advanceTimersByTimeAsync(200);
		expect(post).toHaveBeenCalledWith({command: 'showAnswer'}, '*');
	});

	it('never auto-flips cards with checkboxes', async () => {
		vi.useFakeTimers();
		load();
		await sendRender('<input type="checkbox"><input type="radio" name="g">');
		const post = vi.spyOn(window, 'postMessage').mockImplementation(() => {});
		const radio = qa().querySelector('input[type="radio"]');
		radio.checked = true;
		radio.dispatchEvent(new Event('change', {bubbles: true}));
		await vi.advanceTimersByTimeAsync(300);
		expect(post).not.toHaveBeenCalled();
	});

	it('never auto-flips on answer renders', async () => {
		vi.useFakeTimers();
		load();
		await sendRender('<input type="radio" name="g">', {answer: true});
		const post = vi.spyOn(window, 'postMessage').mockImplementation(() => {});
		const radio = qa().querySelector('input');
		radio.checked = true;
		radio.dispatchEvent(new Event('change', {bubbles: true}));
		await vi.advanceTimersByTimeAsync(300);
		expect(post).not.toHaveBeenCalled();
	});

	it('is cancelled by a new render', async () => {
		vi.useFakeTimers();
		load();
		await sendRender('<input type="radio" name="g">');
		const post = vi.spyOn(window, 'postMessage').mockImplementation(() => {});
		const radio = qa().querySelector('input');
		radio.checked = true;
		radio.dispatchEvent(new Event('change', {bubbles: true}));
		await sendRender('<b>new card</b>');
		await vi.advanceTimersByTimeAsync(300);
		expect(post).not.toHaveBeenCalled();
	});

	it('ignores changes that are not radio inputs inside the card', async () => {
		vi.useFakeTimers();
		load();
		await sendRender('<input type="radio" name="g"><input id="text" type="text">');
		const post = vi.spyOn(window, 'postMessage').mockImplementation(() => {});
		qa().querySelector('#text').dispatchEvent(new Event('change', {bubbles: true}));
		const outside = document.createElement('input');
		outside.type = 'radio';
		outside.checked = true;
		document.body.appendChild(outside);
		outside.dispatchEvent(new Event('change', {bubbles: true}));
		await vi.advanceTimersByTimeAsync(300);
		expect(post).not.toHaveBeenCalled();
	});
});

describe('keydown forwarding', () => {
	it('forwards keys to the parent', () => {
		load();
		const post = vi.spyOn(window, 'postMessage').mockImplementation(() => {});
		document.body.dispatchEvent(
			new KeyboardEvent('keydown', {key: ' ', code: 'Space', ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, bubbles: true, cancelable: true})
		);
		expect(post).toHaveBeenCalledWith(
			{
				command: 'key',
				key: ' ',
				code: 'Space',
				ctrlKey: false,
				shiftKey: false,
				altKey: false,
				metaKey: false,
				repeat: false,
			},
			'*'
		);
	});

	it('prevents the page from scrolling on space', () => {
		load();
		vi.spyOn(window, 'postMessage').mockImplementation(() => {});
		const event = new KeyboardEvent('keydown', {key: ' ', bubbles: true, cancelable: true});
		document.body.dispatchEvent(event);
		expect(event.defaultPrevented).toBe(true);
	});

	it('does not forward keys typed in an input', () => {
		load();
		const post = vi.spyOn(window, 'postMessage').mockImplementation(() => {});
		const input = document.createElement('input');
		input.type = 'text';
		document.body.appendChild(input);
		input.dispatchEvent(new KeyboardEvent('keydown', {key: 'a', bubbles: true}));
		expect(post).not.toHaveBeenCalled();
	});
});

describe('replayAudio', () => {
	it('plays every clip in order, waiting for ended', () => {
		load();
		const first = document.createElement('audio');
		const second = document.createElement('audio');
		first.play = vi.fn(() => Promise.resolve());
		second.play = vi.fn(() => Promise.resolve());
		qa().appendChild(first);
		qa().appendChild(second);
		sb.replayAudio();
		expect(first.play).toHaveBeenCalledTimes(1);
		expect(second.play).not.toHaveBeenCalled();
		first.dispatchEvent(new Event('ended'));
		expect(second.play).toHaveBeenCalledTimes(1);
	});

	it('advances when play throws', () => {
		load();
		const bad = document.createElement('audio');
		const good = document.createElement('audio');
		bad.play = vi.fn(() => {
			throw new Error('no audio');
		});
		good.play = vi.fn(() => Promise.resolve());
		qa().appendChild(bad);
		qa().appendChild(good);
		sb.replayAudio();
		expect(good.play).toHaveBeenCalledTimes(1);
	});

	it('advances when play rejects', async () => {
		load();
		const bad = document.createElement('audio');
		const good = document.createElement('audio');
		bad.play = vi.fn(() => Promise.reject(new Error('blocked')));
		good.play = vi.fn(() => Promise.resolve());
		qa().appendChild(bad);
		qa().appendChild(good);
		sb.replayAudio();
		await sleep(0);
		expect(good.play).toHaveBeenCalledTimes(1);
	});

	it('does nothing without media', () => {
		load();
		expect(() => sb.replayAudio()).not.toThrow();
	});
});

describe('theme messages', () => {
	it('applies the dark theme classes from the query string on load', () => {
		sb = loadSandbox({search: '?theme=dark'});
		expect(document.documentElement.classList.contains('dark-theme')).toBe(true);
		expect(document.body.classList.contains('dark-theme')).toBe(true);
		expect(document.body.classList.contains('nightMode')).toBe(true);
		expect(document.body.classList.contains('night_mode')).toBe(true);
	});

	it('applies and clears the theme from a message', async () => {
		load();
		window.dispatchEvent(new MessageEvent('message', {data: {command: 'theme', dark: true}}));
		expect(document.documentElement.classList.contains('dark-theme')).toBe(true);
		window.dispatchEvent(new MessageEvent('message', {data: {command: 'theme', dark: false}}));
		expect(document.documentElement.classList.contains('dark-theme')).toBe(false);
		expect(document.body.classList.contains('nightMode')).toBe(false);
	});

	it('applyTheme toggles the classes directly', () => {
		load();
		sb.applyTheme(true);
		expect(document.documentElement.classList.contains('dark-theme')).toBe(true);
		sb.applyTheme(false);
		expect(document.documentElement.classList.contains('dark-theme')).toBe(false);
	});
});

describe('font and audio messages', () => {
	it('registers a font sent over a message', async () => {
		load();
		window.FontFace = class {
			constructor(family) {
				this.family = family;
			}
			load() {
				return Promise.resolve(this);
			}
		};
		Object.defineProperty(document, 'fonts', {configurable: true, value: {add: vi.fn()}});
		const data = new ArrayBuffer(8);
		window.dispatchEvent(
			new MessageEvent('message', {data: {command: 'font', key: 'message-font', family: 'Fam', descriptors: {}, data}})
		);
		await sb.fontsSettled();
		expect(document.fonts.add).toHaveBeenCalledTimes(1);
		expect(document.fonts.add.mock.calls[0][0].family).toBe('Fam');
	});

	it('replays audio on a replayAudio message', () => {
		load();
		const audio = document.createElement('audio');
		audio.play = vi.fn(() => Promise.resolve());
		qa().appendChild(audio);
		window.dispatchEvent(new MessageEvent('message', {data: {command: 'replayAudio'}}));
		expect(audio.play).toHaveBeenCalledTimes(1);
	});
});

describe('replaceMedia message', () => {
	it('replaces matching sources after the current render', async () => {
		load();
		globalThis.CSS = {escape: (value) => value};
		qa().innerHTML = '<img src="old.png">';
		window.dispatchEvent(new MessageEvent('message', {data: {command: 'replaceMedia', oldSrc: 'old.png', newSrc: 'new.png'}}));
		await sleep(0);
		expect(qa().querySelector('img').getAttribute('src')).toBe('new.png');
	});
});

describe('fonts', () => {
	class FakeFontFace {
		constructor(family, data, descriptors) {
			this.family = family;
			this.data = data;
			this.descriptors = descriptors;
		}
		load() {
			return Promise.resolve(this);
		}
	}

	it('registers a font once and resolves the font promise', async () => {
		load();
		window.FontFace = FakeFontFace;
		const add = vi.fn();
		Object.defineProperty(document, 'fonts', {configurable: true, value: {add}});
		sb.addFont('key1', 'Fam', {weight: '700'}, new ArrayBuffer(8));
		sb.addFont('key1', 'Fam', {weight: '700'}, new ArrayBuffer(8));
		await sb.fontsSettled();
		expect(add).toHaveBeenCalledTimes(1);
		expect(add.mock.calls[0][0].family).toBe('Fam');
	});

	it('converts ttc fonts before registering them', async () => {
		load();
		window.FontFace = FakeFontFace;
		Object.defineProperty(document, 'fonts', {configurable: true, value: {add: vi.fn()}});
		const ttc = new ArrayBuffer(80);
		const view = new DataView(ttc);
		new Uint8Array(ttc).set([0x74, 0x74, 0x63, 0x66], 0);
		view.setUint32(12, 24);
		view.setUint32(24, 0x00010000);
		view.setUint16(28, 0);
		sb.addFont('ttc1', 'Fam', {}, ttc);
		await sb.fontsSettled();
		expect(document.fonts.add.mock.calls[0][0].data.byteLength).toBe(12);
	});

	it('warns and skips an invalid font', async () => {
		load();
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		window.FontFace = function () {
			throw new Error('bad font');
		};
		Object.defineProperty(document, 'fonts', {configurable: true, value: {add: vi.fn()}});
		sb.addFont('bad', 'Fam', {}, new ArrayBuffer(8));
		await sb.fontsSettled();
		expect(warn).toHaveBeenCalled();
		expect(document.fonts.add).not.toHaveBeenCalled();
	});

	it('settles even when a font fails to load', async () => {
		load();
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		window.FontFace = class {
			load() {
				return Promise.reject(new Error('bad'));
			}
		};
		Object.defineProperty(document, 'fonts', {configurable: true, value: {add: vi.fn()}});
		sb.addFont('fail', 'Fam', {}, new ArrayBuffer(8));
		await expect(sb.fontsSettled()).resolves.toBeDefined();
		expect(warn).toHaveBeenCalled();
	});
});

describe('helpers', () => {
	it('runCode evaluates in the global scope and warns on errors', () => {
		load();
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		sb.runCode('window.__ran = 5;', 'test');
		expect(window.__ran).toBe(5);
		expect(() => sb.runCode('throw new Error("x")', 'test')).not.toThrow();
		expect(warn).toHaveBeenCalled();
	});

	it('runHooks drains the array, isolating throwing hooks', () => {
		load();
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const good = vi.fn();
		const hooks = [
			() => {
				throw new Error('boom');
			},
			good,
		];
		sb.runHooks(hooks);
		expect(good).toHaveBeenCalledTimes(1);
		expect(hooks).toEqual([]);
		expect(warn).toHaveBeenCalled();
	});

	it('loadExternalScript resolves on load or error', async () => {
		load();
		const promise = sb.loadExternalScript('card.js');
		const tag = document.head.querySelector('script[src="card.js"]');
		expect(tag).not.toBeNull();
		tag.dispatchEvent(new Event('load'));
		await expect(promise).resolves.toBeUndefined();
	});

	it('withLoadEventCapture fires load listeners after running', () => {
		load();
		const seen = [];
		const fire = sb.withLoadEventCapture(() => {
			document.addEventListener('DOMContentLoaded', () => seen.push('dom'));
			window.addEventListener('load', () => seen.push('load'));
			window.onload = () => seen.push('onload');
		});
		expect(seen).toEqual([]);
		fire();
		expect(seen).toEqual(['dom', 'load', 'onload']);
	});

	it('withLoadEventCapture keeps ordinary listeners registered', () => {
		load();
		const clicked = vi.fn();
		const fire = sb.withLoadEventCapture(() => {
			window.addEventListener('click', clicked);
		});
		fire();
		window.dispatchEvent(new Event('click'));
		expect(clicked).toHaveBeenCalledTimes(1);
	});

	it('withLoadEventCapture fires object listeners with handleEvent', () => {
		load();
		const seen = [];
		const fire = sb.withLoadEventCapture(() => {
			document.addEventListener('DOMContentLoaded', {
				handleEvent() {
					seen.push('object');
				},
			});
		});
		fire();
		expect(seen).toEqual(['object']);
	});

	it('withLoadEventCapture warns when a captured listener throws', () => {
		load();
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const fire = sb.withLoadEventCapture(() => {
			document.addEventListener('DOMContentLoaded', () => {
				throw new Error('boom');
			});
		});
		fire();
		expect(warn).toHaveBeenCalledWith('AnkiTab: DOMContentLoaded handler failed', expect.any(Error));
	});

	it('withLoadEventCapture restores window.onload', () => {
		load();
		window.onload = () => {};
		const before = window.onload;
		const fire = sb.withLoadEventCapture(() => {});
		fire();
		expect(window.onload).toBe(before);
	});

	it('observeHandlers converts handlers on later added elements', async () => {
		load();
		sb.observeHandlers(qa());
		const button = document.createElement('button');
		button.setAttribute('onclick', 'window.__later = 1');
		qa().appendChild(button);
		await sleep(0);
		expect(button.hasAttribute('onclick')).toBe(false);
		button.click();
		expect(window.__later).toBe(1);
	});

	it('observeHandlers converts handlers set on existing elements', async () => {
		load();
		const button = document.createElement('button');
		qa().appendChild(button);
		sb.observeHandlers(qa());
		button.setAttribute('onclick', 'window.__changed = 1');
		await sleep(0);
		expect(button.hasAttribute('onclick')).toBe(false);
		button.click();
		expect(window.__changed).toBe(1);
	});

	it('cancelAutoFlip is safe with no pending flip', () => {
		load();
		expect(() => sb.cancelAutoFlip()).not.toThrow();
	});
});
