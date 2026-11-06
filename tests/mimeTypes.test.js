import {describe, it, expect} from 'vitest';
import MIME from '../extension/app/js/mimeTypes.js';

describe('mimeTypes', () => {
	it('maps common audio, image and video extensions', () => {
		expect(MIME['.mp3']).toBe('audio/mpeg');
		expect(MIME['.png']).toBe('image/png');
		expect(MIME['.mp4']).toBe('video/mp4');
		expect(MIME['.svg']).toBe('image/svg+xml');
	});
});
