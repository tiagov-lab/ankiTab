import {describe, it, expect, vi, beforeEach} from 'vitest';
import {loadAppHtml, stubLocation, restoreLocation, sleep} from './helpers/dom.js';

const mocks = vi.hoisted(() => ({
	anki: vi.fn(),
	rotateDeck: vi.fn(),
	showDoneScreen: vi.fn(),
	showOffline: vi.fn(),
	showToast: vi.fn(),
}));

vi.mock('../extension/libs/ankiConnect.js', () => ({
	default: mocks.anki,
	ping: vi.fn(),
	requestPermission: vi.fn(),
	HOST_PERMISSIONS: {},
}));

vi.mock('../extension/app/js/extended/rotateDeck.js', () => ({default: mocks.rotateDeck}));
vi.mock('../extension/app/js/doneScreen.js', () => ({showDoneScreen: mocks.showDoneScreen}));
vi.mock('../extension/app/js/offlineScreen.js', () => ({showOffline: mocks.showOffline}));
vi.mock('../extension/app/js/toast.js', () => ({showToast: mocks.showToast}));

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
			nextReviews: ['<1m', '10m', '1d', '4d'],
		},
		overrides
	);
}

let cardQueue = [];

beforeEach(() => {
	vi.clearAllMocks();
	window.ankitabTheme = undefined;
	cardQueue = [];
	mocks.rotateDeck.mockResolvedValue(true);
	mocks.anki.mockImplementation((action) => {
		switch (action) {
			case 'guiCurrentCard':
				return Promise.resolve(cardQueue.length ? cardQueue.shift() : makeCard());
			case 'getDeckStats':
				return Promise.resolve({1: {new_count: 1, learn_count: 2, review_count: 3}});
			case 'cardsInfo':
				return Promise.resolve([{note: 7}]);
			default:
				return Promise.resolve();
		}
	});
});

async function loadCards({settings = {}, search = '', themeDark = false, cards = []} = {}) {
	loadAppHtml();
	stubLocation(search);
	const frame = document.querySelector('#flashcardSandbox');
	const postMessage = vi.fn();
	// jsdom replaces the iframe's browsing context when src changes; pin the
	// object the extension talks to so the spy cannot be swapped out.
	Object.defineProperty(frame, 'contentWindow', {configurable: true, get: () => ({postMessage})});
	frame.setAttribute('src', 'moz-extension://test/app/sandbox.html');
	window.ankitabTheme = {isDark: () => themeDark, get: () => (themeDark ? 'dark' : 'light'), set: vi.fn(), onChange: vi.fn()};
	cardQueue = cards.slice();
	for (const [key, value] of Object.entries(settings)) chrome.__store[key] = value;
	vi.resetModules();
	const mod = await import('../extension/app/js/cards.js');
	frame.dispatchEvent(new Event('load'));
	return {mod, frame, postMessage};
}

async function startCards(options = {}) {
	const ctx = await loadCards(options);
	await ctx.mod.default();
	await settle();
	return ctx;
}

const renderMessages = (postMessage) => postMessage.mock.calls.map((call) => call[0]).filter((message) => message.command === 'render');
const themeMessages = (postMessage) => postMessage.mock.calls.map((call) => call[0]).filter((message) => message.command === 'theme');

const dueCounts = () => document.querySelector('#dueCounts');
const dots = () => Array.from(document.querySelectorAll('#batchProgress .batch-dot'));

describe('pure helpers', () => {
	it('goodIndex points at the Good button', async () => {
		const {mod} = await startCards({cards: [makeCard({buttons: [1, 2, 3]})]});
		expect(mod.goodIndex()).toBe(2);
	});
});

