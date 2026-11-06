import {describe, it, expect, vi, beforeEach} from 'vitest';
import {sleep} from './helpers/dom.js';

function makeFrame({src = ''} = {}) {
	const frame = document.createElement('iframe');
	frame.id = 'flashcardSandbox';
	if (src) frame.setAttribute('src', src);
	document.body.appendChild(frame);
	const postMessage = vi.fn();
	Object.defineProperty(frame, 'contentWindow', {configurable: true, get: () => ({postMessage})});
	return {frame, postMessage};
}

async function loadSandboxFrame(options = {}) {
	const made = options.withFrame === false ? {frame: null, postMessage: null} : makeFrame(options);
	vi.resetModules();
	const mod = await import('../extension/app/js/sandboxFrame.js');
	return Object.assign({mod}, made);
}

beforeEach(() => {
	vi.clearAllMocks();
	document.body.innerHTML = '';
	document.documentElement.className = '';
	delete window.ankitabTheme;
});

describe('postToSandbox', () => {
	it('posts to the sandbox window with a wildcard origin', async () => {
		const {mod, postMessage} = await loadSandboxFrame();
		expect(mod.postToSandbox({command: 'render'})).toBe(true);
		expect(postMessage).toHaveBeenCalledWith({command: 'render'}, '*');
	});

	it('passes transferables through', async () => {
		const {mod, postMessage} = await loadSandboxFrame();
		const buffer = new ArrayBuffer(4);
		mod.postToSandbox({command: 'font'}, [buffer]);
		expect(postMessage).toHaveBeenCalledWith({command: 'font'}, '*', [buffer]);
	});

	it('does nothing when the frame is missing', async () => {
		const {mod} = await loadSandboxFrame({withFrame: false});
		expect(mod.postToSandbox({command: 'render'})).toBe(false);
	});
});

describe('postTheme', () => {
	it('uses the theme helper when there is one', async () => {
		const {mod, postMessage} = await loadSandboxFrame();
		window.ankitabTheme = {isDark: () => true};
		mod.postTheme();
		expect(postMessage).toHaveBeenCalledWith({command: 'theme', dark: true}, '*');
	});

	it('falls back to the document class without a theme helper', async () => {
		const {mod, postMessage} = await loadSandboxFrame();
		document.documentElement.classList.add('dark-theme');
		mod.postTheme();
		expect(postMessage).toHaveBeenCalledWith({command: 'theme', dark: true}, '*');
	});

	it('posts a light theme by default', async () => {
		const {mod, postMessage} = await loadSandboxFrame();
		mod.postTheme();
		expect(postMessage).toHaveBeenCalledWith({command: 'theme', dark: false}, '*');
	});
});

describe('setDimmed', () => {
	it('dims and undims the sandbox iframe', async () => {
		const {mod, frame} = await loadSandboxFrame();
		mod.setDimmed(true);
		expect(frame.style.opacity).toBe('0.4');
		mod.setDimmed(false);
		expect(frame.style.opacity).toBe('');
	});

	it('tolerates a missing frame', async () => {
		const {mod} = await loadSandboxFrame({withFrame: false});
		expect(() => mod.setDimmed(true)).not.toThrow();
	});
});

describe('frameReady', () => {
	it('resolves after the iframe with a src loads', async () => {
		const {mod, frame} = await loadSandboxFrame();
		frame.dispatchEvent(new Event('load')); // no src yet: about:blank, ignore
		const ignored = await Promise.race([mod.frameReady.then(() => 'ready'), sleep(20).then(() => 'timeout')]);
		expect(ignored).toBe('timeout');
		frame.setAttribute('src', 'moz-extension://test/app/sandbox.html');
		frame.dispatchEvent(new Event('load'));
		await expect(mod.frameReady).resolves.toBeUndefined();
	});

	it('resolves immediately when there is no iframe', async () => {
		const {mod} = await loadSandboxFrame({withFrame: false});
		await expect(mod.frameReady).resolves.toBeUndefined();
	});
});
