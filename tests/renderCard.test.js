import {describe, it, expect, vi, beforeEach} from 'vitest';
import {loadAppPage, sleep} from './helpers/dom.js';

const mocks = vi.hoisted(() => ({anki: vi.fn()}));

vi.mock('../extension/libs/ankiConnect.js', () => ({default: mocks.anki}));

const settle = () => sleep(0);

function makeCard(overrides = {}) {
	return Object.assign(
		{
			question: '<p>front</p>',
			answer: '<p>back</p>',
			css: '.card { color: red; }',
			deckName: 'Deck A',
			cardId: 100,
			buttons: [1, 2, 3, 4],
			nextReviews: ['1s', '10s', '1m', '1d'],
		},
		overrides
	);
}

async function loadRender({themeDark = false, ready = true} = {}) {
	loadAppPage();
	const frame = document.querySelector('#flashcardSandbox');
	const postMessage = vi.fn();
	const contentWindow = {postMessage};
	Object.defineProperty(frame, 'contentWindow', {configurable: true, get: () => contentWindow});
	frame.setAttribute('src', 'moz-extension://test/app/sandbox.html');
	window.ankitabTheme = {isDark: () => themeDark, get: () => (themeDark ? 'dark' : 'light'), set: vi.fn(), onChange: vi.fn()};
	vi.resetModules();
	const mod = await import('../extension/app/js/renderCard.js');
	if (ready) frame.dispatchEvent(new Event('load'));
	return {mod, frame, postMessage};
}

function deferred() {
	let resolve;
	let reject;
	const promise = new Promise((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return {promise, resolve, reject};
}

beforeEach(() => {
	vi.clearAllMocks();
	window.ankitabTheme = undefined;
	mocks.anki.mockResolvedValue(undefined);
});

const messagesOf = (postMessage, command) =>
	postMessage.mock.calls.map((call) => call[0]).filter((message) => message.command === command);

describe('renderInSandbox', () => {
	it('posts a question render with the answer and autflip flags', async () => {
		const {mod, postMessage} = await loadRender();
		await mod.renderInSandbox(makeCard(), '<p>front</p>', {answer: false, autoFlip: true});
		const renders = messagesOf(postMessage, 'render');
		expect(renders.length).toBe(1);
		expect(renders[0].html).toContain('<p>front</p>');
		expect(renders[0].answer).toBe(false);
		expect(renders[0].autoFlip).toBe(true);
	});

	it('never auto-flips on the answer side', async () => {
		const {mod, postMessage} = await loadRender();
		await mod.renderInSandbox(makeCard(), '<p>back</p>', {answer: true, autoFlip: true});
		const renders = messagesOf(postMessage, 'render');
		expect(renders[0].answer).toBe(true);
		expect(renders[0].autoFlip).toBe(false);
	});

	it('does nothing without a card', async () => {
		const {mod, postMessage} = await loadRender();
		await mod.renderInSandbox(null, '<p>front</p>', {});
		expect(postMessage).not.toHaveBeenCalled();
	});

	it('clears the answer-saving dim after rendering', async () => {
		const {mod, frame} = await loadRender();
		frame.style.opacity = '0.4';
		await mod.renderInSandbox(makeCard(), '<p>front</p>', {});
		expect(frame.style.opacity).toBe('');
	});

	it('sends local fonts before the card html', async () => {
		mocks.anki.mockImplementation((action) => {
			if (action === 'retrieveMediaFile') return Promise.resolve(btoa(String.fromCharCode(0, 1, 0, 0)));
			return Promise.resolve();
		});
		const {mod, postMessage} = await loadRender();
		await mod.renderInSandbox(makeCard({css: '@font-face { font-family: F; src: url("_f.ttf"); }'}), 'front', {});
		const commands = postMessage.mock.calls.map((call) => call[0].command);
		expect(commands.indexOf('font')).toBeGreaterThanOrEqual(0);
		expect(commands.indexOf('font')).toBeLessThan(commands.indexOf('render'));
	});

	it('a newer render wins over one that is still loading media', async () => {
		const media = deferred();
		mocks.anki.mockImplementation((action) => {
			if (action === 'retrieveMediaFile') return media.promise;
			return Promise.resolve();
		});
		const {mod, postMessage} = await loadRender();
		const first = mod.renderInSandbox(makeCard(), '<img src="slow.png">', {answer: false});
		const second = mod.renderInSandbox(makeCard(), '<p>newer</p>', {answer: false});
		await second;
		media.resolve('QUJD');
		await first;
		await settle();
		const renders = messagesOf(postMessage, 'render');
		expect(renders.length).toBe(1);
		expect(renders[0].html).toContain('newer');
	});
});

describe('prefetchAnswer', () => {
	it('fetches the answer media without posting a render', async () => {
		const filenames = [];
		mocks.anki.mockImplementation((action, params) => {
			if (action === 'retrieveMediaFile') {
				filenames.push(params.filename);
				return Promise.resolve('QUJD');
			}
			return Promise.resolve();
		});
		const {mod, postMessage} = await loadRender();
		mod.prefetchAnswer(makeCard({answer: '<img src="back.png">'}));
		await settle();
		expect(filenames).toEqual(['back.png']);
		expect(messagesOf(postMessage, 'render').length).toBe(0);
	});
});
