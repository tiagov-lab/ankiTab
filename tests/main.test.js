import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest';
import {loadAppPage, stubLocation, restoreLocation, sleep} from './helpers/dom.js';

const mocks = vi.hoisted(() => ({
	start: vi.fn(),
	handleKeyEvent: vi.fn(),
	renderAnswer: vi.fn(),
	editNote: vi.fn(),
	undo: vi.fn(),
	suspendCard: vi.fn(),
	anki: vi.fn(),
	showToast: vi.fn(),
}));

vi.mock('../extension/app/js/cards.js', () => ({
	default: mocks.start,
	handleKeyEvent: mocks.handleKeyEvent,
	renderAnswer: mocks.renderAnswer,
	editNote: mocks.editNote,
	undo: mocks.undo,
	suspendCard: mocks.suspendCard,
}));

vi.mock('../extension/libs/ankiConnect.js', () => ({
	default: mocks.anki,
	ping: vi.fn(),
	requestPermission: vi.fn(),
	HOST_PERMISSIONS: {},
}));

vi.mock('../extension/app/js/toast.js', () => ({showToast: mocks.showToast}));

function makeTheme({initial = 'system', systemDark = false} = {}) {
	let current = initial;
	const listeners = [];
	return {
		get: vi.fn(() => current),
		isDark: vi.fn(() => (current === 'dark' ? true : current === 'light' ? false : systemDark)),
		set: vi.fn((value) => {
			current = value;
			listeners.forEach((listener) => listener());
		}),
		onChange: vi.fn((listener) => {
			listeners.push(listener);
			return () => {};
		}),
		change(value) {
			current = value;
			listeners.forEach((listener) => listener());
		},
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	mocks.anki.mockResolvedValue(undefined);
	mocks.start.mockResolvedValue(undefined);
	delete window.ankitabTheme;
});

afterEach(() => {
	restoreLocation();
});

async function loadMain({search = '', theme = makeTheme(), withTheme = true} = {}) {
	loadAppPage();
	stubLocation(search);
	const frame = document.querySelector('#flashcardSandbox');
	if (withTheme) window.ankitabTheme = theme;
	vi.resetModules();
	await import('../extension/app/js/main.js');
	return {theme, frame};
}

const menuHidden = () => document.querySelector('#menu').hidden;

describe('main.js startup', () => {
	it('starts studying on load', async () => {
		await loadMain();
		expect(mocks.start).toHaveBeenCalledTimes(1);
	});

	it('points the sandbox iframe at the theme-specific url', async () => {
		const {frame} = await loadMain({theme: makeTheme({systemDark: true})});
		expect(frame.src).toBe('moz-extension://test/app/sandbox.html?theme=dark');
	});

	it('uses the light url when the theme is not dark', async () => {
		const {frame} = await loadMain();
		expect(frame.src).toBe('moz-extension://test/app/sandbox.html?theme=light');
	});

	it('works without a theme helper by falling back to light', async () => {
		await loadMain({withTheme: false});
		expect(document.querySelector('#themeBtn').textContent).toBe('Theme: System');
		expect(document.querySelector('#flashcardSandbox').src).toBe('moz-extension://test/app/sandbox.html?theme=light');
	});

	it('cycles the fallback theme without a real theme helper', async () => {
		await loadMain({withTheme: false});
		const button = document.querySelector('#themeBtn');
		expect(() => button.click()).not.toThrow();
		expect(button.textContent).toBe('Theme: System');
	});
});

describe('menu', () => {
	it('opens with the More button and closes on a second click', async () => {
		await loadMain();
		const more = document.querySelector('#moreButton');
		expect(menuHidden()).toBe(true);
		more.click();
		expect(menuHidden()).toBe(false);
		expect(more.getAttribute('aria-expanded')).toBe('true');
		more.click();
		expect(menuHidden()).toBe(true);
		expect(more.getAttribute('aria-expanded')).toBe('false');
	});

	it('closes when clicking outside the menu', async () => {
		await loadMain();
		document.querySelector('#moreButton').click();
		document.body.click();
		expect(menuHidden()).toBe(true);
	});

	it('stays open when clicking inside the menu', async () => {
		await loadMain();
		document.querySelector('#moreButton').click();
		document.querySelector('#menu').click();
		expect(menuHidden()).toBe(false);
	});

	it('closes on escape', async () => {
		await loadMain();
		document.querySelector('#moreButton').click();
		document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true}));
		expect(menuHidden()).toBe(true);
	});

	it('opens the options page from the menu', async () => {
		await loadMain();
		const location = stubLocation();
		document.querySelector('#optionsBtn').click();
		expect(location.href).toBe('moz-extension://test/options/index.html');
		expect(menuHidden()).toBe(true);
	});

	it('syncs and reports success', async () => {
		await loadMain();
		document.querySelector('#syncBtn').click();
		await sleep(0);
		expect(mocks.anki).toHaveBeenCalledWith('sync');
		expect(mocks.showToast).toHaveBeenCalledWith('synced');
		expect(menuHidden()).toBe(true);
	});

	it('reports a failed sync', async () => {
		mocks.anki.mockRejectedValue({type: 'offline'});
		await loadMain();
		document.querySelector('#syncBtn').click();
		await sleep(0);
		expect(mocks.showToast).toHaveBeenCalledWith('could not sync');
	});

	it('calls undo, suspend, edit and show answer', async () => {
		await loadMain();
		document.querySelector('#undoBtn').click();
		document.querySelector('#suspendBtn').click();
		document.querySelector('#editBtn').click();
		document.querySelector('#showAnswerBtn').click();
		expect(mocks.undo).toHaveBeenCalledTimes(1);
		expect(mocks.suspendCard).toHaveBeenCalledTimes(1);
		expect(mocks.editNote).toHaveBeenCalledTimes(1);
		expect(mocks.renderAnswer).toHaveBeenCalledTimes(1);
	});
});

