import { defineConfig } from 'vite';

export default defineConfig({
	root: 'src/_docs',
	base: './',
	build: {
		outDir: '../../docs',
		emptyOutDir: true,
		rollupOptions: {
			input: {
				index: 'index.html',
				'lws-sw': 'lws-sw.js',
			},
			output: {
				entryFileNames: chunk => chunk.name === 'lws-sw'
					? 'lws-sw.js'
					: 'assets/[name]-[hash].js',
			},
		},
	},
});
