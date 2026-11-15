/**
 * Local Web Server client
 */

const TIMEOUT = 30_000;
const REQUEST_TYPE = 'lws:request';
const COMMAND_TYPE = 'lws:command';
const RUNS = Symbol.for('lws.runs');
const RUN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function getState() {
	if (!globalThis[RUNS]) {
		globalThis[RUNS] = { runs: new Map(), listening: false };
	}
	const state = globalThis[RUNS];
	if (!state.listening && globalThis.navigator?.serviceWorker) {
		navigator.serviceWorker.addEventListener('message', handleFileRequest);
		state.listening = true;
	}
	return state;
}

function handleFileRequest(event) {
	const message = event.data;
	const port = event.ports?.[0];
	if (message?.type !== REQUEST_TYPE || !port) return;

	const run = getState().runs.get(message.runId);
	const sourceUrl = event.source?.scriptURL;
	if (!run || !run.active) {
		port.postMessage({ success: true, value: null });
		port.close();
		return;
	}
	if (sourceUrl !== run.workerUrl.href) {
		port.postMessage({ success: false, error: 'Execution is no longer available' });
		port.close();
		return;
	}
	try {
		const path = normalizePath(message.path);
		if (run.content.files.has(path)) {
			port.postMessage({
				success: true,
				value: { kind: 'generated', text: run.content.files.get(path) },
			});
		} else if (run.directoryHandle) {
			const source = run.content.sources.get(path)
				?? joinPath(run.content.sourceDirectory, path);
			port.postMessage({
				success: true,
				value: { kind: 'source', directoryHandle: run.directoryHandle, path: source },
			});
		} else {
			port.postMessage({ success: true, value: { kind: 'not-found' } });
		}
	} catch (error) {
		port.postMessage({ success: false, error: error.message });
	} finally {
		port.close();
	}
}

function normalizePath(path, allowEmpty = false) {
	if (typeof path !== 'string' || path.includes('\\') || /[\u0000-\u001f\u007f]/u.test(path)) {
		throw new Error('Invalid execution file path');
	}
	if (allowEmpty && path === '') return '';
	const parts = path.split('/');
	if (parts.some(part => !part || part === '.' || part === '..')) {
		throw new Error('Invalid execution file path');
	}
	return parts.join('/');
}

function normalizeDirectoryPath(path) {
	if (typeof path !== 'string') throw new Error('Invalid source directory path');
	return normalizePath(path.endsWith('/') ? path.slice(0, -1) : path, true);
}

function joinPath(base, relative) {
	return base ? `${base}/${relative}` : relative;
}

function validateContent(content, directoryHandle) {
	if (!(content?.files instanceof Map) || !(content.sources === undefined || content.sources instanceof Map)) {
		throw new Error('Invalid execution content');
	}
	const entryPath = normalizePath(content.entryPath);
	const files = new Map();
	for (const [path, text] of content.files) {
		const normalized = normalizePath(path);
		if (typeof text !== 'string') throw new Error('Execution files must contain text');
		files.set(normalized, text);
	}
	if (!files.has(entryPath)) throw new Error('Execution content has no entry file');

	const sources = new Map();
	for (const [path, source] of content.sources ?? []) {
		sources.set(normalizePath(path), normalizePath(source));
	}
	const sourceDirectory = normalizeDirectoryPath(content.sourceDirectory ?? '');
	if (sources.size && !directoryHandle) throw new Error('Source directory handle is required');
	if (directoryHandle !== null && directoryHandle !== undefined
		&& (directoryHandle.kind !== 'directory' || typeof directoryHandle.getDirectoryHandle !== 'function')) {
		throw new Error('Invalid source directory handle');
	}
	return { files, entryPath, sources, sourceDirectory };
}

function request(worker, message) {
	return new Promise((resolve, reject) => {
		const channel = new MessageChannel();
		const finish = (error, value) => {
			clearTimeout(timer);
			channel.port1.close();
			channel.port2.close();
			error ? reject(error) : resolve(value);
		};
		const timer = setTimeout(() => finish(new Error('Local Web Server request timed out')), TIMEOUT);
		channel.port1.onmessage = event => {
			const reply = event.data;
			if (reply?.success) finish(null, reply.value);
			else finish(new Error(reply?.error ?? 'Local Web Server request failed'));
		};
		channel.port1.onmessageerror = () => finish(new Error('Invalid Local Web Server response'));
		try {
			worker.postMessage(message, [channel.port2]);
		} catch (error) {
			finish(error);
		}
	});
}

