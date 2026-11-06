import {describe, it, expect} from 'vitest';
import {isRemoteUrl, mediaFilename} from '../extension/libs/url.js';

describe('isRemoteUrl', () => {
	it('accepts absolute urls with a scheme', () => {
		expect(isRemoteUrl('https://example.com/a.png')).toBe(true);
		expect(isRemoteUrl('http://example.com/a.png')).toBe(true);
		expect(isRemoteUrl('data:image/png;base64,AA')).toBe(true);
		expect(isRemoteUrl('mailto:x@example.com')).toBe(true);
		expect(isRemoteUrl('chrome-extension://abc/a.png')).toBe(true);
	});

	it('accepts protocol-relative urls', () => {
		expect(isRemoteUrl('//cdn.example.com/a.png')).toBe(true);
	});

	it('rejects media folder filenames', () => {
		expect(isRemoteUrl('x.png')).toBe(false);
		expect(isRemoteUrl('my%20file.png?v=2')).toBe(false);
		expect(isRemoteUrl('_yumin.ttf')).toBe(false);
	});

	it('is case insensitive', () => {
		expect(isRemoteUrl('HTTPS://example.com/a.png')).toBe(true);
	});
});

describe('mediaFilename', () => {
	it('decodes url encoding', () => {
		expect(mediaFilename('my%20file.png')).toBe('my file.png');
	});

	it('strips a query string', () => {
		expect(mediaFilename('image.png?v=2')).toBe('image.png');
	});

	it('strips a fragment', () => {
		expect(mediaFilename('image.png#part')).toBe('image.png');
	});

	it('strips query and fragment together', () => {
		expect(mediaFilename('my%20file.png?v=2#frag')).toBe('my file.png');
	});

	it('leaves a plain filename alone', () => {
		expect(mediaFilename('_mc.js')).toBe('_mc.js');
	});
});