describe('start', () => {
	it('rotates into a deck and renders the question', async () => {
		const {mod, postMessage} = await startCards();
		expect(mocks.rotateDeck).toHaveBeenCalledTimes(1);
		expect(mocks.anki).toHaveBeenCalledWith('guiCurrentCard');
		expect(mod.getState()).toBe('question');
		expect(mod.getCurrentCard().deckName).toBe('Deck A');
		expect(document.querySelector('#deckName').textContent).toBe('Deck A');
		expect(document.title).toBe('AnkiTab · Deck A');
		expect(dueCounts().textContent).toBe('1 + 2 + 3');
		const renders = renderMessages(postMessage);
		expect(renders.length).toBe(1);
		expect(renders[0].html).toContain('front');
		expect(renders[0].answer).toBe(false);
		expect(renders[0].autoFlip).toBe(true);
	});

	it('posts the theme before the card', async () => {
		const {postMessage} = await startCards({themeDark: true});
		expect(themeMessages(postMessage)[0]).toEqual({command: 'theme', dark: true});
	});

	it('uses the first element when anki returns the question as a list', async () => {
		const {postMessage} = await startCards({cards: [makeCard({question: ['first front', 'second front']})]});
		expect(renderMessages(postMessage)[0].html).toContain('first front');
	});

	it('does not auto-flip when autoFlipChoice is off', async () => {
		const {postMessage} = await startCards({settings: {autoFlipChoice: false}});
		expect(renderMessages(postMessage)[0].autoFlip).toBe(false);
	});

	it('survives an answer side the prefetch cannot parse', async () => {
		const {mod} = await startCards({cards: [makeCard({answer: null})]});
		expect(mod.getState()).toBe('question');
	});

	it('shows the plain title when the deck has no name', async () => {
		await startCards({cards: [makeCard({deckName: ''})]});
		expect(document.title).toBe('AnkiTab');
		expect(document.querySelector('#deckName').textContent).toBe('');
	});

	it('shows the blank done screen for ?blank=1 without touching anki', async () => {
		const {mod} = await startCards({search: '?blank=1'});
		expect(mocks.showDoneScreen).toHaveBeenCalledWith({blank: true});
		expect(mocks.rotateDeck).not.toHaveBeenCalled();
		expect(mocks.anki).not.toHaveBeenCalled();
		expect(mod.getState()).toBe('busy');
	});

	it('clears the due counts on the blank screen', async () => {
		const {mod} = await loadCards({search: '?blank=1'});
		dueCounts().textContent = 'old';
		await mod.default();
		expect(dueCounts().hidden).toBe(true);
		expect(dueCounts().children.length).toBe(0);
	});

	it('shows the batch break screen while new tabs are free', async () => {
		const freeUntil = Date.now() + 60 * 60 * 1000;
		const {mod} = await startCards({settings: {batchSize: 2, batchFreeUntil: freeUntil}});
		expect(mocks.showDoneScreen).toHaveBeenCalledTimes(1);
		const options = mocks.showDoneScreen.mock.calls[0][0];
		expect(options.batch.count).toBe(0);
		expect(options.batch.onBreak).toBe(true);
		expect(options.batch.freeUntil).toBe(freeUntil);
		expect(mocks.rotateDeck).not.toHaveBeenCalled();
		expect(mod.getState()).toBe('busy');
	});

	it('does not show the break screen when the free period is over', async () => {
		await startCards({settings: {batchSize: 2, batchFreeUntil: Date.now() - 1000}});
		expect(mocks.showDoneScreen).not.toHaveBeenCalled();
		expect(mocks.rotateDeck).toHaveBeenCalled();
	});

	it('still studies when batch size is 0 even with a free period', async () => {
		await startCards({settings: {batchSize: 0, batchFreeUntil: Date.now() + 60000}});
		expect(mocks.showDoneScreen).not.toHaveBeenCalled();
		expect(mocks.rotateDeck).toHaveBeenCalled();
	});

	it('shows the offline screen when rotation fails offline', async () => {
		mocks.rotateDeck.mockRejectedValue({type: 'offline'});
		await startCards();
		expect(mocks.showOffline).toHaveBeenCalledWith({onRetry: expect.any(Function)});
	});

	it('shows the done screen when anki has no card', async () => {
		mocks.rotateDeck.mockResolvedValue(false);
		await startCards();
		expect(mocks.showDoneScreen).not.toHaveBeenCalled();
		expect(mocks.anki).not.toHaveBeenCalledWith('guiCurrentCard');
	});
});