describe('theme button', () => {
	it('cycles system -> light -> dark -> system and updates the label', async () => {
		const theme = makeTheme();
		await loadMain({theme});
		const button = document.querySelector('#themeBtn');
		expect(button.textContent).toBe('Theme: System');
		button.click();
		expect(theme.set).toHaveBeenLastCalledWith('light');
		expect(button.textContent).toBe('Theme: Light');
		button.click();
		expect(theme.set).toHaveBeenLastCalledWith('dark');
		expect(button.textContent).toBe('Theme: Dark');
		button.click();
		expect(theme.set).toHaveBeenLastCalledWith('system');
		expect(button.textContent).toBe('Theme: System');
	});

	it('posts the theme to the sandbox when the theme changes', async () => {
		const theme = makeTheme();
		const {frame} = await loadMain({theme});
		const postMessage = vi.fn();
		frame.contentWindow.postMessage = postMessage;
		theme.change('dark');
		expect(postMessage).toHaveBeenCalledWith({command: 'theme', dark: true}, '*');
		expect(document.querySelector('#themeBtn').textContent).toBe('Theme: Dark');
	});

	it('posts the theme again when the sandbox iframe loads', async () => {
		const {frame} = await loadMain({theme: makeTheme({initial: 'dark'})});
		const postMessage = vi.fn();
		frame.contentWindow.postMessage = postMessage;
		frame.dispatchEvent(new Event('load'));
		expect(postMessage).toHaveBeenCalledWith({command: 'theme', dark: true}, '*');
	});
});

describe('answer bar focus', () => {
	it('prevents mousedown from focusing a bar button', async () => {
		await loadMain();
		const edit = document.querySelector('#editBtn');
		const undo = document.querySelector('#undoBtn');
		const editEvent = new MouseEvent('mousedown', {bubbles: true, cancelable: true});
		const undoEvent = new MouseEvent('mousedown', {bubbles: true, cancelable: true});
		edit.dispatchEvent(editEvent);
		undo.dispatchEvent(undoEvent);
		expect(editEvent.defaultPrevented).toBe(true);
		expect(undoEvent.defaultPrevented).toBe(false);
	});
});

describe('messages from the sandbox', () => {
	it('forwards key messages to the cards key handler', async () => {
		const {frame} = await loadMain();
		window.dispatchEvent(
			new MessageEvent('message', {
				source: frame.contentWindow,
				data: {command: 'key', key: ' ', code: 'Space', ctrlKey: true, shiftKey: false, altKey: false, metaKey: false, repeat: false},
			})
		);
		expect(mocks.handleKeyEvent).toHaveBeenCalledTimes(1);
		expect(mocks.handleKeyEvent).toHaveBeenCalledWith({
			key: ' ',
			code: 'Space',
			ctrlKey: true,
			shiftKey: false,
			altKey: false,
			metaKey: false,
			repeat: false,
			target: null,
			preventDefault: expect.any(Function),
		});
	});

	it('gives the forwarded key event a preventDefault', async () => {
		const {frame} = await loadMain();
		mocks.handleKeyEvent.mockImplementationOnce((event) => event.preventDefault());
		window.dispatchEvent(new MessageEvent('message', {source: frame.contentWindow, data: {command: 'key', key: '-'}}));
		expect(mocks.handleKeyEvent).toHaveBeenCalledTimes(1);
		expect(mocks.handleKeyEvent.mock.calls[0][0].preventDefault()).toBeUndefined();
	});

	it('shows the answer on a showAnswer message', async () => {
		const {frame} = await loadMain();
		window.dispatchEvent(new MessageEvent('message', {source: frame.contentWindow, data: {command: 'showAnswer'}}));
		expect(mocks.renderAnswer).toHaveBeenCalledTimes(1);
		expect(mocks.handleKeyEvent).not.toHaveBeenCalled();
	});

	it('ignores messages from other sources', async () => {
		await loadMain();
		window.dispatchEvent(new MessageEvent('message', {source: window, data: {command: 'showAnswer'}}));
		expect(mocks.renderAnswer).not.toHaveBeenCalled();
	});

	it('ignores non-object data and unknown commands', async () => {
		const {frame} = await loadMain();
		window.dispatchEvent(new MessageEvent('message', {source: frame.contentWindow, data: 'hello'}));
		window.dispatchEvent(new MessageEvent('message', {source: frame.contentWindow, data: null}));
		window.dispatchEvent(new MessageEvent('message', {source: frame.contentWindow, data: {command: 'other'}}));
		expect(mocks.renderAnswer).not.toHaveBeenCalled();
		expect(mocks.handleKeyEvent).not.toHaveBeenCalled();
	});
});

describe('unload', () => {
	it('opens the deck browser before unloading', async () => {
		await loadMain();
		window.onbeforeunload();
		expect(mocks.anki).toHaveBeenCalledWith('guiDeckBrowser');
	});

	it('does not open the deck browser on a blank tab', async () => {
		await loadMain({search: '?blank=1'});
		expect(window.onbeforeunload).toBeNull();
		window.dispatchEvent(new Event('beforeunload'));
		expect(mocks.anki).not.toHaveBeenCalled();
	});
});
