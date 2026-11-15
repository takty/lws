import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { MessageChannel } from 'node:worker_threads';

import { Lws } from '../src/lws.js';

class MockWorker {

	constructor(scriptURL, scope) {
		this.scriptURL = scriptURL;
		this.scope = scope;
		this.state = 'activated';
		this.sessions = new Set();
		this.messages = [];
		this.failNextDelete = false;
		this.deferNextDelete = false;
		this.pendingDelete = null;
	}

	postMessage(message, ports) {
		this.messages.push(message);
		const port = ports[0];
		const reply = { success: true };
		if (message.action === 'put') {
			this.sessions.add(message.runId);
		} else if (message.action === 'delete' && this.failNextDelete) {
			this.failNextDelete = false;
			reply.success = false;
			reply.error = 'simulated delete failure';
		} else if (message.action === 'delete' && this.deferNextDelete) {
			this.deferNextDelete = false;
			this.pendingDelete = () => {
				this.sessions.delete(message.runId);
				port.postMessage(reply);
			};
			return;
		} else if (message.action === 'delete') {
			this.sessions.delete(message.runId);
		}
		queueMicrotask(() => port.postMessage(reply));
	}

}

class MockServiceWorkerContainer extends EventTarget {

	registrations = new Map();
	listenerRegistrations = 0;

	addEventListener(type, listener, options) {
		if (type === 'message') this.listenerRegistrations++;
		return super.addEventListener(type, listener, options);
	}

	async register(scriptURL, { scope }) {
		const key = `${scriptURL}|${scope}`;
		if (!this.registrations.has(key)) {
			const worker = new MockWorker(scriptURL, scope);
			this.registrations.set(key, { active: worker, scope });
		}
		return this.registrations.get(key);
	}

}

const serviceWorker = new MockServiceWorkerContainer();
const navigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');

before(() => {
	globalThis.MessageChannel = MessageChannel;
	Object.defineProperty(globalThis, 'navigator', {
		configurable: true,
		value: { serviceWorker },
	});
});

after(() => {
	if (navigatorDescriptor) Object.defineProperty(globalThis, 'navigator', navigatorDescriptor);
	else delete globalThis.navigator;
});

function createLws(namespace = 'test') {
	const workerUrl = new URL('https://lws.test/app/lws-sw.js');
	const scope = new URL('https://lws.test/app/');
	return { lws: new Lws(workerUrl, { scope, namespace }), workerUrl, scope };
}

function requestFile(runId, path, sourceUrl) {
	const channel = new MessageChannel();
	const response = new Promise((resolve, reject) => {
		channel.port2.onmessage = event => {
			channel.port2.close();
			resolve(event.data);
		};
		channel.port2.onmessageerror = reject;
	});
	const event = new Event('message');
	Object.defineProperties(event, {
		data: { value: { type: 'lws:request', runId, path } },
		ports: { value: [channel.port1] },
		source: { value: { scriptURL: sourceUrl } },
	});
	serviceWorker.dispatchEvent(event);
	return response;
}

const content = {
	files: new Map([['index.html', '<h1>owned</h1>']]),
	entryPath: 'index.html',
};

test('module state is private, sessions belong to their Lws instance, and runs remain independent', async () => {
	const first = createLws();
	const second = createLws();
	const published = await first.lws.publish(content);
	const independent = await first.lws.publish({
		files: new Map([['index.html', '<h1>independent</h1>']]),
		entryPath: 'index.html',
	});
	const registration = await navigator.serviceWorker.register(first.workerUrl.href, {
		scope: first.scope.href,
	});

	assert.equal(Symbol.for('lws.runs') in globalThis, false);
	assert.equal(serviceWorker.listenerRegistrations, 1);
	await assert.rejects(second.lws.remove(published.id), /different LWS instance/u);
	assert.equal(registration.active.sessions.has(published.id), true);

	const reply = await requestFile(published.id, 'index.html', first.workerUrl.href);
	assert.deepEqual(reply, { success: true, value: { kind: 'generated', text: '<h1>owned</h1>' } });
	const wrongWorker = await requestFile(published.id, 'index.html', 'https://lws.test/other-sw.js');
	assert.equal(wrongWorker.success, false);

	await first.lws.remove(published.id);
	assert.equal(registration.active.sessions.has(published.id), false);
	assert.deepEqual(await requestFile(independent.id, 'index.html', first.workerUrl.href), {
		success: true,
		value: { kind: 'generated', text: '<h1>independent</h1>' },
	});
	await first.lws.remove(independent.id);
});

test('failed remove stops delivery and allows a retry', async () => {
	const { lws, workerUrl, scope } = createLws('retry');
	const published = await lws.publish(content);
	const registration = await navigator.serviceWorker.register(workerUrl.href, { scope: scope.href });
	registration.active.failNextDelete = true;

	await assert.rejects(lws.remove(published.id), /simulated delete failure/u);
	assert.deepEqual(await requestFile(published.id, 'index.html', workerUrl.href), {
		success: true,
		value: null,
	});
	assert.equal(registration.active.sessions.has(published.id), true);

	await lws.remove(published.id);
	assert.equal(registration.active.sessions.has(published.id), false);
});

test('concurrent remove calls do not corrupt session state', async () => {
	const { lws, workerUrl, scope } = createLws('concurrent');
	const published = await lws.publish(content);
	const registration = await navigator.serviceWorker.register(workerUrl.href, { scope: scope.href });
	registration.active.deferNextDelete = true;

	const firstRemove = lws.remove(published.id);
	await new Promise(resolve => setImmediate(resolve));
	assert.equal(typeof registration.active.pendingDelete, 'function');
	await assert.rejects(lws.remove(published.id), /already in progress/u);
	registration.active.pendingDelete();
	await firstRemove;
	assert.equal(registration.active.sessions.has(published.id), false);
});
