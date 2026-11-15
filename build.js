import { build } from 'esbuild';

await build({
	entryPoints: [
		{ in: 'src/lws.js', out: 'lws' },
		{ in: 'src/lws-sw.js', out: 'lws-sw' },
	],
	outdir: 'dist',
	outExtension: { '.js': '.min.js' },
	minify: true,
	sourcemap: true,
	bundle: true,
	format: 'esm',
});
