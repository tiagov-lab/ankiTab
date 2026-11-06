import {defineConfig} from 'vitest/config';

export default defineConfig({
	test: {
		environment: 'jsdom',
		include: ['tests/**/*.test.js'],
		setupFiles: ['tests/setup/chrome.js'],
		restoreMocks: true,
		coverage: {
			include: ['extension/**/*.js'],
			exclude: [
				'extension/libs/MathJax.js',
				'extension/libs/tether.js',
				'extension/libs/config/**',
				'extension/libs/extensions/**',
				'extension/libs/jax/**',
			],
			reporter: ['text-summary', 'text'],
		},
	},
});
