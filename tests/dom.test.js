import {describe, it, expect} from 'vitest';
import {el, showOverlay, hideOverlay} from '../extension/libs/dom.js';

describe('el', () => {
	it('creates an element with a class and text', () => {
		const node = el('div', 'stat-line', 'hello');
		expect(node.tagName).toBe('DIV');
		expect(node.className).toBe('stat-line');
		expect(node.textContent).toBe('hello');
	});

	it('leaves the text empty when it is undefined', () => {
		expect(el('span').textContent).toBe('');
	});

	it('does not set a class for an empty one', () => {
		expect(el('span', '').className).toBe('');
		expect(el('span').hasAttribute('class')).toBe(false);
	});
});

describe('showOverlay', () => {
	it('replaces the overlay children and unhides it', () => {
		document.body.innerHTML = '<div id="overlay" hidden><span>old</span></div>';
		showOverlay(el('div', 'new-content'));
		const overlay = document.getElementById('overlay');
		expect(overlay.hidden).toBe(false);
		expect(overlay.children.length).toBe(1);
		expect(overlay.firstElementChild.className).toBe('new-content');
	});

	it('is a no-op without an overlay', () => {
		document.body.innerHTML = '';
		expect(() => showOverlay(el('div'))).not.toThrow();
	});
});

describe('hideOverlay', () => {
	it('hides the overlay and empties it', () => {
		document.body.innerHTML = '<div id="overlay"><span>old</span></div>';
		hideOverlay();
		const overlay = document.getElementById('overlay');
		expect(overlay.hidden).toBe(true);
		expect(overlay.children.length).toBe(0);
	});

	it('is a no-op without an overlay', () => {
		document.body.innerHTML = '';
		expect(() => hideOverlay()).not.toThrow();
	});
});
