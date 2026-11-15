import { Lws } from '../lws.js';

document.addEventListener('DOMContentLoaded', () => {
	const worker = new URL('./lws-sw.js', document.baseURI);
	const lws = new Lws(worker, {
		scope: new URL('./', worker),
	});
	const link = document.querySelector('a[target="_blank"]');
	let runId = null;

	link.removeAttribute('href');
	document.getElementById('select-root').addEventListener('click', async () => {
		try {
			const handle = await window.showDirectoryPicker();
			const published = await lws.publish({
				files: new Map([['index.html', '<!DOCTYPE html><html><body><h1>Local Web Server</h1><p><a href="README.md">Open README.md from the selected directory</a></p></body></html>']]),
				entryPath: 'index.html',
				sources: new Map(),
				sourceDirectory: '',
			}, handle);
			const previousRunId = runId;
			runId = published.id;
			link.href = published.url;
			if (previousRunId) await lws.remove(previousRunId);
		} catch (error) {
			console.error('Local Web Server publish failed:', error);
			alert(error.message);
		}
	});

	document.getElementById('clear-root').addEventListener('click', async () => {
		if (!runId) return;
		const id = runId;
		runId = null;
		link.removeAttribute('href');
		try {
			await lws.remove(id);
		} catch (error) {
			console.error('Local Web Server remove failed:', error);
			alert(error.message);
		}
	});
});
