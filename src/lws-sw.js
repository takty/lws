import { addRun, getRun, removeRun } from './lib/run-idb.js';

/**
 * Local Web Server Service Worker
 */

const COMMAND_TYPE = 'lws:command';
const REQUEST_TYPE = 'lws:request';
const RUN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TIMEOUT = 30_000;

const TYPES = {
	html: 'text/html; charset=utf-8', htm: 'text/html; charset=utf-8',
	js: 'text/javascript; charset=utf-8', mjs: 'text/javascript; charset=utf-8',
	css: 'text/css; charset=utf-8', json: 'application/json; charset=utf-8',
	txt: 'text/plain; charset=utf-8', csv: 'text/csv; charset=utf-8', xml: 'application/xml',
	png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
	svg: 'image/svg+xml', webp: 'image/webp', avif: 'image/avif', ico: 'image/x-icon',
	wav: 'audio/wav', mp3: 'audio/mpeg', ogg: 'audio/ogg', m4a: 'audio/mp4',
	mp4: 'video/mp4', webm: 'video/webm', ogv: 'video/ogg',
	wasm: 'application/wasm', pdf: 'application/pdf',
	woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf',
};

self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));

self.addEventListener('message', event => {
	if (event.data?.type !== COMMAND_TYPE || !event.ports[0]) return;
	const port = event.ports[0];
	event.waitUntil((async () => {
		try {
			const client = event.source;
			const { action, runId, namespace } = event.data;
			validateCommand(client, runId, namespace);
			let value;
			if (action === 'put') {
				const metadata = {
					ownerClientId: client.id,
					namespace,
					scope: self.registration.scope,
				};
				await addRun(runId, metadata);
			} else if (action === 'delete') {
				await removeRun(runId, client.id, namespace, self.registration.scope);
			} else {
				throw new Error('Unknown Local Web Server action');
			}
			port.postMessage({ success: true, value });
		} catch (error) {
			port.postMessage({ success: false, error: error.message });
		} finally {
			port.close();
		}
	})());
});

self.addEventListener('fetch', event => {
	const url = new URL(event.request.url);
	const scopeUrl = new URL(self.registration.scope);
	const scopePath = scopeUrl.pathname.endsWith('/') ? scopeUrl.pathname : `${scopeUrl.pathname}/`;
	if (url.origin !== scopeUrl.origin || !url.pathname.startsWith(scopePath)) return;
	const remainder = url.pathname.slice(scopePath.length);
	const separator = remainder.indexOf('/');
	const runId = separator < 0 ? remainder : remainder.slice(0, separator);
	if (!RUN_ID.test(runId)) return;
	event.respondWith(serveRequest(event.request, runId, separator < 0 ? '' : remainder.slice(separator + 1)));
});

function validateCommand(client, runId, namespace) {
	if (!client || client.type !== 'window' || !client.id || !client.url
		|| new URL(client.url).origin !== self.location.origin) {
		throw new Error('Invalid Local Web Server client');
	}
	if (typeof runId !== 'string' || !RUN_ID.test(runId)) throw new Error('Invalid execution ID');
	if (typeof namespace !== 'string' || !/^[\w.-]{1,64}$/u.test(namespace)) {
		throw new Error('Invalid Local Web Server namespace');
	}
}

function normalizePath(path, allowEmpty = false) {
	if (typeof path !== 'string' || path.includes('\\') || /[\u0000-\u001f\u007f]/u.test(path)) {
		throw new TypeError('Invalid execution file path');
	}
	if (allowEmpty && path === '') return '';
	const parts = path.split('/');
	if (parts.some(part => !part || part === '.' || part === '..')) {
		throw new TypeError('Invalid execution file path');
	}
	return parts.join('/');
}

async function serveRequest(request, runId, encodedPath) {
	if (request.method !== 'GET' && request.method !== 'HEAD') {
		return failure(405, { Allow: 'GET, HEAD' });
	}
	let relative;
	let requestedPaths;
	try {
		const hasTrailingSlash = encodedPath === '' || encodedPath.endsWith('/');
		const encodedParts = hasTrailingSlash ? encodedPath.slice(0, -1) : encodedPath;
		const path = encodedParts === '' ? '' : encodedParts.split('/').map(part => {
			const decoded = decodeURIComponent(part);
			if (decoded.includes('/') || decoded.includes('\\')) throw new TypeError('Invalid execution file path');
			return decoded;
		}).join('/');
		relative = normalizePath(path, true);
		requestedPaths = hasTrailingSlash
			? [`${relative ? `${relative}/` : ''}index.html`, `${relative ? `${relative}/` : ''}index.htm`]
			: [relative];
	} catch {
		return failure(400);
	}
	let metadata;
	try {
		metadata = await getRun(runId);
	} catch (error) {
		console.error('Local Web Server metadata lookup failed:', error);
		return failure(500);
	}
	if (!isValidMetadata(metadata) || metadata.scope !== self.registration.scope) return failure(404);
	try {
		const owner = await self.clients.get(metadata.ownerClientId);
		if (!owner || owner.type !== 'window' || new URL(owner.url).origin !== self.location.origin) {
			await removeRun(runId, metadata.ownerClientId, metadata.namespace, metadata.scope);
			return failure(404);
		}
		let file = null;
		let filename = '';
		for (const path of requestedPaths) {
			let source;
			try {
				source = await requestFile(owner, runId, path);
			} catch (error) {
				if (error.name === 'TimeoutError') {
					await removeRun(runId, metadata.ownerClientId, metadata.namespace, metadata.scope);
					return failure(504);
				}
				throw error;
			}
			if (source === null) {
				await removeRun(runId, metadata.ownerClientId, metadata.namespace, metadata.scope);
				return failure(404);
			}
			if (source.kind === 'not-found') continue;
			if (source.kind === 'generated' && typeof source.text === 'string') {
				file = new Blob([source.text]);
				filename = path.split('/').at(-1) || 'index.html';
			} else if (source.kind === 'source' && isDirectoryHandle(source.directoryHandle)
				&& typeof source.path === 'string') {
				const sourcePath = normalizePath(source.path);
				try {
					file = await getFile(source.directoryHandle, sourcePath);
				} catch (error) {
					if (requestedPaths.length > 1
						&& (error.name === 'NotFoundError' || error.name === 'TypeMismatchError')) continue;
					throw error;
				}
				filename = sourcePath.split('/').at(-1);
			} else {
				return failure(502);
			}
			break;
		}
		if (!file) return failure(404);
		return fileResponse(file, filename, request);
	} catch (error) {
		if (error.name === 'NotFoundError' || error.name === 'TypeMismatchError') return failure(404);
		if (error.name === 'NotAllowedError' || error.name === 'SecurityError') return failure(403);
		if (error.name === 'TimeoutError') return failure(504);
		if (error instanceof TypeError || error instanceof URIError) return failure(400);
		console.error('Local Web Server request failed:', error);
		return failure(500);
	}
}

