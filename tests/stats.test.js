import {describe, it, expect, vi, beforeEach} from 'vitest';
import {startOfAnkiDay, formatDuration, buildStats} from '../extension/app/js/done/stats.js';
import {sleep} from './helpers/dom.js';

const anki = vi.hoisted(() => ({invoke: vi.fn()}));

vi.mock('../extension/libs/ankiConnect.js', () => ({default: anki.invoke}));

beforeEach(() => {
	anki.invoke.mockReset();
	anki.invoke.mockImplementation((action, params) => {
		if (action === 'getNumCardsReviewedToday') return Promise.resolve(2);
		if (action === 'findCards') return Promise.resolve(params.query === 'rated:1' ? [] : [1]);
		return Promise.reject(new Error('unexpected anki call: ' + action));
	});
});

describe('startOfAnkiDay', () => {
	it('uses 4am of the same day after 4am', () => {
		const now = new Date(2026, 10, 6, 10, 30, 0);
		const start = new Date(startOfAnkiDay(now));
		expect(start.getFullYear()).toBe(2026);
		expect(start.getMonth()).toBe(10);
		expect(start.getDate()).toBe(6);
		expect(start.getHours()).toBe(4);
		expect(start.getMinutes()).toBe(0);
	});

	it('uses 4am of the previous day before 4am', () => {
		const now = new Date(2026, 10, 6, 2, 30, 0);
		const start = new Date(startOfAnkiDay(now));
		expect(start.getDate()).toBe(5);
		expect(start.getHours()).toBe(4);
	});

	it('treats exactly 4am as the start of the new day', () => {
		const now = new Date(2026, 10, 6, 4, 0, 0);
		const start = new Date(startOfAnkiDay(now));
		expect(start.getDate()).toBe(6);
	});
});

describe('formatDuration', () => {
	it('says less than a minute for short durations', () => {
		expect(formatDuration(0)).toBe('less than a minute');
		expect(formatDuration(29 * 1000)).toBe('less than a minute');
	});

	it('formats minutes', () => {
		expect(formatDuration(60 * 1000)).toBe('1m');
		expect(formatDuration(5 * 60 * 1000)).toBe('5m');
		expect(formatDuration(59 * 60 * 1000)).toBe('59m');
	});

	it('rounds partial minutes', () => {
		expect(formatDuration(90 * 1000)).toBe('2m');
	});

	it('formats hours and minutes', () => {
		expect(formatDuration(60 * 60 * 1000)).toBe('1h 0m');
		expect(formatDuration(90 * 60 * 1000)).toBe('1h 30m');
		expect(formatDuration(125 * 60 * 1000)).toBe('2h 5m');
	});
});

describe('buildStats', () => {
	it('returns a done-stats element and fills it in the background', async () => {
		const stats = buildStats({doneShowStats: true, doneShowNextDue: true});
		expect(stats.className).toBe('done-stats');
		expect(stats.children.length).toBe(0);

		await sleep(0);

		const lines = Array.from(stats.children).map((line) => line.textContent);
		expect(lines).toEqual(['2 cards reviewed today', 'Time studied today: less than a minute', '1 card due tomorrow']);
	});

	it('asks anki only for the enabled sections', async () => {
		const stats = buildStats({doneShowStats: false, doneShowNextDue: true});

		await sleep(0);

		expect(anki.invoke).not.toHaveBeenCalledWith('getNumCardsReviewedToday');
		const lines = Array.from(stats.children).map((line) => line.textContent);
		expect(lines).toEqual(['1 card due tomorrow']);
	});
});