describe('renderAnswer', () => {
	it('builds four answer buttons with intervals and tells anki', async () => {
		const {mod, postMessage} = await startCards({cards: [makeCard()]});
		mod.renderAnswer();
		await settle();
		expect(mod.getState()).toBe('answer');
		expect(document.querySelector('#questionControls').hidden).toBe(true);
		expect(document.querySelector('#answerControls').hidden).toBe(false);
		const buttons = Array.from(document.querySelectorAll('#answerControls button')).map((button) => button.textContent);
		expect(buttons).toEqual(['Again', 'Hard', 'Good', 'Easy']);
		const intervals = Array.from(document.querySelectorAll('#answerControls .interval')).map((span) => span.textContent);
		expect(intervals).toEqual(['<1m', '10m', '1d', '4d']);
		expect(mocks.anki).toHaveBeenCalledWith('guiShowAnswer');
		const answerRender = renderMessages(postMessage).find((message) => message.answer === true);
		expect(answerRender.html).toContain('back');
		expect(answerRender.autoFlip).toBe(false);
	});

	it('builds three and two button layouts', async () => {
		const three = await startCards({cards: [makeCard({buttons: [1, 2, 3]})]});
		three.mod.renderAnswer();
		await settle();
		expect(Array.from(document.querySelectorAll('#answerControls button')).map((b) => b.textContent)).toEqual([
			'Again',
			'Good',
			'Easy',
		]);

		const two = await startCards({cards: [makeCard({buttons: [1, 2]})]});
		two.mod.renderAnswer();
		await settle();
		expect(Array.from(document.querySelectorAll('#answerControls button')).map((b) => b.textContent)).toEqual(['Again', 'Good']);
	});

	it('logs when guiShowAnswer fails', async () => {
		const {mod} = await startCards();
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		mocks.anki.mockImplementation((action) => {
			if (action === 'guiShowAnswer') return Promise.reject({type: 'anki', message: 'no'});
			return Promise.resolve();
		});
		mod.renderAnswer();
		await settle();
		expect(warn).toHaveBeenCalledWith('AnkiTab: guiShowAnswer failed', expect.anything());
	});

	it('does nothing outside the question state', async () => {
		const {mod} = await startCards({search: '?blank=1'});
		mod.renderAnswer();
		expect(document.querySelector('#answerControls').children.length).toBe(0);
		expect(mocks.anki).not.toHaveBeenCalledWith('guiShowAnswer');
	});
});