function isValidMetadata(metadata) {
	return metadata && typeof metadata.ownerClientId === 'string' && metadata.ownerClientId.length > 0
		&& typeof metadata.namespace === 'string' && /^[\w.-]{1,64}$/u.test(metadata.namespace)
		&& typeof metadata.scope === 'string';
}

function isDirectoryHandle(handle) {
	return handle && handle.kind === 'directory' && typeof handle.getDirectoryHandle === 'function';
}

async function requestFile(client, runId, path) {
	return new Promise((resolve, reject) => {
		const channel = new MessageChannel();
		let settled = false;
		const finish = (error, value) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			channel.port1.close();
			channel.port2.close();
			error ? reject(error) : resolve(value);
		};
		const timer = setTimeout(() => {
			const error = new Error('Local Web Server client request timed out');
			error.name = 'TimeoutError';
			finish(error);
		}, TIMEOUT);
		channel.port1.onmessage = event => {
			const reply = event.data;
			if (!reply || typeof reply.success !== 'boolean') {
				finish(new Error('Invalid Local Web Server client response'));
			} else if (!reply.success) {
				finish(new Error(typeof reply.error === 'string' ? reply.error : 'Invalid Local Web Server client response'));
			} else if (reply.value === null || reply.value?.kind === 'not-found') {
				finish(null, reply.value);
			} else if (reply.value?.kind === 'generated' && typeof reply.value.text === 'string') {
				finish(null, reply.value);
			} else if (reply.value?.kind === 'source' && isDirectoryHandle(reply.value.directoryHandle)
				&& typeof reply.value.path === 'string') {
				finish(null, reply.value);
			} else {
				finish(new Error('Invalid Local Web Server client response'));
			}
		};
		channel.port1.onmessageerror = () => finish(new Error('Invalid Local Web Server client response'));
		try {
			client.postMessage({ type: REQUEST_TYPE, runId, path }, [channel.port2]);
		} catch (error) {
			finish(error);
		}
	});
}

async function getFile(root, path) {
	const parts = path.split('/');
	const name = parts.pop();
	let directory = root;
	for (const part of parts) directory = await directory.getDirectoryHandle(part);
	const handle = await directory.getFileHandle(name);
	return handle.getFile();
}

function fileResponse(file, filename, request) {
	const extension = filename.split('.').at(-1).toLowerCase();
	const headers = new Headers({
		'Content-Type': TYPES[extension] ?? (file.type || 'application/octet-stream'),
		'Cache-Control': 'no-store',
		'X-Content-Type-Options': 'nosniff',
		'Accept-Ranges': 'bytes',
		'Content-Length': String(file.size),
	});
	if (request.method === 'HEAD') return new Response(null, { headers });
	const range = request.headers.get('Range');
	if (!range) return new Response(file, { headers });
	const match = /^bytes=(\d*)-(\d*)$/u.exec(range);
	let start = NaN;
	let end = NaN;
	if (match && (match[1] || match[2])) {
		start = match[1] ? Number(match[1]) : Math.max(0, file.size - Number(match[2]));
		end = match[1] && match[2] ? Math.min(Number(match[2]), file.size - 1) : file.size - 1;
	}
	if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)
		|| start > end || start >= file.size || end < 0) {
		headers.set('Content-Range', `bytes */${file.size}`);
		headers.set('Content-Length', '0');
		return new Response(null, { status: 416, headers });
	}
	headers.set('Content-Range', `bytes ${start}-${end}/${file.size}`);
	headers.set('Content-Length', String(end - start + 1));
	return new Response(file.slice(start, end + 1), { status: 206, headers });
}

function failure(status, extraHeaders = {}) {
	const headers = new Headers({
		'Cache-Control': 'no-store',
		'X-Content-Type-Options': 'nosniff',
		...extraHeaders,
	});
	return new Response(null, { status, headers });
}
