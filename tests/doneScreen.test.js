import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest';
import {batchHeading, batchSub, showDoneScreen} from '../extension/app/js/doneScreen.js';
import {startOfAnkiDay} from '../extension/app/js/done/stats.js';
import {stubLocation, restoreLocation, sleep} from './helpers/dom.js';

const anki = vi.hoisted(() => ({invoke: vi.fn()}));
const toast = vi.hoisted(() => ({showToast: vi.fn()}));

vi.mock('../extension/libs/ankiConnect.js', () => ({
	default: anki.invoke,
	ping: vi.fn(),
	requestPermission: vi.fn(),
	HOST_PERMISSIONS: {},
}));

vi.mock('../extension/app/js/toast.js', () => ({showToast: toast.showToast}));

beforeEach(() => {
	anki.invoke.mockReset();
	toast.showToast.mockReset();
	anki.invoke.mockImplementation((action, params) => {
		if (action === 'getNumCardsReviewedToday') return Promise.resolve(3);
		if (action === 'findCards') return Promise.resolve(params.query === 'rated:1' ? [] : [1]);
		if (action === 'getReviewsOfCards') return Promise.resolve({});
		if (action === 'sync') return Promise.resolve();
		return Promise.reject({type: 'anki', message: 'unknown action'});
	});
});

afterEach(() => {
	restoreLocation();
});

async function render(options) {
	document.body.innerHTML = '<div id="overlay" hidden></div>';
	await showDoneScreen(options);
	// Stats are filled in the background on purpose (the screen must not wait
	// for anki); let those promises settle before asserting.
	await sleep(0);
	return document.getElementById('overlay');
}

describe('batchHeading', () => {
	it('counts finished cards in singular and plural', () => {
		expect(batchHeading({count: 1})).toBe('1 card done');
		expect(batchHeading({count: 3})).toBe('3 cards done');
		expect(batchHeading({})).toBe('0 cards done');
	});

	it('shows Break time while on break', () => {
		expect(batchHeading({onBreak: true})).toBe('Break time');
	});
});

describe('batchSub', () => {
	it('tells the user the rest can wait when not on break', () => {
		expect(batchSub({onBreak: false})).toBe('The rest can wait.');
	});

	it('says when cards are back while on break', () => {
		const freeUntil = new Date(2026, 10, 6, 14, 5, 0).getTime();
		const expected = new Date(freeUntil).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
		expect(batchSub({onBreak: true, freeUntil})).toBe('Cards are back at ' + expected);
		expect(batchSub({onBreak: true, freeUntil})).toMatch(/^Cards are back at \d{1,2}:\d{2}/);
	});
});

