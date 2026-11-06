import {describe, it, expect, vi, beforeEach} from 'vitest';

const mocks = vi.hoisted(() => ({anki: vi.fn()}));

vi.mock('../extension/libs/ankiConnect.js', () => ({default: mocks.anki}));

async function loadMedia() {
	vi.resetModules();
	return import('../extension/app/js/media.js');
}

beforeEach(() => {
	vi.clearAllMocks();
	mocks.anki.mockResolvedValue(undefined);
});

describe('pure helpers', () => {
	it('bufferToText decodes base64 to text', async () => {
		const mod = await loadMedia();
		expect(mod.bufferToText(btoa('hello'))).toBe('hello');
	});

	it('replaceAudioTags turns [sound:...] into audio or video elements', async () => {
		const mod = await loadMedia();
		expect(mod.replaceAudioTags('[sound:a.mp3]')).toBe('<audio controls src="a.mp3"></audio>');
		expect(mod.replaceAudioTags('[sound:clip.mp4]')).toBe('<video controls src="clip.mp4"></video>');
		expect(mod.replaceAudioTags('[sound:mystery.unknown]')).toBe('<audio controls src="mystery.unknown"></audio>');
	});

	it('replaceAudioTags replaces every tag and leaves other text alone', async () => {
		const mod = await loadMedia();
		expect(mod.replaceAudioTags('x [sound:a.mp3] y [sound:b.mp4]')).toBe(
			'x <audio controls src="a.mp3"></audio> y <video controls src="b.mp4"></video>'
		);
	});

	it('buildCardHTML wraps the css in a style tag and expands audio', async () => {
		const mod = await loadMedia();
		expect(mod.buildCardHTML('.x{}', '[sound:a.mp3]')).toBe('<style>.x{}</style><audio controls src="a.mp3"></audio>');
	});

	it('base64ToBuffer returns the bytes in an ArrayBuffer', async () => {
		const mod = await loadMedia();
		const buffer = mod.base64ToBuffer(btoa(String.fromCharCode(1, 2, 3)));
		expect(buffer).toBeInstanceOf(ArrayBuffer);
		expect(Array.from(new Uint8Array(buffer))).toEqual([1, 2, 3]);
	});
});

describe('media', () => {
	it('inlines local image sources as data uris', async () => {
		const mod = await loadMedia();
		mocks.anki.mockImplementation((action, params) => {
			if (action === 'retrieveMediaFile') return Promise.resolve('QUJD');
			return Promise.resolve();
		});
		const html = await mod.resolveMedia('<img src="x.png">');
		expect(html).toContain('src="data:image/png;base64,QUJD"');
	});

	it('leaves remote and data uris alone', async () => {
		const mod = await loadMedia();
		mocks.anki.mockImplementation(() => Promise.resolve('QUJD'));
		const html = await mod.resolveMedia('<img src="https://example.com/a.png"><img src="data:image/png;base64,AA">');
		expect(html).toContain('https://example.com/a.png');
		expect(html).toContain('data:image/png;base64,AA');
		expect(mocks.anki).not.toHaveBeenCalled();
	});

	it('decodes and strips query strings from local paths', async () => {
		const mod = await loadMedia();
		const filenames = [];
		mocks.anki.mockImplementation((action, params) => {
			if (action === 'retrieveMediaFile') {
				filenames.push(params.filename);
				return Promise.resolve('QUJD');
			}
			return Promise.resolve();
		});
		await mod.resolveMedia('<img src="my%20file.png?v=2">');
		expect(filenames).toEqual(['my file.png']);
	});

	it('does not touch script sources', async () => {
		const mod = await loadMedia();
		mocks.anki.mockImplementation(() => Promise.resolve('QUJD'));
		const html = await mod.resolveMedia('<script src="x.js"></script>');
		expect(html).toContain('src="x.js"');
		expect(mocks.anki).not.toHaveBeenCalled();
	});

	it('shares one request between concurrent loads and caches it', async () => {
		const mod = await loadMedia();
		const filenames = [];
		mocks.anki.mockImplementation((action, params) => {
			if (action === 'retrieveMediaFile') {
				filenames.push(params.filename);
				return Promise.resolve('QUJD');
			}
			return Promise.resolve();
		});
		const [first, second] = await Promise.all([mod.resolveMedia('<img src="same.png">'), mod.resolveMedia('<img src="same.png">')]);
		expect(filenames).toEqual(['same.png']);
		expect(first).toContain('data:image/png');
		expect(second).toContain('data:image/png');
		await mod.resolveMedia('<img src="same.png">');
		expect(filenames).toEqual(['same.png']);
	});

	it('keeps a malformed source when decoding it fails', async () => {
		const mod = await loadMedia();
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const html = await mod.resolveMedia('<img src="%E0%A4%A">');
		expect(html).toContain('%E0%A4%A');
		expect(warn).toHaveBeenCalled();
	});

	it('evicts the oldest cached media after 200 entries', async () => {
		const mod = await loadMedia();
		const filenames = [];
		mocks.anki.mockImplementation((action, params) => {
			if (action === 'retrieveMediaFile') {
				filenames.push(params.filename);
				return Promise.resolve('QUJD');
			}
			return Promise.resolve();
		});
		for (let index = 0; index < 201; index++) await mod.getMediaDataUri('img' + index + '.png');
		expect(filenames.length).toBe(201);
		await mod.getMediaDataUri('img200.png');
		expect(filenames.length).toBe(201);
		await mod.getMediaDataUri('img0.png');
		expect(filenames.length).toBe(202);
	});

	it('keeps the original source and retries after a missing file', async () => {
		const mod = await loadMedia();
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		let calls = 0;
		mocks.anki.mockImplementation((action) => {
			if (action === 'retrieveMediaFile') {
				calls++;
				return Promise.reject({type: 'anki', message: 'missing'});
			}
			return Promise.resolve();
		});
		const html = await mod.resolveMedia('<img src="bad.png">');
		expect(html).toContain('src="bad.png"');
		expect(calls).toBe(1);
		await mod.resolveMedia('<img src="bad.png">');
		expect(calls).toBe(2);
		expect(warn).toHaveBeenCalled();
	});

	it('drops an empty media response', async () => {
		const mod = await loadMedia();
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		mocks.anki.mockImplementation((action) => {
			if (action === 'retrieveMediaFile') return Promise.resolve(null);
			return Promise.resolve();
		});
		const html = await mod.resolveMedia('<img src="empty.png">');
		expect(html).toContain('src="empty.png"');
	});

	it('inlines scripts from the media folder and leaves remote scripts', async () => {
		const mod = await loadMedia();
		mocks.anki.mockImplementation((action, params) => {
			if (action === 'retrieveMediaFile') return Promise.resolve(btoa('window.cardScript=1;'));
			return Promise.resolve();
		});
		const html = await mod.inlineMediaScripts(
			'<script src="_mc.js"></script><script src="https://cdn.example.com/x.js"></script>'
		);
		expect(html).toContain('window.cardScript=1;');
		expect(html).not.toContain('src="_mc.js"');
		expect(html).toContain('src="https://cdn.example.com/x.js"');
	});

	it('keeps a media script tag when fetching it fails', async () => {
		const mod = await loadMedia();
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		mocks.anki.mockImplementation((action) => {
			if (action === 'retrieveMediaFile') return Promise.reject({type: 'anki'});
			return Promise.resolve();
		});
		const html = await mod.inlineMediaScripts('<script src="_bad.js"></script>');
		expect(html).toContain('src="_bad.js"');
	});
});