describe('answering', () => {
	it('answers with the clicked ease and moves to the next card', async () => {
		const first = makeCard({question: '<p>one</p>'});
		const second = makeCard({question: '<p>two</p>'});
		const {mod, postMessage} = await startCards({cards: [first, second]});
		mod.renderAnswer();
		await settle();
		document.querySelectorAll('#answerControls button')[1].click();
		await settle();
		expect(mocks.anki).toHaveBeenCalledWith('guiAnswerCard', {ease: 2});
		expect(renderMessages(postMessage).some((message) => message.html.includes('two'))).toBe(true);
		expect(mod.getState()).toBe('question');
	});

	it('ignores an ease outside the available buttons', async () => {
		const {mod} = await startCards({cards: [makeCard({buttons: [1, 2]})]});
		mod.renderAnswer();
		await settle();
		await mod.answerQuestion(5);
		expect(mocks.anki).not.toHaveBeenCalledWith('guiAnswerCard', expect.anything());
	});

	it('re-enables the buttons and toasts when saving fails', async () => {
		const {mod, frame} = await startCards();
		mod.renderAnswer();
		await settle();
		mocks.anki.mockImplementation((action) => {
			if (action === 'guiAnswerCard') return Promise.reject({type: 'anki', message: 'no'});
			return Promise.resolve();
		});
		document.querySelectorAll('#answerControls button')[0].click();
		await settle();
		expect(mocks.showToast).toHaveBeenCalledWith('could not save the answer');
		expect(mod.getState()).toBe('answer');
		expect(Array.from(document.querySelectorAll('#answerControls button')).every((button) => !button.disabled)).toBe(true);
		expect(frame.style.opacity).toBe('');
	});

	it('shows the permission screen when saving needs permission', async () => {
		const {mod} = await startCards();
		mod.renderAnswer();
		await settle();
		mocks.anki.mockImplementation((action) => {
			if (action === 'guiAnswerCard') return Promise.reject({type: 'permission'});
			return Promise.resolve();
		});
		document.querySelectorAll('#answerControls button')[0].click();
		await settle();
		expect(mocks.showOffline).toHaveBeenCalledWith({permission: true, onRetry: expect.any(Function)});
	});

	it('shows the offline screen when saving fails offline', async () => {
		const {mod} = await startCards();
		mod.renderAnswer();
		await settle();
		mocks.anki.mockImplementation((action) => {
			if (action === 'guiAnswerCard') return Promise.reject({type: 'offline'});
			return Promise.resolve();
		});
		document.querySelectorAll('#answerControls button')[0].click();
		await settle();
		expect(mocks.showOffline).toHaveBeenCalledWith({onRetry: expect.any(Function)});
	});
});

