import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { IDBFactory } from 'fake-indexeddb';

globalThis.indexedDB = new IDBFactory();

const { addRun, getRun, removeRun } = await import('../src/lib/run-idb.js');

const metadata = {
	ownerClientId: 'owner-client',
	namespace: 'test',
	scope: 'https://lws.test/app/',
};

test('removeRun requires matching owner, namespace, and scope', async () => {
	const runId = randomUUID();
	await addRun(runId, metadata);

	await assert.rejects(removeRun(runId, 'other-client', metadata.namespace, metadata.scope), /owner/u);
	await assert.rejects(removeRun(runId, metadata.ownerClientId, 'other', metadata.scope), /owner/u);
	await assert.rejects(removeRun(runId, metadata.ownerClientId, metadata.namespace, 'https://lws.test/other/'), /owner/u);
	assert.deepEqual(await getRun(runId), metadata);

	await removeRun(runId, metadata.ownerClientId, metadata.namespace, metadata.scope);
	assert.equal(await getRun(runId), undefined);
});

test('addRun rejects duplicate IDs without replacing metadata', async () => {
	const runId = randomUUID();
	await addRun(runId, metadata);
	await assert.rejects(addRun(runId, { ...metadata, ownerClientId: 'attacker' }), /already exists/u);
	assert.deepEqual(await getRun(runId), metadata);
	await removeRun(runId, metadata.ownerClientId, metadata.namespace, metadata.scope);
});
