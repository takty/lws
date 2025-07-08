/**
 * Service Worker for Local Web Server (LWS)
 *
 * @author Takuto Yanagida
 * @version 2025-07-08
 */

import { saveFileMap, loadFileMap } from './lib/map-idb.js';

const DB_NAME    = 'lws-db';
const STORE_NAME = 'root-map';

let rootMap      = new Map();
let readyPromise = Promise.resolve();

self.addEventListener('install', evt => {
	evt.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', async evt => {
	readyPromise = loadFileMap(DB_NAME, STORE_NAME).then(map => {
		rootMap = map;
	});
	evt.waitUntil(readyPromise);
});

self.addEventListener('message', async evt => {
	if (evt.data.action === 'STORE_ROOT') {
		const { path, handle } = evt.data;
		readyPromise = readyPromise
			.then(() => {
				rootMap.set(path, handle);
				return saveFileMap(DB_NAME, STORE_NAME, rootMap);
			})
			.then(() => { return; });
		evt.waitUntil(readyPromise);
	}
	if (evt.data.action === 'CLEAR_ROOTS') {
		readyPromise = readyPromise
			.then(() => {
				rootMap.clear();
				return saveFileMap(DB_NAME, STORE_NAME, rootMap);
			})
			.then(() => { return; });
		evt.waitUntil(readyPromise);
	}
});

self.addEventListener('fetch', async evt => {
	const url = new URL(evt.request.url);
	console.log(`Fetch request for: ${url.pathname}`);

	await readyPromise;
	console.log(`File map size: ${rootMap.size}`);

	for (const [path, root] of rootMap.entries()) {
		console.log(`Checking path: ${path} against request: ${url.pathname}, directory: ${root.name}`);

		// Check for the virtual-path prefix
		if (url.pathname.startsWith(path)) {
			evt.respondWith((async () => {

				const pathname = url.pathname.slice(path.length);
				console.log(pathname);

				try {
					// // Obtain the root directory of the OPFS
					// const root = await navigator.storage.getDirectory();

					// Convert virtual path '/static/a/b.html' - ['static', 'a', 'b.html']
					const segments = pathname.split('/').filter(Boolean);
					// Remove the leading 'static' (which denotes the root directory)
					// segments.shift();

					// Treat the last segment as the filename, the rest as subdirectories
					const filename = segments.pop();
					const dir = await getDirectory(root, segments);
					console.log(`Serving file: ${filename} from directory: ${dir.name}`);

					// Retrieve the file handle and read its contents
					const fileHandle = await dir.getFileHandle(filename);
					const file       = await fileHandle.getFile();
					const body       = await file.arrayBuffer();

					// Determine Content-Type based on file extension
					const ext = filename.split('.').pop().toLowerCase();
					const mimeMap = {
						'html': 'text/html; charset=utf-8',
						'js'  : 'application/javascript; charset=utf-8',
						'css' : 'text/css; charset=utf-8',
						// Add additional mappings as needed
					};
					const contentType = mimeMap[ext] || 'application/octet-stream';

					return new Response(body, {
						headers: { 'Content-Type': contentType }
					});
				} catch (err) {
					// Return 404 for non-existent files, etc.
					return new Response('Not found', { status: 404 });
				}
			})());
		}
	}
	// return new Response('Not found', { status: 404 });

	// Fallback to the default network behavior for all other requests
});

// Recursive helper for obtaining nested directories within the service worker
async function getDirectory(rootHandle, pathSegments) {
	let dir = rootHandle;
	for (const name of pathSegments) {
		dir = await dir.getDirectoryHandle(name);
	}
	return dir;
}