async function activatedWorker(registration) {
	let worker = registration.active;
	if (worker?.state === 'activated') return worker;
	worker = registration.installing ?? registration.waiting ?? worker;
	if (!worker) throw new Error('Local Web Server Service Worker is unavailable');
	await new Promise((resolve, reject) => {
		const finish = error => {
			clearTimeout(timer);
			worker.removeEventListener('statechange', changed);
			error ? reject(error) : resolve();
		};
		const changed = () => {
			if (worker.state === 'activated') finish();
			else if (worker.state === 'redundant') finish(new Error('Local Web Server Service Worker installation failed'));
		};
		const timer = setTimeout(() => finish(new Error('Local Web Server activation timed out')), TIMEOUT);
		worker.addEventListener('statechange', changed);
		changed();
	});
	if (registration.active?.state !== 'activated') {
		throw new Error('Local Web Server Service Worker did not activate');
	}
	return registration.active;
}

export class Lws {

	#workerUrl;
	#scope;
	#namespace;
	#registration = null;

	constructor(workerUrl, { scope = './', namespace = 'lws' } = {}) {
		this.#workerUrl = new URL(workerUrl, globalThis.location?.href);
		this.#scope = new URL(scope, this.#workerUrl);
		if (this.#workerUrl.origin !== this.#scope.origin) {
			throw new Error('Service Worker URL and scope must have the same origin');
		}
		if (typeof namespace !== 'string' || !/^[\w.-]{1,64}$/u.test(namespace)) {
			throw new Error('Invalid Local Web Server namespace');
		}
		this.#namespace = namespace;
	}

	/**
	 * Publish generated files and optionally resolve additional files from a directory.
	 * @returns {Promise<{id: string, url: string}>}
	 */
	async publish(content, directoryHandle = null) {
		const state = getState();
		if (!globalThis.navigator?.serviceWorker) throw new Error('Service Workers are unavailable');
		const normalized = validateContent(content, directoryHandle);
		const registration = await this.#getRegistration();
		const id = crypto.randomUUID();
		const run = {
			active: true,
			content: normalized,
			directoryHandle,
			registration,
			workerUrl: this.#workerUrl,
		};
		state.runs.set(id, run);
		try {
			const worker = await activatedWorker(registration);
			const baseUrl = new URL(`${id}/`, registration.scope);
			await request(worker, {
				type: COMMAND_TYPE,
				action: 'put',
				runId: id,
				namespace: this.#namespace,
			});
			const entryParts = normalized.entryPath.split('/');
			const entryName = entryParts.pop();
			const entryUrl = new URL(normalized.entryPath.split('/').map(encodeURIComponent).join('/'), baseUrl);
			const url = entryName === 'index.html' || entryName === 'index.htm'
				? new URL(entryParts.length ? `${entryParts.map(encodeURIComponent).join('/')}/` : '', baseUrl).href
				: entryUrl.href;
			return { id, url };
		} catch (error) {
			run.active = false;
			state.runs.delete(id);
			try {
				const worker = await activatedWorker(registration);
				await request(worker, {
					type: COMMAND_TYPE,
					action: 'delete',
					runId: id,
					namespace: this.#namespace,
				});
			} catch (cleanupError) {
				console.error('Local Web Server cleanup failed:', cleanupError);
			}
			throw error;
		}
	}

	async remove(id) {
		if (typeof id !== 'string' || !RUN_ID.test(id)) throw new Error('Invalid execution ID');
		const state = getState();
		const run = state.runs.get(id);
		if (!run) throw new Error('Execution is not owned by this LWS client');
		if (run.removing) throw new Error('Execution removal is already in progress');
		run.removing = true;
		run.active = false;
		try {
			const worker = await activatedWorker(run.registration);
			await request(worker, {
				type: COMMAND_TYPE,
				action: 'delete',
				runId: id,
				namespace: this.#namespace,
			});
			state.runs.delete(id);
		} catch (error) {
			run.removing = false;
			throw error;
		}
	}

	async #getRegistration() {
		const serviceWorker = globalThis.navigator?.serviceWorker;
		if (!serviceWorker) throw new Error('Service Workers are unavailable');
		if (this.#registration?.active?.state === 'activated') return this.#registration;
		this.#registration = await serviceWorker.register(this.#workerUrl.href, {
			type: 'module',
			scope: this.#scope.href,
		});
		await activatedWorker(this.#registration);
		return this.#registration;
	}

}
