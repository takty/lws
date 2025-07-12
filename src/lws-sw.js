/**
 * Service Worker for Local Web Server (LWS)
 *
 * @author Takuto Yanagida
 * @version 2025-07-12
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
	console.log(`LWS-SW: Received message: ${evt.data.action}`);
	if (evt.data.action === 'SET_ROOTS') {
		const { path, roots } = evt.data;
		readyPromise = readyPromise
			.then(() => {
				rootMap.set(path, roots);
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
	console.log(`LWS-SW: Fetching request for: ${url.pathname}`);
	await readyPromise;

	for (const [path, roots] of rootMap.entries()) {
		if (url.pathname.startsWith(path)) {
			const pathname = url.pathname.slice(path.length);

			evt.respondWith((async () => {
				for (const root of roots) {
					console.log(`LWS-SW: Checking path: ${path} against request: ${url.pathname}, directory: ${root.name}`);

					const rf = await getRequestedFile(root, pathname);
					if (rf) {
						const [filename, body] = rf;
						return createResponse(body, filename);
					}
				}
				return new Response('LWS-SW: Not found', { status: 404 });
			})());
		}
	}
	// Fallback to the default network behavior for all other requests
});

async function getRequestedFile(root, pathname) {
	const segments  = pathname.split('/').filter(Boolean);
	const filenames = pathname.endsWith('/') ? ['index.html', 'index.htm'] : [segments.pop()];

	for (const filename of filenames) {
		try {
			const dir = await getDirectory(root, segments);
			console.log(`LWS-SW: Serving file: ${filename} from directory: ${dir.name}`);

			// Retrieve the file handle and read its contents
			const fileHandle = await dir.getFileHandle(filename);
			const file       = await fileHandle.getFile();
			const body       = await file.arrayBuffer();

			return [filename, body];
		} catch (err) {
		}
	}
	return null;
}

// Recursive helper for obtaining nested directories within the service worker
async function getDirectory(rootHandle, pathSegments) {
	let dir = rootHandle;
	for (const name of pathSegments) {
		dir = await dir.getDirectoryHandle(name);
	}
	return dir;
}

function createResponse(body, filename) {
	const mime = {
		'css' : 'text/css; charset=utf-8',
		'csv' : 'text/csv; charset=utf-8',
		'doc' : 'application/msword',
		'docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
		'htm' : 'text/html; charset=utf-8',
		'html': 'text/html; charset=utf-8',
		'jpg' : 'image/jpeg',
		'jpeg': 'image/jpeg',
		'js'  : 'text/javascript; charset=utf-8',
		'json': 'application/json; charset=utf-8',
		'mp3' : 'audio/mpeg',
		'mp4' : 'video/mp4',
		'png' : 'image/png',
		'pdf' : 'application/pdf',
		'ppt' : 'application/vnd.ms-powerpoint',
		'pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
		'svg' : 'image/svg+xml',
		'txt' : 'text/plain; charset=utf-8',
		'xls' : 'application/vnd.ms-excel',
		'xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
		'zip' : 'application/zip',
	};
	const ext  = filename.split('.').pop().toLowerCase();
	const type = mime[ext] || 'application/octet-stream';
	return new Response(body, {
		headers: { 'Content-Type': type }
	});
}
