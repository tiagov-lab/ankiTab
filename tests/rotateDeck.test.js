import {describe, it, expect, vi, beforeEach} from 'vitest';

const anki = vi.hoisted(() => ({invoke: vi.fn()}));
const done = vi.hoisted(() => ({showDoneScreen: vi.fn()}));

vi.mock('../extension/libs/ankiConnect.js', () => ({
	default: anki.invoke,
	ping: vi.fn(),
	requestPermission: vi.fn(),
	HOST_PERMISSIONS: {},
}));

vi.mock('../extension/app/js/doneScreen.js', () => ({
	showDoneScreen: done.showDoneScreen,
}));

beforeEach(() => {
	anki.invoke.mockReset();
	done.showDoneScreen.mockReset();
	anki.invoke.mockImplementation((action) => {
		if (action === 'deckNames') return Promise.resolve([]);
		if (action === 'guiDeckReview') return Promise.resolve();
		return Promise.reject({type: 'anki', message: 'unknown action'});
	});
});

async function loadRotate() {
	vi.resetModules();
	return import('../extension/app/js/extended/rotateDeck.js');
}

describe('rotateDeck', () => {
	it('returns true without anki calls when interleaving is disabled', async () => {
		chrome.__store.interleavingDisabled = true;
		const {default: rotateDeck} = await import('../extension/app/js/extended/rotateDeck.js');
		await expect(rotateDeck()).resolves.toBe(true);
		expect(anki.invoke).not.toHaveBeenCalled();
		expect(done.showDoneScreen).not.toHaveBeenCalled();
	});

	it('fetches deck names when the cache is empty and stores them', async () => {
		anki.invoke.mockImplementation((action) => {
			if (action === 'deckNames') return Promise.resolve(['Deck A']);
			return Promise.resolve();
		});
		const {default: rotateDeck} = await loadRotate();
		await expect(rotateDeck()).resolves.toBe(true);
		expect(anki.invoke).toHaveBeenCalledWith('deckNames');
		expect(chrome.__store.deckNames).toEqual(['Deck A']);
		expect(anki.invoke).toHaveBeenCalledWith('guiDeckReview', {name: 'Deck A'});
		expect(chrome.__store.lastDeck).toBe('Deck A');
	});

	it('refreshes a cached deck list in the background', async () => {
		chrome.__store.deckNames = ['Deck A'];
		anki.invoke.mockImplementation((action) => {
			if (action === 'deckNames') return Promise.resolve(['Deck A', 'Deck B']);
			return Promise.resolve();
		});
		const {default: rotateDeck} = await loadRotate();
		await rotateDeck();
		expect(anki.invoke).toHaveBeenCalledWith('guiDeckReview', {name: 'Deck A'});
		expect(chrome.__store.deckNames).toEqual(['Deck A', 'Deck B']);
	});

	it('a failing background refresh does not break the current card', async () => {
		chrome.__store.deckNames = ['Deck A'];
		anki.invoke.mockImplementation((action) => {
			if (action === 'deckNames') return Promise.reject({type: 'offline'});
			return Promise.resolve();
		});
		const {default: rotateDeck} = await loadRotate();
		await expect(rotateDeck()).resolves.toBe(true);
		expect(chrome.__store.deckNames).toEqual(['Deck A']);
	});

	it('skips decks marked empty within the last hour and prunes older entries', async () => {
		const now = Date.now();
		chrome.__store.deckNames = ['Deck A', 'Deck B'];
		chrome.__store.emptyDecks = [
			{name: 'Deck A', date: now - 2 * 60 * 60 * 1000},
			{name: 'Deck B', date: now - 1000},
		];
		const {default: rotateDeck} = await loadRotate();
		await rotateDeck();
		expect(anki.invoke).toHaveBeenCalledWith('guiDeckReview', {name: 'Deck A'});
		expect(chrome.__store.emptyDecks).toEqual([{name: 'Deck B', date: now - 1000}]);
	});

	it('skips excluded decks and recently emptied ones', async () => {
		chrome.__store.deckNames = ['Deck A', 'Deck B', 'Deck C'];
		chrome.__store.excludedDecks = ['Deck A'];
		chrome.__store.emptyDecks = [{name: 'Deck C', date: Date.now()}];
		const {default: rotateDeck} = await loadRotate();
		await rotateDeck();
		expect(anki.invoke).toHaveBeenCalledWith('guiDeckReview', {name: 'Deck B'});
	});

	it('picks the alphabetically next deck after lastDeck', async () => {
		chrome.__store.deckNames = ['b', 'c', 'a'];
		chrome.__store.lastDeck = 'a';
		const {default: rotateDeck} = await loadRotate();
		await rotateDeck();
		expect(anki.invoke).toHaveBeenCalledWith('guiDeckReview', {name: 'b'});
		expect(chrome.__store.lastDeck).toBe('b');
	});

	it('wraps around to the first deck when lastDeck was the last one', async () => {
		chrome.__store.deckNames = ['b', 'c', 'a'];
		chrome.__store.lastDeck = 'c';
		const {default: rotateDeck} = await loadRotate();
		await rotateDeck();
		expect(anki.invoke).toHaveBeenCalledWith('guiDeckReview', {name: 'a'});
	});

	it('shows the done screen and returns false when no deck is left', async () => {
		chrome.__store.deckNames = ['Deck A'];
		chrome.__store.excludedDecks = ['Deck A'];
		const {default: rotateDeck} = await loadRotate();
		await expect(rotateDeck()).resolves.toBe(false);
		expect(done.showDoneScreen).toHaveBeenCalledTimes(1);
		expect(anki.invoke).not.toHaveBeenCalledWith('guiDeckReview', expect.anything());
	});

	it('does not show the done screen when DOMchange is false', async () => {
		chrome.__store.deckNames = ['Deck A'];
		chrome.__store.excludedDecks = ['Deck A'];
		const {default: rotateDeck} = await loadRotate();
		await expect(rotateDeck(false)).resolves.toBe(false);
		expect(done.showDoneScreen).not.toHaveBeenCalled();
	});

	it('reports done with an empty deck list and nothing cached', async () => {
		anki.invoke.mockImplementation((action) => {
			if (action === 'deckNames') return Promise.resolve([]);
			return Promise.resolve();
		});
		const {default: rotateDeck} = await loadRotate();
		await expect(rotateDeck()).resolves.toBe(false);
		expect(done.showDoneScreen).toHaveBeenCalledTimes(1);
	});
});
