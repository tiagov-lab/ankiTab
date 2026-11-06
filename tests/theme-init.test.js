import {describe, it, expect, vi, beforeEach} from 'vitest';
import {loadClassicScript} from './helpers/classic.js';

function stubMatchMedia(matches, {legacy = false} = {}) {
	const media = {
		matches,
		changeListeners: [],
		removeEventListener: vi.fn(),
		fire() {
			media.changeListeners.forEach((listener) => listener({matches: media.matches}));
		},
	};
	media.addEventListener = legacy ? undefined : (type, listener) => media.changeListeners.push(listener);
	media.addListener = (listener) => media.changeListeners.push(listener);
	window.matchMedia = vi.fn(() => media);
	return media;
}

function loadTheme({matches = false, legacy = false, key, oldKey} = {}) {
	if (key !== undefined) localStorage.setItem('ankitab-theme', key);
	if (oldKey !== undefined) localStorage.setItem('theme', oldKey);
	const media = stubMatchMedia(matches, {legacy});
	loadClassicScript('extension/app/js/theme-init.js');
	return {theme: window.ankitabTheme, media};
}

const htmlIsDark = () => document.documentElement.classList.contains('dark-theme');

beforeEach(() => {
	delete window.ankitabTheme;
});

describe('theme-init', () => {
	it('reads a stored theme and applies it before paint', () => {
		const {theme} = loadTheme({key: 'dark'});
		expect(theme.get()).toBe('dark');
		expect(theme.isDark()).toBe(true);
		expect(htmlIsDark()).toBe(true);
	});

	it('defaults to system when nothing is stored', () => {
		const {theme} = loadTheme();
		expect(theme.get()).toBe('system');
	});

	it('follows prefers-color-scheme in system mode', () => {
		expect(loadTheme({matches: true}).theme.isDark()).toBe(true);
		const light = loadTheme({matches: false});
		expect(light.theme.isDark()).toBe(false);
	});

	it('ignores prefers-color-scheme in light mode', () => {
		const {theme} = loadTheme({key: 'light', matches: true});
		expect(theme.isDark()).toBe(false);
		expect(htmlIsDark()).toBe(false);
	});

	it('ignores prefers-color-scheme in dark mode', () => {
		const {theme} = loadTheme({key: 'dark', matches: false});
		expect(theme.isDark()).toBe(true);
	});

	it('normalizes unknown stored values to system', () => {
		const {theme} = loadTheme({key: 'purple'});
		expect(theme.get()).toBe('system');
	});

	it('set() persists the choice, applies it and notifies listeners', () => {
		const {theme} = loadTheme();
		const onChange = vi.fn();
		theme.onChange(onChange);
		theme.set('dark');
		expect(localStorage.getItem('ankitab-theme')).toBe('dark');
		expect(htmlIsDark()).toBe(true);
		expect(onChange).toHaveBeenLastCalledWith(true);
		theme.set('light');
		expect(localStorage.getItem('ankitab-theme')).toBe('light');
		expect(htmlIsDark()).toBe(false);
		expect(onChange).toHaveBeenLastCalledWith(false);
		theme.set('nonsense');
		expect(localStorage.getItem('ankitab-theme')).toBe('system');
	});

	it('onChange returns an unsubscribe function', () => {
		const {theme} = loadTheme();
		const onChange = vi.fn();
		const off = theme.onChange(onChange);
		off();
		theme.set('dark');
		expect(onChange).not.toHaveBeenCalled();
	});

	it('a failing listener does not stop the others', () => {
		const {theme} = loadTheme();
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const good = vi.fn();
		theme.onChange(() => {
			throw new Error('boom');
		});
		theme.onChange(good);
		theme.set('dark');
		expect(good).toHaveBeenCalledWith(true);
		expect(warn).toHaveBeenCalled();
	});

	it('applies and emits on a storage event from another tab', () => {
		const {theme} = loadTheme();
		const onChange = vi.fn();
		theme.onChange(onChange);
		localStorage.setItem('ankitab-theme', 'dark');
		window.dispatchEvent(new StorageEvent('storage', {key: 'ankitab-theme'}));
		expect(htmlIsDark()).toBe(true);
		expect(onChange).toHaveBeenCalledWith(true);
	});

	it('ignores storage events for other keys', () => {
		const {theme} = loadTheme();
		const onChange = vi.fn();
		theme.onChange(onChange);
		localStorage.setItem('ankitab-theme', 'dark');
		window.dispatchEvent(new StorageEvent('storage', {key: 'something-else'}));
		expect(htmlIsDark()).toBe(false);
		expect(onChange).not.toHaveBeenCalled();
	});

	it('follows system changes from matchMedia', () => {
		const {theme, media} = loadTheme();
		const onChange = vi.fn();
		theme.onChange(onChange);
		media.matches = true;
		media.fire();
		expect(htmlIsDark()).toBe(true);
		expect(onChange).toHaveBeenCalledWith(true);
	});

	it('ignores matchMedia changes when a mode is pinned', () => {
		const {theme, media} = loadTheme({key: 'light'});
		const onChange = vi.fn();
		theme.onChange(onChange);
		media.matches = true;
		media.fire();
		expect(htmlIsDark()).toBe(false);
		expect(onChange).not.toHaveBeenCalled();
	});

	it('supports the legacy addListener media api', () => {
		const {media} = loadTheme({legacy: true});
		media.matches = true;
		media.fire();
		expect(htmlIsDark()).toBe(true);
	});


	it('falls back to system when reading storage throws', () => {
		vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
			throw new Error('storage unavailable');
		});
		const {theme} = loadTheme();
		expect(theme.get()).toBe('system');
		expect(theme.isDark()).toBe(false);
	});

	// BUG: the code comment says the choice is still applied when localStorage
	// rejects writes, but set() re-reads storage in apply(), so the new theme is
	// silently dropped.
	it('emits (with the unchanged theme) when writing the choice fails', () => {
		const {theme} = loadTheme();
		const onChange = vi.fn();
		theme.onChange(onChange);
		vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
			throw new Error('storage unavailable');
		});
		expect(() => theme.set('dark')).not.toThrow();
		expect(onChange).toHaveBeenCalledWith(false);
	});

	it('migrates the old theme key', () => {
		loadTheme({oldKey: 'dark'});
		expect(localStorage.getItem('ankitab-theme')).toBe('dark');
		expect(localStorage.getItem('theme')).toBeNull();
	});

	it('keeps an existing new key during migration', () => {
		loadTheme({key: 'light', oldKey: 'dark'});
		expect(localStorage.getItem('ankitab-theme')).toBe('light');
		expect(localStorage.getItem('theme')).toBeNull();
	});

	it('drops an invalid old theme value', () => {
		loadTheme({oldKey: 'weird'});
		expect(localStorage.getItem('ankitab-theme')).toBeNull();
		expect(localStorage.getItem('theme')).toBeNull();
	});
});
