import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { MessageChannel } from 'node:worker_threads';
import { test } from 'node:test';
import { IDBFactory } from 'fake-indexeddb';

const scope = 'https://lws.test/app/';
const scopeUrl = new URL(scope);
const listeners = new Map();
const owner = {
	id: 'owner-client',
	type: 'window',
	url: `${scope}index.html`,
	postMessage(message, ports) {
		queueMicrotask(() => ports[0].postMessage({
			success: true,
			value: { kind: 'generated', text: message.path },
		}));
	},
};

globalThis.indexedDB = new IDBFactory();
globalThis.MessageChannel = MessageChannel;
globalThis.self = {
	addEventListener(type, listener) {
		listeners.set(type, listener);
	},
	clients: {
		claim: async () => {},
		get: async clientId => clientId === owner.id ? owner : null,
	},
	location: { origin: scopeUrl.origin },
	registration: { scope },
	skipWaiting: async () => {},
};

await import('../src/lws-sw.js');

function fetchEvent(url, method = 'GET', headers = undefined) {
	let response;
	let called = false;
	listeners.get('fetch')({
		request: new Request(url, { method, headers }),
		respondWith(value) {
			called = true;
			response = Promise.resolve(value);
		},
	});
	return { get called() { return called; }, response };
}

async function command(action, runId, client = owner, namespace = 'test') {
	const channel = new MessageChannel();
	let lifetime;
	const response = new Promise((resolve, reject) => {
		channel.port2.onmessage = event => {
			channel.port2.close();
			resolve(event.data);
		};
		channel.port2.onmessageerror = reject;
	});
	listeners.get('message')({
		data: { type: 'lws:command', action, runId, namespace },
		ports: [channel.port1],
		source: client,
		waitUntil(promise) {
			lifetime = promise;
		},
	});
	await lifetime;
	return response;
}

test('fetch routing rejects cross-origin and out-of-scope requests', async () => {
	const runId = randomUUID();
	assert.equal(fetchEvent(`https://other.test/app/${runId}/`).called, false);
	assert.equal(fetchEvent(`https://lws.test/application/${runId}/`).called, false);
	assert.equal(fetchEvent(`${scope}readme.txt`).called, false);

	const event = fetchEvent(`${scope}${runId}/`);
	assert.equal(event.called, true);
	assert.equal((await event.response).status, 404);
});

test('put and delete enforce client ownership and retain service sessions on rejection', async () => {
	const runId = randomUUID();
	const attacker = { ...owner, id: 'attacker-client' };

	assert.equal((await command('put', runId)).success, true);
	assert.equal((await command('delete', runId, attacker)).success, false);
	assert.equal((await command('delete', runId, owner, 'other-namespace')).success, false);

	const fetch = fetchEvent(`${scope}${runId}/`);
	const response = await fetch.response;
	assert.equal(response.status, 200);
	assert.equal(await response.text(), 'index.html');

	const head = fetchEvent(`${scope}${runId}/`, 'HEAD');
	const headResponse = await head.response;
	assert.equal(headResponse.status, 200);
	assert.equal(headResponse.headers.get('Content-Length'), '10');
	assert.equal(await headResponse.text(), '');

	const range = fetchEvent(`${scope}${runId}/`, 'GET', { Range: 'bytes=1-3' });
	const rangeResponse = await range.response;
	assert.equal(rangeResponse.status, 206);
	assert.equal(await rangeResponse.text(), 'nde');

	assert.equal((await command('delete', runId)).success, true);
});

test('activate does not remove legacy or unrelated databases', async () => {
	const deletions = [];
	const deleteDatabase = indexedDB.deleteDatabase.bind(indexedDB);
	indexedDB.deleteDatabase = name => {
		deletions.push(name);
		return deleteDatabase(name);
	};
	const pending = [];
	listeners.get('activate')({ waitUntil(promise) { pending.push(promise); } });
	await Promise.all(pending);
	assert.deepEqual(deletions, []);
});
