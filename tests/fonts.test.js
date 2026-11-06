import {describe, it, expect, vi, beforeEach} from 'vitest';
import {loadAppPage} from './helpers/dom.js';

const mocks = vi.hoisted(() => ({anki: vi.fn()}));

vi.mock('../extension/libs/ankiConnect.js', () => ({default: mocks.anki}));

async function loadFonts() {
	loadAppPage();
	const frame = document.querySelector('#flashcardSandbox');
	const postMessage = vi.fn();
	// jsdom replaces the iframe's browsing context when src changes; pin the
	// object the extension talks to so the spy cannot be swapped out.
	Object.defineProperty(frame, 'contentWindow', {configurable: true, get: () => ({postMessage})});
	frame.setAttribute('src', 'moz-extension://test/app/sandbox.html');
	vi.resetModules();
	const mod = await import('../extension/app/js/fonts.js');
	frame.dispatchEvent(new Event('load'));
	return {mod, frame, postMessage};
}

const fontMessages = (postMessage) =>
	postMessage.mock.calls.map((call) => call[0]).filter((message) => message.command === 'font');

const css = '@font-face { font-family: "F"; src: url("_f.ttf"); font-weight: 700; }';
const FONT_B64 = btoa(String.fromCharCode(0, 1, 0, 0));

function mockFont(result) {
	mocks.anki.mockImplementation((action) => {
		if (action === 'retrieveMediaFile') return Promise.resolve(result);
		return Promise.resolve();
	});
}

beforeEach(() => {
	vi.clearAllMocks();
	mocks.anki.mockResolvedValue(undefined);
});

describe('css parsing', () => {
	it('cssValue reads a property and trims it', async () => {
		const {mod} = await loadFonts();
		const block = '@font-face { font-family: "Yumin"; src: url(_f.ttf); }';
		expect(mod.cssValue(block, 'font-family')).toBe('"Yumin"');
		expect(mod.cssValue(block, 'src')).toBe('url(_f.ttf)');
		expect(mod.cssValue(block, 'font-weight')).toBe('');
	});

	it('extractLocalFontFaces strips local font faces and reports them', async () => {
		const {mod} = await loadFonts();
		const result = mod.extractLocalFontFaces(
			'.card{color:red} @font-face { font-family: "Yumin"; src: url("_yumin.ttf") format("truetype"); font-weight: 400; font-style: normal; } .x{color:blue}'
		);
		expect(result.css).toBe('.card{color:red}  .x{color:blue}');
		expect(result.faces).toEqual([{family: 'Yumin', filename: '_yumin.ttf', descriptors: {weight: '400', style: 'normal'}}]);
	});

	it('extractLocalFontFaces decodes the filename', async () => {
		const {mod} = await loadFonts();
		const result = mod.extractLocalFontFaces('@font-face { font-family: F; src: url("my%20font.ttf?v=1"); }');
		expect(result.faces[0].filename).toBe('my font.ttf');
	});

	it('extractLocalFontFaces keeps remote fonts in the css', async () => {
		const {mod} = await loadFonts();
		const result = mod.extractLocalFontFaces('@font-face { font-family: F; src: url(https://example.com/f.woff2); }');
		expect(result.faces).toEqual([]);
		expect(result.css).toContain('@font-face');
	});

	it('extractLocalFontFaces keeps a face without family', async () => {
		const {mod} = await loadFonts();
		const result = mod.extractLocalFontFaces('@font-face { src: url(_f.ttf); }');
		expect(result.faces).toEqual([]);
		expect(result.css).toContain('@font-face');
	});

	it('extractLocalFontFaces tolerates undefined css', async () => {
		const {mod} = await loadFonts();
		expect(mod.extractLocalFontFaces(undefined)).toEqual({css: '', faces: []});
	});
});

describe('sending fonts', () => {
	it('sends each font to the sandbox once', async () => {
		mockFont(FONT_B64);
		const {mod, postMessage} = await loadFonts();
		await mod.prepareCardCss(css).fonts;
		const fonts = fontMessages(postMessage);
		expect(fonts.length).toBe(1);
		expect(fonts[0].family).toBe('F');
		expect(fonts[0].key).toBe('F|_f.ttf|700|');
		expect(fonts[0].descriptors).toEqual({weight: '700'});
		expect(fonts[0].data).toBeInstanceOf(ArrayBuffer);
	});

	it('does not resend a font and strips the font-face from the card css', async () => {
		mockFont(FONT_B64);
		const {mod, postMessage} = await loadFonts();
		const first = mod.prepareCardCss(css);
		const second = mod.prepareCardCss(css);
		expect(first.css).toBe('');
		expect(second.css).toBe('');
		await Promise.all([first.fonts, second.fonts]);
		const retrieveCalls = mocks.anki.mock.calls.filter((call) => call[0] === 'retrieveMediaFile' && call[1].filename === '_f.ttf');
		expect(retrieveCalls.length).toBe(1);
		expect(fontMessages(postMessage).length).toBe(1);
	});

	it('retries a font that failed to load', async () => {
		const {mod} = await loadFonts();
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		let calls = 0;
		mocks.anki.mockImplementation((action) => {
			if (action === 'retrieveMediaFile') {
				calls++;
				return Promise.resolve(null);
			}
			return Promise.resolve();
		});
		await mod.prepareCardCss(css).fonts;
		await mod.prepareCardCss(css).fonts;
		expect(calls).toBe(2);
	});
});
