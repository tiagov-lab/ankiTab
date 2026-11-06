import {beforeEach, describe, expect, it} from 'vitest';
import {
	breakEndsAt,
	createBatch,
	isOnBreak,
	renderBatchProgress,
} from '../extension/app/js/batch.js';

const makeSettings = (overrides = {}) =>
	Object.assign({batchSize: 0, batchBreakMinutes: 0, batchFreeUntil: 0}, overrides);

let container;

beforeEach(() => {
	document.body.innerHTML = '<div id="batchProgress"></div>';
	container = document.getElementById('batchProgress');
});

describe('batch progress', () => {
	it('begins with an empty count', () => {
		const batch = createBatch();
		expect(batch.count).toBe(0);
		expect(batch.off).toBe(false);
	});

	it('reports the configured limit', () => {
		expect(createBatch().limit({ batchSize: 4 })).toBe(4);
	});

	it('treats a missing batch size as no limit', () => {
		expect(createBatch().limit({})).toBe(0);
	});

	it('records answers and reports when the cap is reached', () => {
		const batch = createBatch();
		const settings = makeSettings({batchSize: 2});
		expect(batch.recordAnswer(settings)).toBe(false);
		expect(batch.count).toBe(1);
		expect(batch.recordAnswer(settings)).toBe(true);
		expect(batch.count).toBe(2);
	});

	it('never completes when there is no limit', () => {
		const batch = createBatch();
		expect(batch.recordAnswer(makeSettings({batchSize: 0}))).toBe(false);
		expect(batch.recordAnswer(makeSettings({batchSize: 0}))).toBe(false);
	});

	it('undoes one answer without going below zero', () => {
		const batch = createBatch();
		batch.recordAnswer(makeSettings({batchSize: 3}));
		batch.undoAnswer();
		expect(batch.count).toBe(0);
		batch.undoAnswer();
		expect(batch.count).toBe(0);
	});

	it('removes the cap after keepGoing', () => {
		const batch = createBatch();
		const settings = makeSettings({batchSize: 1});
		expect(batch.recordAnswer(settings)).toBe(true);
		batch.keepGoing();
		expect(batch.off).toBe(true);
		expect(batch.limit(settings)).toBe(0);
		batch.undoAnswer();
		expect(batch.recordAnswer(settings)).toBe(false);
	});
});

describe('break timing', () => {
	it('is on a break while the stored deadline is in the future', () => {
		const settings = {batchSize: 2, batchFreeUntil: 2000};
		expect(isOnBreak(settings, 1000)).toBe(true);
	});

	it('is not on a break once the deadline has passed', () => {
		const settings = {batchSize: 2, batchFreeUntil: 2000};
		expect(isOnBreak(settings, 3000)).toBe(false);
	});

	it('is never on a break without a batch limit', () => {
		const settings = {batchSize: 0, batchFreeUntil: 2000};
		expect(isOnBreak(settings, 1000)).toBe(false);
	});

	it('is not on a break when no deadline was stored', () => {
		expect(isOnBreak({batchSize: 2}, 1000)).toBe(false);
	});

	it('computes the end of a break that starts now', () => {
		expect(breakEndsAt({batchBreakMinutes: 5}, 1000)).toBe(1000 + 5 * 60000);
	});

	it('returns zero when breaks are not configured', () => {
		expect(breakEndsAt({batchBreakMinutes: 0}, 1000)).toBe(0);
	});
});

describe('renderBatchProgress', () => {
	it('draws one dot per card with the current one highlighted', () => {
		const batch = createBatch();
		renderBatchProgress(container, batch, makeSettings({batchSize: 3}));
		const dots = Array.from(container.querySelectorAll('.batch-dot'));
		expect(dots.length).toBe(3);
		expect(dots[0].classList.contains('current')).toBe(true);
		expect(dots.filter((dot) => dot.classList.contains('filled')).length).toBe(0);
		expect(container.title).toBe('card 1 of 3 in this tab');
		expect(container.hidden).toBe(false);
	});

	it('fills answered dots', () => {
		const batch = createBatch();
		const settings = makeSettings({batchSize: 3});
		batch.recordAnswer(settings);
		renderBatchProgress(container, batch, settings);
		const dots = Array.from(container.querySelectorAll('.batch-dot'));
		expect(dots.filter((dot) => dot.classList.contains('filled')).length).toBe(1);
		expect(dots[1].classList.contains('current')).toBe(true);
	});

	it('uses text instead of many dots above 12', () => {
		renderBatchProgress(container, createBatch(), makeSettings({batchSize: 13}));
		expect(container.classList.contains('text')).toBe(true);
		expect(container.textContent).toBe('1 / 13');
		expect(container.title).toBe('card 1 of 13 in this tab');
	});

	it('hides and clears itself with no batch limit', () => {
		renderBatchProgress(container, createBatch(), makeSettings({batchSize: 3}));
		renderBatchProgress(container, createBatch(), makeSettings({batchSize: 0}));
		expect(container.hidden).toBe(true);
		expect(container.children.length).toBe(0);
		expect(container.hasAttribute('title')).toBe(false);
		expect(container.classList.contains('text')).toBe(false);
	});
});