describe('batch mode', () => {
	it('shows dots for the batch limit', async () => {
		const {mod} = await startCards({settings: {batchSize: 3}});
		expect(mod.batchLimit()).toBe(3);
		expect(dots().length).toBe(3);
		expect(dots()[0].classList.contains('current')).toBe(true);
		expect(dots().filter((dot) => dot.classList.contains('filled')).length).toBe(0);
		expect(document.querySelector('#batchProgress').title).toBe('card 1 of 3 in this tab');
		expect(document.querySelector('#batchProgress').hidden).toBe(false);
	});

	it('fills the dots as cards are answered', async () => {
		const {mod} = await startCards({settings: {batchSize: 3}});
		mod.renderAnswer();
		await settle();
		document.querySelectorAll('#answerControls button')[0].click();
		await settle();
		expect(dots().filter((dot) => dot.classList.contains('filled')).length).toBe(1);
		expect(dots()[1].classList.contains('current')).toBe(true);
	});

	it('uses text instead of many dots above 12', async () => {
		await startCards({settings: {batchSize: 13}});
		const progress = document.querySelector('#batchProgress');
		expect(progress.classList.contains('text')).toBe(true);
		expect(progress.textContent).toBe('1 / 13');
		expect(progress.title).toBe('card 1 of 13 in this tab');
	});

	it('hides the progress with no batch limit', async () => {
		await startCards();
		const progress = document.querySelector('#batchProgress');
		expect(progress.hidden).toBe(true);
		expect(progress.children.length).toBe(0);
	});

	it('shows the batch done screen when the cap is reached', async () => {
		const {mod} = await startCards({settings: {batchSize: 2}});
		mod.renderAnswer();
		await settle();
		document.querySelectorAll('#answerControls button')[0].click();
		await settle();
		mod.renderAnswer();
		await settle();
		document.querySelectorAll('#answerControls button')[0].click();
		await settle();
		expect(mocks.showDoneScreen).toHaveBeenCalledTimes(1);
		const options = mocks.showDoneScreen.mock.calls[0][0];
		expect(options.batch.count).toBe(2);
		expect(options.batch.onBreak).toBe(false);
		expect(options.batch.freeUntil).toBe(0);
		expect(chrome.__store.batchFreeUntil).toBeUndefined();
	});

	it('writes batchFreeUntil after a batch when a break is configured', async () => {
		const {mod} = await startCards({settings: {batchSize: 1, batchBreakMinutes: 5}});
		mod.renderAnswer();
		await settle();
		document.querySelectorAll('#answerControls button')[0].click();
		await settle();
		expect(chrome.__store.batchFreeUntil).toBeGreaterThan(Date.now() + 4 * 60 * 1000);
		const options = mocks.showDoneScreen.mock.calls[0][0];
		expect(options.batch.freeUntil).toBe(chrome.__store.batchFreeUntil);
	});

	it('resumes studying and hides the dots from the continue button', async () => {
		const {mod} = await startCards({settings: {batchSize: 1}, cards: [makeCard(), makeCard()]});
		mod.renderAnswer();
		await settle();
		document.querySelectorAll('#answerControls button')[0].click();
		await settle();
		const options = mocks.showDoneScreen.mock.calls[0][0];
		options.batch.onContinue();
		await settle();
		expect(mod.batchLimit()).toBe(0);
		expect(document.querySelector('#batchProgress').hidden).toBe(true);
		expect(mocks.rotateDeck).toHaveBeenCalledTimes(2);
	});

	it('handles a rotation error after answering', async () => {
		const {mod} = await startCards();
		mod.renderAnswer();
		await settle();
		mocks.rotateDeck.mockRejectedValue({type: 'offline'});
		document.querySelectorAll('#answerControls button')[0].click();
		await settle();
		expect(mocks.showOffline).toHaveBeenCalledWith({onRetry: expect.any(Function)});
	});

	it('starts a deck again after a break screen continue', async () => {
		const freeUntil = Date.now() + 60000;
		const {mod} = await startCards({settings: {batchSize: 2, batchFreeUntil: freeUntil}});
		const options = mocks.showDoneScreen.mock.calls[0][0];
		options.batch.onContinue();
		await settle();
		expect(mocks.rotateDeck).toHaveBeenCalledTimes(1);
		expect(mocks.anki).toHaveBeenCalledWith('guiCurrentCard');
		expect(mod.getState()).toBe('question');
	});

	it('keeps the brief overlay hidden after continuing from the start break screen', async () => {
		await startCards({settings: {batchSize: 2, batchFreeUntil: Date.now() + 60000}});
		const options = mocks.showDoneScreen.mock.calls[0][0];
		const overlay = document.querySelector('#overlay');
		overlay.hidden = false;
		options.batch.onContinue();
		expect(overlay.hidden).toBe(true);
	});
});

describe('settings changes', () => {
	it('refreshes due counts when showDueCounts changes', async () => {
		await startCards();
		expect(dueCounts().hidden).toBe(false);
		chrome.storage.local.set({showDueCounts: false});
		await settle();
		expect(dueCounts().hidden).toBe(true);
	});

	it('refreshes batch dots when batchSize changes', async () => {
		await startCards({settings: {batchSize: 2}});
		expect(dots().length).toBe(2);
		chrome.storage.local.set({batchSize: 5});
		expect(dots().length).toBe(5);
	});

	it('ignores changes from other storage areas', async () => {
		await startCards({settings: {batchSize: 2}});
		const listener = Array.from(chrome.__changesListeners)[0];
		listener({batchSize: {newValue: 9}}, 'sync');
		expect(dots().length).toBe(2);
	});
});

