import {describe, it, expect, vi, beforeEach, afterEach} from 'vitest';

async function loadToast() {
	vi.resetModules();
	return import('../extension/app/js/toast.js');
}

function mountToast() {
	const toast = document.createElement('div');
	toast.id = 'toast';
	toast.hidden = true;
	document.body.appendChild(toast);
	return toast;
}

beforeEach(() => {
	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
});

describe('showToast', () => {
	it('shows the text and makes the toast visible on the next frame', async () => {
		const toast = mountToast();
		const {showToast} = await loadToast();
		showToast('hello');
		expect(toast.textContent).toBe('hello');
		expect(toast.hidden).toBe(false);
		expect(toast.classList.contains('visible')).toBe(false);
		await vi.advanceTimersByTimeAsync(16);
		expect(toast.classList.contains('visible')).toBe(true);
	});

	it('hides after 2500ms and takes the toast out of layout 250ms later', async () => {
		const toast = mountToast();
		const {showToast} = await loadToast();
		showToast('hello');
		vi.advanceTimersByTime(2499);
		expect(toast.hidden).toBe(false);
		vi.advanceTimersByTime(1);
		expect(toast.classList.contains('visible')).toBe(false);
		expect(toast.hidden).toBe(false);
		vi.advanceTimersByTime(250);
		expect(toast.hidden).toBe(true);
	});

	it('restarts the hide timers when a second toast arrives', async () => {
		const toast = mountToast();
		const {showToast} = await loadToast();
		showToast('first');
		vi.advanceTimersByTime(2000);
		showToast('second');
		expect(toast.textContent).toBe('second');
		vi.advanceTimersByTime(2000);
		expect(toast.classList.contains('visible')).toBe(true);
		expect(toast.hidden).toBe(false);
		vi.advanceTimersByTime(500);
		expect(toast.classList.contains('visible')).toBe(false);
	});

	it('does nothing when there is no toast element', async () => {
		const {showToast} = await loadToast();
		expect(() => showToast('hello')).not.toThrow();
	});
});
