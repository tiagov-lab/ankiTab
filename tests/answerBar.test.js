import {describe, it, expect, vi, beforeEach} from 'vitest';
import {loadAppHtml, sleep} from './helpers/dom.js';

const mocks = vi.hoisted(() => ({
	anki: vi.fn(),
}));

vi.mock('../extension/libs/ankiConnect.js', () => ({
	default: mocks.anki,
	ping: vi.fn(),
	requestPermission: vi.fn(),
	HOST_PERMISSIONS: {},
}));

const settle = () => sleep(0);
const dueCounts = () => document.querySelector('#dueCounts');
const answerButtons = () => Array.from(document.querySelectorAll('#answerControls button'));

function deferred() {
	let resolve;
	let reject;
	const promise = new Promise((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return {promise, resolve, reject};
}

async function loadAnswerBar() {
	loadAppHtml();
	vi.resetModules();
	return import('../extension/app/js/answerBar.js');
}

beforeEach(() => {
	vi.clearAllMocks();
});

describe('buttonNames', () => {
	it('picks names by button count', async () => {
		const mod = await loadAnswerBar();
		expect(mod.buttonNames(4)).toEqual(['Again', 'Hard', 'Good', 'Easy']);
		expect(mod.buttonNames(5)).toEqual(['Again', 'Hard', 'Good', 'Easy']);
		expect(mod.buttonNames(3)).toEqual(['Again', 'Good', 'Easy']);
		expect(mod.buttonNames(2)).toEqual(['Again', 'Good']);
		expect(mod.buttonNames(1)).toEqual(['Again', 'Good']);
	});
});

describe('due counts', () => {
	it('writes new + learning + review', async () => {
		const mod = await loadAnswerBar();
		mod.renderDueCounts({1: {new_count: 4, learn_count: 0, review_count: 2}});
		expect(dueCounts().hidden).toBe(false);
		expect(dueCounts().textContent).toBe('4 + 0 + 2');
		expect(dueCounts().querySelector('.due-new').textContent).toBe('4');
		expect(dueCounts().querySelector('.due-review').textContent).toBe('2');
	});

	it('clears with no stats', async () => {
		const mod = await loadAnswerBar();
		dueCounts().textContent = 'old';
		mod.renderDueCounts(null);
		expect(dueCounts().children.length).toBe(0);
		expect(dueCounts().hidden).toBe(true);
	});

	it('clears and skips anki when due counts are off', async () => {
		const mod = await loadAnswerBar();
		dueCounts().textContent = 'old';
		mod.fetchDueCounts('Deck A', false);
		expect(dueCounts().hidden).toBe(true);
		expect(dueCounts().children.length).toBe(0);
		expect(mocks.anki).not.toHaveBeenCalled();
	});

	it('asks anki for the deck stats and renders them', async () => {
		const mod = await loadAnswerBar();
		mocks.anki.mockResolvedValue({1: {new_count: 5, learn_count: 1, review_count: 2}});
		mod.fetchDueCounts('Deck A', true);
		expect(mocks.anki).toHaveBeenCalledWith('getDeckStats', {decks: ['Deck A']});
		await settle();
		expect(dueCounts().textContent).toBe('5 + 1 + 2');
	});

	it('does not let an older response overwrite a newer one', async () => {
		const mod = await loadAnswerBar();
		const requests = [];
		mocks.anki.mockImplementation((action) => {
			if (action === 'getDeckStats') {
				const request = deferred();
				requests.push(request);
				return request.promise;
			}
			return Promise.resolve();
		});
		mod.fetchDueCounts('Deck A', true);
		mod.fetchDueCounts('Deck B', true);
		expect(requests.length).toBe(2);
		requests[1].resolve({1: {new_count: 9, learn_count: 0, review_count: 0}});
		await settle();
		expect(dueCounts().textContent).toBe('9 + 0 + 0');
		requests[0].resolve({1: {new_count: 1, learn_count: 1, review_count: 1}});
		await settle();
		expect(dueCounts().textContent).toBe('9 + 0 + 0');
	});

	it('clears the counts when the newest request fails', async () => {
		const mod = await loadAnswerBar();
		mocks.anki.mockRejectedValue({type: 'anki', message: 'no'});
		mod.fetchDueCounts('Deck A', true);
		await settle();
		expect(dueCounts().hidden).toBe(true);
	});
});

describe('controls', () => {
	it('shows the question controls and empties the answer controls', async () => {
		const mod = await loadAnswerBar();
		const question = document.querySelector('#questionControls');
		const answers = document.querySelector('#answerControls');
		question.hidden = true;
		answers.hidden = false;
		answers.textContent = 'old';
		mod.showQuestionControls();
		expect(question.hidden).toBe(false);
		expect(answers.hidden).toBe(true);
		expect(answers.childNodes.length).toBe(0);
	});

	it('builds the answer buttons and reports the clicked ease', async () => {
		const mod = await loadAnswerBar();
		const onAnswer = vi.fn();
		mod.showAnswerControls(['Again', 'Hard', 'Good', 'Easy'], ['<1m', '10m', '1d', '4d'], onAnswer);
		const question = document.querySelector('#questionControls');
		const answers = document.querySelector('#answerControls');
		expect(question.hidden).toBe(true);
		expect(answers.hidden).toBe(false);
		expect(answerButtons().map((button) => button.textContent)).toEqual(['Again', 'Hard', 'Good', 'Easy']);
		expect(Array.from(answers.querySelectorAll('.interval')).map((span) => span.textContent)).toEqual([
			'<1m',
			'10m',
			'1d',
			'4d',
		]);
		answerButtons()[2].click();
		expect(onAnswer).toHaveBeenCalledWith(3);
	});

	it('leaves the interval empty when anki has none', async () => {
		const mod = await loadAnswerBar();
		mod.showAnswerControls(['Again', 'Good'], [], () => {});
		expect(Array.from(document.querySelectorAll('#answerControls .interval')).map((span) => span.textContent)).toEqual([
			'',
			'',
		]);
	});

	it('replaces the previous buttons', async () => {
		const mod = await loadAnswerBar();
		mod.showAnswerControls(['Again', 'Hard', 'Good', 'Easy'], [], () => {});
		mod.showAnswerControls(['Again', 'Good'], [], () => {});
		expect(answerButtons().map((button) => button.textContent)).toEqual(['Again', 'Good']);
	});

	it('disables and re-enables every answer button', async () => {
		const mod = await loadAnswerBar();
		mod.showAnswerControls(['Again', 'Good'], [], () => {});
		mod.setAnswerButtonsDisabled(true);
		expect(answerButtons().every((button) => button.disabled)).toBe(true);
		mod.setAnswerButtonsDisabled(false);
		expect(answerButtons().every((button) => !button.disabled)).toBe(true);
	});
});