describe('undo', () => {
	it('undoes, decrements the batch count and reloads the card', async () => {
		const {mod, postMessage} = await startCards({settings: {batchSize: 3}, cards: [makeCard(), makeCard()]});
		mod.renderAnswer();
		await settle();
		document.querySelectorAll('#answerControls button')[0].click();
		await settle();
		expect(dots().filter((dot) => dot.classList.contains('filled')).length).toBe(1);
		await mod.undo();
		await settle();
		expect(mocks.anki).toHaveBeenCalledWith('guiUndo');
		expect(dots().filter((dot) => dot.classList.contains('filled')).length).toBe(0);
	});

	it('shows a toast when there is nothing to undo', async () => {
		const {mod} = await startCards();
		mocks.anki.mockImplementation((action) => {
			if (action === 'guiUndo') return Promise.reject({type: 'anki', message: 'nothing'});
			return Promise.resolve();
		});
		await mod.undo();
		expect(mocks.showToast).toHaveBeenCalledWith('nothing to undo');
	});

	it('does nothing while busy', async () => {
		const {mod} = await startCards({search: '?blank=1'});
		await mod.undo();
		expect(mocks.anki).not.toHaveBeenCalledWith('guiUndo');
	});

	it('shows the offline screen on an offline undo', async () => {
		const {mod} = await startCards();
		mocks.anki.mockImplementation((action) => {
			if (action === 'guiUndo') return Promise.reject({type: 'offline'});
			return Promise.resolve();
		});
		await mod.undo();
		expect(mocks.showOffline).toHaveBeenCalledWith({onRetry: expect.any(Function)});
	});
});

describe('suspend, bury and edit', () => {
	it('suspends the current card, reviews the deck and continues', async () => {
		const {mod} = await startCards();
		await mod.suspendCard();
		await settle();
		expect(mocks.anki).toHaveBeenCalledWith('suspend', {cards: [100]});
		expect(mocks.anki).toHaveBeenCalledWith('guiDeckReview', {name: 'Deck A'});
		expect(mocks.showToast).toHaveBeenCalledWith('card suspended');
		expect(mocks.rotateDeck).toHaveBeenCalledTimes(2);
	});

	it('restores the state when suspending fails', async () => {
		const {mod} = await startCards();
		mod.renderAnswer();
		await settle();
		mocks.anki.mockImplementation((action) => {
			if (action === 'suspend') return Promise.reject({type: 'anki'});
			return Promise.resolve();
		});
		await mod.suspendCard();
		expect(mocks.showToast).toHaveBeenCalledWith('could not suspend the card');
		expect(mod.getState()).toBe('answer');
	});

	it('does nothing without a card', async () => {
		const {mod} = await startCards({search: '?blank=1'});
		await mod.suspendCard();
		expect(mocks.anki).not.toHaveBeenCalled();
	});

	it('buries the current card', async () => {
		const {mod} = await startCards();
		await mod.buryCard();
		await settle();
		expect(mocks.anki).toHaveBeenCalledWith('buryCards', {cards: [100]});
		expect(mocks.showToast).toHaveBeenCalledWith('card buried');
	});

	it('toasts when bury is unsupported', async () => {
		const {mod} = await startCards();
		mocks.anki.mockImplementation((action) => {
			if (action === 'buryCards') return Promise.reject({type: 'anki', message: 'unknown action'});
			return Promise.resolve();
		});
		await mod.buryCard();
		expect(mocks.showToast).toHaveBeenCalledWith("bury isn't supported by AnkiConnect");
	});

	it('shows the offline screen when bury fails offline', async () => {
		const {mod} = await startCards();
		mocks.anki.mockImplementation((action) => {
			if (action === 'buryCards') return Promise.reject({type: 'offline'});
			return Promise.resolve();
		});
		await mod.buryCard();
		expect(mocks.showOffline).toHaveBeenCalled();
	});

	it('opens the note editor', async () => {
		const {mod} = await startCards();
		await mod.editNote();
		expect(mocks.anki).toHaveBeenCalledWith('cardsInfo', {cards: [100]});
		expect(mocks.anki).toHaveBeenCalledWith('guiEditNote', {note: 7});
		expect(mocks.showToast).toHaveBeenCalledWith('opened in anki');
	});

	it('toasts when the note cannot be found', async () => {
		const {mod} = await startCards();
		mocks.anki.mockImplementation((action) => {
			if (action === 'cardsInfo') return Promise.resolve([{note: null}]);
			return Promise.resolve();
		});
		await mod.editNote();
		expect(mocks.showToast).toHaveBeenCalledWith('could not open the editor');
	});

	it('does nothing without a current card', async () => {
		const {mod} = await startCards({search: '?blank=1'});
		await mod.editNote();
		expect(mocks.anki).not.toHaveBeenCalledWith('cardsInfo', expect.anything());
	});

	it('shows the offline screen when editing needs permission', async () => {
		const {mod} = await startCards();
		mocks.anki.mockImplementation((action) => {
			if (action === 'cardsInfo') return Promise.reject({type: 'permission'});
			return Promise.resolve();
		});
		await mod.editNote();
		expect(mocks.showOffline).toHaveBeenCalledWith({permission: true, onRetry: expect.any(Function)});
	});
});

