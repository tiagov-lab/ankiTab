import {describe, it, expect, vi, beforeEach, afterEach, beforeAll} from 'vitest';

const anki = vi.hoisted(() => ({ping: vi.fn(), requestPermission: vi.fn()}));

vi.mock('../extension/libs/ankiConnect.js', () => ({
	ping: anki.ping,
	requestPermission: anki.requestPermission,
	default: vi.fn(),
	HOST_PERMISSIONS: {},
}));

let visibility = 'visible';

beforeAll(() => {
	Object.defineProperty(document, 'visibilityState', {
		configurable: true,
		get: () => visibility,
	});
});

beforeEach(() => {
	visibility = 'visible';
	anki.ping.mockReset();
	anki.requestPermission.mockReset();
	document.body.innerHTML = '<div id="overlay" hidden></div>';
	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
});

async function loadOffline() {
	vi.resetModules();
	return import('../extension/app/js/offlineScreen.js');
}

const overlay = () => document.getElementById('overlay');

describe('showOffline', () => {
	it('renders the offline screen with a retry button and a blank tab link', async () => {
		const {showOffline} = await loadOffline();
		showOffline();
		expect(document.title).toBe('AnkiTab');
		expect(overlay().hidden).toBe(false);
		expect(overlay().querySelector('h1').textContent).toBe("Anki isn't running");
		expect(overlay().querySelector('p').textContent).toContain('start anki');
		expect(overlay().querySelector('.offline-retrying').textContent).toContain('retrying');
		const retry = Array.from(overlay().querySelectorAll('button')).find((b) => b.textContent === 'Retry now');
		expect(retry).toBeTruthy();
		const link = overlay().querySelector('a');
		expect(link.textContent).toBe('Open a blank tab');
		expect(link.href).toBe('moz-extension://test/app/index.html?blank=1');
	});

	it('renders the permission screen with a grant button', async () => {
		const {showOffline} = await loadOffline();
		showOffline({permission: true});
		expect(overlay().querySelector('h1').textContent).toBe('Allow access to Anki');
		expect(overlay().querySelector('p').textContent).toContain('needs permission');
		expect(overlay().textContent).not.toContain('retrying');
		const grant = Array.from(overlay().querySelectorAll('button')).find((b) => b.textContent === 'Grant permission');
		expect(grant).toBeTruthy();
		expect(overlay().querySelector('a').href).toBe('moz-extension://test/app/index.html?blank=1');
	});

	it('polls every 3s while the page is visible', async () => {
		anki.ping.mockRejectedValue({type: 'offline'});
		const {showOffline} = await loadOffline();
		showOffline();
		await vi.advanceTimersByTimeAsync(2999);
		expect(anki.ping).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(1);
		expect(anki.ping).toHaveBeenCalledTimes(1);
		await vi.advanceTimersByTimeAsync(3000);
		expect(anki.ping).toHaveBeenCalledTimes(2);
		expect(overlay().hidden).toBe(false);
	});

	it('does not poll while the tab is hidden and polls right away when it becomes visible', async () => {
		anki.ping.mockRejectedValue({type: 'offline'});
		const {showOffline} = await loadOffline();
		visibility = 'hidden';
		showOffline();
		await vi.advanceTimersByTimeAsync(9000);
		expect(anki.ping).not.toHaveBeenCalled();
		visibility = 'visible';
		document.dispatchEvent(new Event('visibilitychange'));
		await vi.advanceTimersByTimeAsync(0);
		expect(anki.ping).toHaveBeenCalledTimes(1);
	});

	it('hides the overlay and calls onRetry once when a poll succeeds', async () => {
		const onRetry = vi.fn();
		anki.ping.mockResolvedValue(undefined);
		const {showOffline} = await loadOffline();
		showOffline({onRetry});
		await vi.advanceTimersByTimeAsync(3000);
		expect(overlay().hidden).toBe(true);
		expect(overlay().children.length).toBe(0);
		expect(anki.ping).toHaveBeenCalledTimes(1);
		await vi.advanceTimersByTimeAsync(6000);
		expect(anki.ping).toHaveBeenCalledTimes(1);
		document.dispatchEvent(new Event('visibilitychange'));
		await vi.advanceTimersByTimeAsync(0);
		expect(anki.ping).toHaveBeenCalledTimes(1);
	});

	it('hides the overlay and retries once when the grant button succeeds', async () => {
		anki.requestPermission.mockResolvedValue(true);
		const onRetry = vi.fn();
		const {showOffline} = await loadOffline();
		showOffline({permission: true, onRetry});
		const grant = overlay().querySelector('button');
		grant.click();
		await vi.advanceTimersByTimeAsync(0);
		expect(anki.requestPermission).toHaveBeenCalledTimes(1);
		expect(overlay().hidden).toBe(true);
		expect(onRetry).toHaveBeenCalledTimes(1);
	});

	it('keeps the grant button usable when the permission is denied', async () => {
		anki.requestPermission.mockResolvedValue(false);
		const onRetry = vi.fn();
		const {showOffline} = await loadOffline();
		showOffline({permission: true, onRetry});
		const grant = overlay().querySelector('button');
		grant.click();
		await vi.advanceTimersByTimeAsync(0);
		expect(overlay().hidden).toBe(false);
		expect(grant.disabled).toBe(false);
		expect(onRetry).not.toHaveBeenCalled();
	});

	it('keeps the grant button usable when requesting throws', async () => {
		anki.requestPermission.mockRejectedValue(new Error('nope'));
		const {showOffline} = await loadOffline();
		showOffline({permission: true});
		const grant = overlay().querySelector('button');
		grant.click();
		await vi.advanceTimersByTimeAsync(0);
		expect(grant.disabled).toBe(false);
		expect(overlay().hidden).toBe(false);
	});

	it('retries from the retry button and hides on success', async () => {
		anki.ping.mockResolvedValue(undefined);
		const onRetry = vi.fn();
		const {showOffline} = await loadOffline();
		showOffline({onRetry});
		overlay().querySelector('button').click();
		await vi.advanceTimersByTimeAsync(0);
		expect(anki.ping).toHaveBeenCalledTimes(1);
		expect(overlay().hidden).toBe(true);
		expect(onRetry).toHaveBeenCalledTimes(1);
	});

	it('stays on the offline screen when the retry button fails', async () => {
		anki.ping.mockRejectedValue({type: 'offline'});
		const {showOffline} = await loadOffline();
		showOffline();
		overlay().querySelector('button').click();
		await vi.advanceTimersByTimeAsync(0);
		expect(overlay().hidden).toBe(false);
	});

	it('does not poll on the permission screen', async () => {
		anki.ping.mockResolvedValue(undefined);
		const {showOffline} = await loadOffline();
		showOffline({permission: true});
		await vi.advanceTimersByTimeAsync(9000);
		expect(anki.ping).not.toHaveBeenCalled();
	});

	it('does nothing when there is no overlay element', async () => {
		document.body.innerHTML = '';
		const {showOffline} = await loadOffline();
		expect(() => showOffline()).not.toThrow();
	});
});

describe('hideOffline', () => {
	it('clears the overlay, stops polling and drops the retry callback', async () => {
		anki.ping.mockRejectedValue({type: 'offline'});
		const {showOffline, hideOffline} = await loadOffline();
		const onRetry = vi.fn();
		showOffline({onRetry});
		hideOffline();
		expect(overlay().hidden).toBe(true);
		expect(overlay().children.length).toBe(0);
		await vi.advanceTimersByTimeAsync(9000);
		expect(anki.ping).not.toHaveBeenCalled();
		showOffline();
		await vi.advanceTimersByTimeAsync(3000);
		expect(onRetry).not.toHaveBeenCalled();
	});

	it('is a no-op without an overlay', async () => {
		document.body.innerHTML = '';
		const {hideOffline} = await loadOffline();
		expect(() => hideOffline()).not.toThrow();
	});
});
