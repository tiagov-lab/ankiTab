import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest';
import {loadOptionsHtml} from './helpers/dom.js';

const mocks = vi.hoisted(() => ({anki: vi.fn(), rotateDeck: vi.fn()}));

vi.mock('../extension/libs/ankiConnect.js', () => ({
	default: mocks.anki,
	ping: vi.fn(),
	requestPermission: vi.fn(),
	HOST_PERMISSIONS: {},
}));

vi.mock('../extension/app/js/extended/rotateDeck.js', () => ({default: mocks.rotateDeck}));

beforeEach(() => {
	mocks.anki.mockReset();
	mocks.rotateDeck.mockReset();
	mocks.rotateDeck.mockResolvedValue(true);
	mocks.anki.mockImplementation((action) => Promise.reject({type: 'offline'}));
	delete window.ankitabTheme;
});

async function loadOptions({theme = 'system'} = {}) {
	loadOptionsHtml();
	window.ankitabTheme = {get: () => theme, set: vi.fn(), isDark: () => false, onChange: () => () => {}};
	vi.resetModules();
	await import('../extension/options/options.js');
	await new Promise((resolve) => setTimeout(resolve, 0));
	return {
		theme: vi.mocked(window.ankitabTheme),
		decks: () => Array.from(document.querySelectorAll('.deck')),
		decksByName: () => Object.fromEntries(Array.from(document.querySelectorAll('.deck')).map((input) => [input.dataset.deck, input.checked])),
	};
}

function submit() {
	document.querySelector('#optionsForm').dispatchEvent(new Event('submit', {bubbles: true, cancelable: true}));
	return new Promise((resolve) => setTimeout(resolve, 0));
}

afterEach(() => {
	vi.useRealTimers();
});

describe('getValue/setValue', () => {
	it('handles checkboxes, numbers and text inputs', async () => {
		loadOptionsHtml();
		window.ankitabTheme = {get: () => 'system', set: vi.fn()};
		vi.resetModules();
		const {getValue, setValue} = await import('../extension/options/options.js');
		const checkbox = document.createElement('input');
		checkbox.type = 'checkbox';
		setValue(checkbox, true);
		expect(checkbox.checked).toBe(true);
		expect(getValue(checkbox)).toBe(true);

		const number = document.createElement('input');
		number.type = 'number';
		number.min = '1';
		number.max = '10';
		number.value = '4';
		expect(getValue(number)).toBe(4);
		number.value = '40';
		expect(getValue(number)).toBe(10);
		number.value = '-2';
		expect(getValue(number)).toBe(1);
		number.min = '0';
		number.value = 'nope';
		expect(getValue(number)).toBe(0);
		number.min = '1';
		expect(getValue(number)).toBe(1);
		setValue(number, 7);
		expect(number.value).toBe('7');

		const text = document.createElement('input');
		text.type = 'text';
		setValue(text, 'hello');
		expect(getValue(text)).toBe('hello');
		setValue(text, undefined);
		expect(text.value).toBe('');
	});
});

