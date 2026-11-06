import {describe, it, expect} from 'vitest';
import {searchUrl, resolveFallbackMode} from '../extension/app/js/done/fallback.js';

describe('searchUrl', () => {
	it('replaces %s in a template and encodes the query', () => {
		expect(searchUrl('https://example.com/?q=%s', 'a b&c')).toBe('https://example.com/?q=a%20b%26c');
	});

	it('replaces every %s', () => {
		expect(searchUrl('https://example.com/%s/%s', 'x')).toBe('https://example.com/x/x');
	});

	it('falls back to duckduckgo when the template has no %s', () => {
		expect(searchUrl('https://example.com/?q=', 'hello')).toBe('https://duckduckgo.com/?q=hello');
	});

	it('falls back to duckduckgo for an empty template', () => {
		expect(searchUrl('', 'hello')).toBe('https://duckduckgo.com/?q=hello');
		expect(searchUrl(undefined, 'hi there')).toBe('https://duckduckgo.com/?q=hi%20there');
	});
});

describe('resolveFallbackMode', () => {
	it('keeps a valid mode when top sites are allowed', () => {
		expect(resolveFallbackMode('none', true)).toBe('none');
		expect(resolveFallbackMode('search', true)).toBe('search');
		expect(resolveFallbackMode('topsites', true)).toBe('topsites');
		expect(resolveFallbackMode('both', true)).toBe('both');
	});

	it('treats an unknown mode as search', () => {
		expect(resolveFallbackMode('bogus', true)).toBe('search');
		expect(resolveFallbackMode(undefined, true)).toBe('search');
	});

	it('replaces the top sites modes with search when top sites are not allowed', () => {
		expect(resolveFallbackMode('topsites', false)).toBe('search');
		expect(resolveFallbackMode('both', false)).toBe('search');
	});

	it('leaves modes that do not use top sites alone', () => {
		expect(resolveFallbackMode('none', false)).toBe('none');
		expect(resolveFallbackMode('search', false)).toBe('search');
	});
});