describe('keyboard', () => {
	it('forwards space in the question state to renderAnswer', async () => {
		const {mod} = await startCards();
		mod.handleKeyEvent({key: ' ', code: 'Space', target: null, preventDefault: vi.fn()});
		await settle();
		expect(mod.getState()).toBe('answer');
	});

	it('answers a digit key in the answer state', async () => {
		const {mod} = await startCards();
		mod.renderAnswer();
		await settle();
		mocks.anki.mockClear();
		mod.handleKeyEvent({key: '2', code: 'Digit2', target: null, preventDefault: vi.fn()});
		await settle();
		expect(mocks.anki).toHaveBeenCalledWith('guiAnswerCard', {ease: 2});
	});

	it('replays audio through the sandbox', async () => {
		const {mod, postMessage} = await startCards();
		mod.replayAudio();
		expect(postMessage).toHaveBeenCalledWith({command: 'replayAudio'}, '*');
	});
});

describe('getCard retries', () => {
	it('marks the deck empty, rotates and retries after an anki error', async () => {
		let calls = 0;
		mocks.anki.mockImplementation((action) => {
			if (action === 'guiCurrentCard') {
				calls++;
				if (calls === 1) return Promise.reject({type: 'anki', message: 'no card'});
				return Promise.resolve(makeCard({question: '<p>retry</p>'}));
			}
			if (action === 'getDeckStats') return Promise.resolve({});
			return Promise.resolve();
		});
		chrome.__store.lastDeck = 'Deck A';
		const {postMessage} = await startCards();
		expect(calls).toBe(2);
		expect(mocks.rotateDeck).toHaveBeenCalledTimes(2);
		expect(chrome.__store.emptyDecks).toEqual([{name: 'Deck A', date: expect.any(Number)}]);
		expect(renderMessages(postMessage).some((message) => message.html.includes('retry'))).toBe(true);
	});

	it('gives up after five retries and shows the done screen', async () => {
		let calls = 0;
		mocks.anki.mockImplementation((action) => {
			if (action === 'guiCurrentCard') {
				calls++;
				return Promise.reject({type: 'anki', message: 'no card'});
			}
			return Promise.resolve();
		});
		await startCards();
		expect(calls).toBe(6);
		expect(mocks.showDoneScreen).toHaveBeenCalled();
	});

	it('stops retrying when no deck is left', async () => {
		mocks.rotateDeck.mockResolvedValueOnce(true).mockResolvedValue(false);
		mocks.anki.mockImplementation((action) => {
			if (action === 'guiCurrentCard') return Promise.reject({type: 'anki', message: 'no card'});
			return Promise.resolve();
		});
		await startCards();
		expect(mocks.anki).toHaveBeenCalledTimes(1);
	});

	it('shows the offline screen for a network error while fetching a card', async () => {
		mocks.anki.mockImplementation((action) => {
			if (action === 'guiCurrentCard') return Promise.reject({type: 'offline'});
			return Promise.resolve();
		});
		await startCards();
		expect(mocks.showOffline).toHaveBeenCalled();
		expect(mocks.showDoneScreen).not.toHaveBeenCalled();
	});
});