describe('options page', () => {
	it('fills the form from the stored settings', async () => {
		chrome.__store.doneShowStats = false;
		chrome.__store.showDueCounts = false;
		chrome.__store.batchSize = 5;
		chrome.__store.batchBreakMinutes = 30;
		chrome.__store.doneFallback = 'none';
		chrome.__store.doneSearchUrl = 'https://example.com/?q=%s';
		chrome.__store.interleavingDisabled = true;
		chrome.__store.deckNames = ['Deck A', 'Deck B'];
		chrome.__store.excludedDecks = ['Deck B'];
		const {theme} = await loadOptions({theme: 'dark'});
		expect(document.querySelector('#doneShowStats').checked).toBe(false);
		expect(document.querySelector('#showDueCounts').checked).toBe(false);
		expect(document.querySelector('#batchSize').value).toBe('5');
		expect(document.querySelector('#batchBreakMinutes').value).toBe('30');
		expect(document.querySelector('#doneFallback').value).toBe('none');
		expect(document.querySelector('#doneSearchUrl').value).toBe('https://example.com/?q=%s');
		expect(document.querySelector('#interleavingDisabled').checked).toBe(true);
		expect(document.querySelector('#themeSelect').value).toBe('dark');
		expect(theme.get).toBeDefined();
	});

	it('saves number inputs as clamped numbers', async () => {
		await loadOptions();
		document.querySelector('#batchSize').value = '999';
		document.querySelector('#batchBreakMinutes').value = '5000';
		await submit();
		expect(chrome.__store.batchSize).toBe(200);
		expect(chrome.__store.batchBreakMinutes).toBe(1440);
	});

	it('maps a non-numeric number input to 0', async () => {
		await loadOptions();
		document.querySelector('#batchSize').value = 'abc';
		await submit();
		expect(chrome.__store.batchSize).toBe(0);
	});

	it('saves checkboxes as booleans', async () => {
		await loadOptions();
		document.querySelector('#doneShowStats').checked = false;
		document.querySelector('#autoFlipChoice').checked = false;
		await submit();
		expect(chrome.__store.doneShowStats).toBe(false);
		expect(chrome.__store.autoFlipChoice).toBe(false);
	});

	it('saves excluded decks as the unticked deck names', async () => {
		chrome.__store.deckNames = ['Deck A', 'Deck B', 'Deck C'];
		await loadOptions();
		expect(document.querySelectorAll('.deck').length).toBe(3);
		document.querySelector('[data-deck="Deck B"]').checked = false;
		await submit();
		expect(chrome.__store.excludedDecks).toEqual(['Deck B']);
	});

	it('blocks saving a search url without %s', async () => {
		await loadOptions();
		const input = document.querySelector('#doneSearchUrl');
		input.value = 'https://example.com/?q=';
		await submit();
		expect(input.validationMessage).toBe('The search URL must contain %s');
		expect(chrome.__store.doneSearchUrl).toBeUndefined();
		expect(mocks.rotateDeck).not.toHaveBeenCalled();
	});

	it('clears the error and saves once %s is back', async () => {
		await loadOptions();
		const input = document.querySelector('#doneSearchUrl');
		input.value = 'https://example.com/?q=';
		await submit();
		input.value = 'https://example.com/?q=%s';
		await submit();
		expect(input.validationMessage).toBe('');
		expect(chrome.__store.doneSearchUrl).toBe('https://example.com/?q=%s');
	});

	it('renders decks sorted and indented by subdeck level', async () => {
		chrome.__store.deckNames = ['Zeta', 'Parent::Child', 'Parent::Child::Grand'];
		await loadOptions();
		const labels = Array.from(document.querySelectorAll('#decks .form-check-label')).map((label) => label.textContent);
		expect(labels).toEqual(['\u00a0\u00a0\u00a0Child', '\u00a0\u00a0\u00a0\u00a0\u00a0\u00a0Grand', 'Zeta']);
	});

	it('ticks and unticks every deck', async () => {
		chrome.__store.deckNames = ['A', 'B'];
		await loadOptions();
		document.querySelector('[data-deck="A"]').checked = false;
		document.querySelector('#tickall').click();
		expect(Array.from(document.querySelectorAll('.deck')).every((input) => input.checked)).toBe(true);
		document.querySelector('#untickall').click();
		expect(Array.from(document.querySelectorAll('.deck')).some((input) => input.checked)).toBe(false);
		await submit();
		expect(chrome.__store.excludedDecks).toEqual(['A', 'B']);
	});

	it('requests the topSites permission when the fallback needs it', async () => {
		const request = vi.fn((permissions, callback) => callback(false));
		chrome.permissions.request = request;
		await loadOptions();
		document.querySelector('#doneFallback').value = 'topsites';
		await submit();
		expect(request).toHaveBeenCalledWith({permissions: ['topSites']}, expect.any(Function));
		expect(chrome.__store.doneFallback).toBe('search');
		expect(document.querySelector('#doneFallback').value).toBe('search');
	});

	it('stores topsites when the permission is granted', async () => {
		const request = vi.fn((permissions, callback) => callback(true));
		chrome.permissions.request = request;
		await loadOptions();
		document.querySelector('#doneFallback').value = 'topsites';
		await submit();
		expect(chrome.__store.doneFallback).toBe('topsites');
	});

	it('requests topSites for the both fallback', async () => {
		const request = vi.fn((permissions, callback) => callback(true));
		chrome.permissions.request = request;
		await loadOptions();
		document.querySelector('#doneFallback').value = 'both';
		await submit();
		expect(request).toHaveBeenCalled();
	});

	it('falls back to search when the permissions api is missing', async () => {
		delete chrome.permissions;
		await loadOptions();
		document.querySelector('#doneFallback').value = 'topsites';
		await submit();
		expect(chrome.__store.doneFallback).toBe('search');
	});

	it('supports a promise-returning permissions request', async () => {
		chrome.permissions.request = () => Promise.resolve(true);
		await loadOptions();
		document.querySelector('#doneFallback').value = 'topsites';
		await submit();
		expect(chrome.__store.doneFallback).toBe('topsites');
	});

	it('falls back to search when requesting the permission throws', async () => {
		chrome.permissions.request = () => {
			throw new Error('nope');
		};
		await loadOptions();
		document.querySelector('#doneFallback').value = 'topsites';
		await submit();
		expect(chrome.__store.doneFallback).toBe('search');
	});

	it('does not request topSites for the search fallback', async () => {
		const request = vi.fn((permissions, callback) => callback(true));
		chrome.permissions.request = request;
		await loadOptions();
		document.querySelector('#doneFallback').value = 'search';
		await submit();
		expect(request).not.toHaveBeenCalled();
	});

	it('shows the saved alert and fades it out', async () => {
		await loadOptions();
		vi.useFakeTimers();
		const alertBox = document.querySelector('.alert');
		document.querySelector('#optionsForm').dispatchEvent(new Event('submit', {bubbles: true, cancelable: true}));
		await vi.advanceTimersByTimeAsync(0);
		expect(alertBox.style.opacity).toBe('1');
		await vi.advanceTimersByTimeAsync(1800);
		expect(alertBox.style.opacity).toBe('0');
	});

	it('fetches deck names from anki when the cache is empty', async () => {
		mocks.anki.mockImplementation((action) => {
			if (action === 'deckNames') return Promise.resolve(['Deck X']);
			return Promise.reject({type: 'offline'});
		});
		await loadOptions();
		expect(chrome.__store.deckNames).toEqual(['Deck X']);
		expect(document.querySelectorAll('.deck').length).toBe(1);
		expect(document.querySelector('[data-deck="Deck X"]').checked).toBe(true);
	});

	it('leaves the deck list empty when anki is offline', async () => {
		await loadOptions();
		expect(document.querySelectorAll('.deck').length).toBe(0);
	});

	it('saves the theme choice from the select', async () => {
		const {theme} = await loadOptions();
		const select = document.querySelector('#themeSelect');
		select.value = 'dark';
		select.dispatchEvent(new Event('change'));
		expect(theme.set).toHaveBeenCalledWith('dark');
	});

	it('triggers a deck rotation after saving', async () => {
		await loadOptions();
		await submit();
		expect(mocks.rotateDeck).toHaveBeenCalledWith(false);
	});
});