describe('showDoneScreen', () => {
	it('shows the congratulations heading, stats and links', async () => {
		const overlay = await render();
		expect(document.title).toBe('AnkiTab');
		expect(overlay.hidden).toBe(false);
		expect(overlay.querySelector('h1').textContent).toBe('Congratulations! You have finished for now.');
		const lines = Array.from(overlay.querySelectorAll('.done-stats .stat-line')).map((line) => line.textContent);
		expect(lines).toEqual(['3 cards reviewed today', 'Time studied today: less than a minute', '1 card due tomorrow']);
		const links = Array.from(overlay.querySelectorAll('.done-links button')).map((button) => button.textContent);
		expect(links).toEqual(['Options', 'Sync']);
	});

	it('hides everything but the fallback in blank mode', async () => {
		const overlay = await render({blank: true});
		expect(overlay.querySelector('h1')).toBeNull();
		expect(overlay.querySelector('.done-stats')).toBeNull();
		expect(overlay.querySelector('.done-links')).toBeNull();
		expect(overlay.querySelector('.done-search')).not.toBeNull();
	});

	it('can hide the review stats', async () => {
		chrome.__store.doneShowStats = false;
		const overlay = await render();
		const lines = Array.from(overlay.querySelectorAll('.stat-line')).map((line) => line.textContent);
		expect(lines).toEqual(['1 card due tomorrow']);
		expect(anki.invoke).not.toHaveBeenCalledWith('getNumCardsReviewedToday');
	});

	it('can hide the next-due line', async () => {
		chrome.__store.doneShowNextDue = false;
		const overlay = await render();
		const lines = Array.from(overlay.querySelectorAll('.stat-line')).map((line) => line.textContent);
		expect(lines).toEqual(['3 cards reviewed today', 'Time studied today: less than a minute']);
		expect(anki.invoke).not.toHaveBeenCalledWith('findCards', {query: 'prop:due=1'});
	});

	it('shows no stats at all when both settings are off', async () => {
		chrome.__store.doneShowStats = false;
		chrome.__store.doneShowNextDue = false;
		const overlay = await render();
		expect(overlay.querySelectorAll('.stat-line').length).toBe(0);
		expect(anki.invoke).not.toHaveBeenCalled();
	});

	it('sums only reviews since the anki day start', async () => {
		const start = startOfAnkiDay();
		anki.invoke.mockImplementation((action) => {
			if (action === 'getNumCardsReviewedToday') return Promise.resolve(3);
			if (action === 'findCards') return Promise.resolve(['c1', 'c2']);
			if (action === 'getReviewsOfCards') {
				return Promise.resolve({
					c1: [{id: start + 1000, time: 100000}],
					c2: [{id: start - 24 * 60 * 60 * 1000, time: 24 * 60 * 60 * 1000}],
				});
			}
			return Promise.reject({type: 'anki', message: 'unknown'});
		});
		const overlay = await render();
		const lines = Array.from(overlay.querySelectorAll('.stat-line')).map((line) => line.textContent);
		expect(lines).toContain('Time studied today: 2m');
	});

	it('shows a singular card count', async () => {
		anki.invoke.mockImplementation((action, params) => {
			if (action === 'getNumCardsReviewedToday') return Promise.resolve(1);
			if (action === 'findCards') return Promise.resolve(argsFor(params));
			return Promise.resolve({});
		});
		const overlay = await render();
		expect(overlay.textContent).toContain('1 card reviewed today');
		expect(overlay.textContent).toContain('1 card due tomorrow');

		function argsFor(params) {
			return params.query === 'rated:1' ? [] : [1];
		}
	});

	it('omits the time line when there are more than 2000 reviewed cards', async () => {
		anki.invoke.mockImplementation((action, params) => {
			if (action === 'getNumCardsReviewedToday') return Promise.resolve(2001);
			if (action === 'findCards') return Promise.resolve(params.query === 'rated:1' ? new Array(2001).fill(1) : [1]);
			return Promise.resolve({});
		});
		const overlay = await render();
		const lines = Array.from(overlay.querySelectorAll('.stat-line')).map((line) => line.textContent);
		expect(lines).toEqual(['2001 cards reviewed today', '1 card due tomorrow']);
	});

	it('omits stat lines whose anki call fails', async () => {
		anki.invoke.mockImplementation((action) => {
			return Promise.reject({type: 'anki', message: 'nope'});
		});
		const overlay = await render();
		expect(overlay.querySelectorAll('.stat-line').length).toBe(0);
	});

	it('shows nothing but the search fallback when mode is none', async () => {
		chrome.__store.doneFallback = 'none';
		const overlay = await render();
		expect(overlay.querySelector('.done-search')).toBeNull();
		expect(overlay.querySelector('.topsites')).toBeNull();
	});

	it('shows only the search form in search mode', async () => {
		chrome.__store.doneFallback = 'search';
		const overlay = await render();
		expect(overlay.querySelector('.done-search')).not.toBeNull();
		expect(overlay.querySelector('.topsites')).toBeNull();
	});

	it('shows only the top sites grid in topsites mode', async () => {
		chrome.__store.doneFallback = 'topsites';
		chrome.__topSites = [{url: 'https://example.com/', title: 'Example'}];
		const overlay = await render();
		expect(overlay.querySelector('.done-search')).toBeNull();
		expect(overlay.querySelector('.topsites')).not.toBeNull();
	});

	it('shows both the search form and top sites in both mode', async () => {
		chrome.__store.doneFallback = 'both';
		chrome.__topSites = [{url: 'https://example.com/', title: 'Example'}];
		const overlay = await render();
		expect(overlay.querySelector('.done-search')).not.toBeNull();
		expect(overlay.querySelectorAll('.topsite').length).toBe(1);
	});

	it('falls back to search when the topSites permission is missing', async () => {
		chrome.__store.doneFallback = 'topsites';
		chrome.__permissionContains = false;
		const overlay = await render();
		expect(overlay.querySelector('.done-search')).not.toBeNull();
		expect(overlay.querySelector('.topsites')).toBeNull();
	});

	it('keeps search in both mode when topSites is not allowed', async () => {
		chrome.__store.doneFallback = 'both';
		chrome.__permissionContains = false;
		const overlay = await render();
		expect(overlay.querySelector('.done-search')).not.toBeNull();
		expect(overlay.querySelector('.topsites')).toBeNull();
	});

	it('supports a promise-returning permissions api for top sites', async () => {
		chrome.__store.doneFallback = 'topsites';
		chrome.__topSites = [{url: 'https://example.com/', title: 'Example'}];
		chrome.permissions.contains = () => Promise.resolve(true);
		const overlay = await render();
		expect(overlay.querySelectorAll('.topsite').length).toBe(1);
	});

	it('falls back to search when the promise-based permission is denied', async () => {
		chrome.__store.doneFallback = 'topsites';
		chrome.permissions.contains = () => Promise.resolve(false);
		const overlay = await render();
		expect(overlay.querySelector('.done-search')).not.toBeNull();
		expect(overlay.querySelector('.topsites')).toBeNull();
	});

	it('falls back to search when checking the permission throws', async () => {
		chrome.__store.doneFallback = 'topsites';
		chrome.permissions.contains = () => {
			throw new Error('boom');
		};
		const overlay = await render();
		expect(overlay.querySelector('.done-search')).not.toBeNull();
		expect(overlay.querySelector('.topsites')).toBeNull();
	});

	it('hides the grid when the topSites api is missing', async () => {
		chrome.__store.doneFallback = 'topsites';
		delete chrome.topSites;
		const overlay = await render();
		expect(overlay.querySelector('.topsites').hidden).toBe(true);
	});

	it('hides the grid when reading top sites throws', async () => {
		chrome.__store.doneFallback = 'topsites';
		chrome.topSites.get = () => {
			throw new Error('boom');
		};
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const overlay = await render();
		expect(overlay.querySelector('.topsites').hidden).toBe(true);
		expect(warn).toHaveBeenCalled();
	});

	it('treats an invalid fallback mode as search', async () => {
		chrome.__store.doneFallback = 'bogus';
		const overlay = await render();
		expect(overlay.querySelector('.done-search')).not.toBeNull();
	});

	it('renders at most 8 top sites with the first letter of the host', async () => {
		chrome.__store.doneFallback = 'topsites';
		chrome.__topSites = Array.from({length: 10}, (unused, index) => ({
			url: 'https://www.site' + index + '.example/path',
			title: 'Site ' + index,
		}));
		const overlay = await render();
		const links = overlay.querySelectorAll('.topsite');
		expect(links.length).toBe(8);
		expect(links[0].href).toBe('https://www.site0.example/path');
		expect(links[0].querySelector('.tile').textContent).toBe('S');
		expect(links[0].querySelector('.site-name').textContent).toBe('site0.example');
	});

	it('uses the title when a top site url cannot be parsed', async () => {
		chrome.__store.doneFallback = 'topsites';
		chrome.__topSites = [{url: 'not a url', title: 'My Site'}];
		const overlay = await render();
		expect(overlay.querySelector('.site-name').textContent).toBe('My Site');
		expect(overlay.querySelector('.tile').textContent).toBe('M');
	});

	it('hides the top sites grid when it is empty', async () => {
		chrome.__store.doneFallback = 'topsites';
		chrome.__topSites = [];
		const overlay = await render();
		expect(overlay.querySelector('.topsites').hidden).toBe(true);
	});

	it('hides the top sites grid when loading them fails', async () => {
		chrome.__store.doneFallback = 'topsites';
		chrome.__topSitesError = 'no top sites';
		const overlay = await render();
		expect(overlay.querySelector('.topsites').hidden).toBe(true);
	});

	it('navigates to the search url on submit', async () => {
		const location = stubLocation();
		const overlay = await render();
		const form = overlay.querySelector('.done-search');
		const input = form.querySelector('input');
		input.value = '  hello world  ';
		form.dispatchEvent(new Event('submit', {cancelable: true}));
		expect(location.href).toBe('https://duckduckgo.com/?q=hello%20world');
	});

	it('uses the stored search url', async () => {
		chrome.__store.doneSearchUrl = 'https://example.com/s?q=%s&lang=en';
		const location = stubLocation();
		const overlay = await render();
		const form = overlay.querySelector('.done-search');
		form.querySelector('input').value = 'cats & dogs';
		form.dispatchEvent(new Event('submit', {cancelable: true}));
		expect(location.href).toBe('https://example.com/s?q=cats%20%26%20dogs&lang=en');
	});

	it('does not navigate for an empty query', async () => {
		const location = stubLocation();
		const overlay = await render();
		const before = location.href;
		const form = overlay.querySelector('.done-search');
		form.querySelector('input').value = '   ';
		form.dispatchEvent(new Event('submit', {cancelable: true}));
		expect(location.href).toBe(before);
	});

	it('focuses the search input', async () => {
		const overlay = await render();
		const input = overlay.querySelector('.done-search input');
		await sleep(5);
		expect(document.activeElement).toBe(input);
	});

	it('opens the options page from the Options button', async () => {
		const location = stubLocation();
		const overlay = await render();
		const options = Array.from(overlay.querySelectorAll('.done-links button')).find((b) => b.textContent === 'Options');
		options.click();
		expect(location.href).toBe('moz-extension://test/options/index.html');
	});

	it('shows a toast when sync succeeds', async () => {
		const overlay = await render();
		const sync = Array.from(overlay.querySelectorAll('.done-links button')).find((b) => b.textContent === 'Sync');
		sync.click();
		await sleep(0);
		expect(toast.showToast).toHaveBeenCalledWith('synced');
	});

	it('shows a toast when sync fails', async () => {
		anki.invoke.mockImplementation((action) => {
			if (action === 'sync') return Promise.reject({type: 'anki', message: 'no'});
			return Promise.resolve([]);
		});
		const overlay = await render();
		const sync = Array.from(overlay.querySelectorAll('.done-links button')).find((b) => b.textContent === 'Sync');
		sync.click();
		await sleep(0);
		expect(toast.showToast).toHaveBeenCalledWith('could not sync');
	});

	it('renders the batch screen instead of the congratulations screen', async () => {
		const onContinue = vi.fn();
		const overlay = await render({batch: {count: 3, onBreak: false, freeUntil: 0, onContinue}});
		expect(overlay.textContent).not.toContain('Congratulations');
		expect(overlay.querySelector('h1').textContent).toBe('3 cards done');
		expect(overlay.querySelector('.batch-sub').textContent).toBe('The rest can wait.');
		const button = overlay.querySelector('.batch-continue');
		expect(button.textContent).toBe('Keep studying');
		button.click();
		expect(onContinue).toHaveBeenCalledTimes(1);
		expect(overlay.querySelector('.done-stats')).not.toBeNull();
		expect(overlay.querySelector('.done-links')).not.toBeNull();
	});

	it('renders the break variant of the batch screen', async () => {
		const freeUntil = new Date(2026, 10, 6, 14, 5, 0).getTime();
		const overlay = await render({batch: {count: 2, onBreak: true, freeUntil, onContinue: vi.fn()}});
		expect(overlay.querySelector('h1').textContent).toBe('Break time');
		expect(overlay.querySelector('.batch-sub').textContent).toMatch(/^Cards are back at /);
		expect(overlay.querySelector('.batch-continue').textContent).toBe('Study anyway');
	});

	it('uses the singular heading for one finished card', async () => {
		const overlay = await render({batch: {count: 1, onBreak: false, freeUntil: 0}});
		expect(overlay.querySelector('h1').textContent).toBe('1 card done');
	});
});
