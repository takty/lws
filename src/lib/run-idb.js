/**
 * IndexedDB storage for Local Web Server execution metadata.
 */

const DATABASE_NAME = 'lws-v2';
const STORE_NAME = 'runs';

export async function addRun(runId, metadata) {
	return updateRun('add', runId, metadata);
}

export async function getRun(runId) {
	return updateRun('get', runId);
}

export async function removeRun(runId, ownerClientId, namespace, scope) {
	if (typeof ownerClientId !== 'string' || typeof namespace !== 'string' || typeof scope !== 'string') {
		throw new Error('Invalid execution owner metadata');
	}
	return updateRun('delete', runId, undefined, ownerClientId, namespace, scope);
}

function openDatabase() {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(DATABASE_NAME, 1);
		request.onupgradeneeded = () => {
			if (!request.result.objectStoreNames.contains(STORE_NAME)) {
				request.result.createObjectStore(STORE_NAME);
			}
		};
		request.onsuccess = () => resolve(request.result);
		request.onerror = () => reject(request.error);
		request.onblocked = () => reject(new Error('Local Web Server database is blocked'));
	});
}

async function updateRun(action, runId, metadata, ownerClientId, namespace, scope) {
	const database = await openDatabase();
	try {
		return await new Promise((resolve, reject) => {
			const transaction = database.transaction(STORE_NAME, action === 'get' ? 'readonly' : 'readwrite');
			const store = transaction.objectStore(STORE_NAME);
			let result;
			let operationError;
			const get = store.get(runId);
			get.onsuccess = () => {
				const existing = get.result;
				if (action === 'get') {
					result = existing;
				} else if (action === 'add') {
					if (existing !== undefined) {
						operationError = new Error('Execution ID already exists');
						transaction.abort();
						return;
					}
					store.add(metadata, runId);
				} else if (existing && (existing.ownerClientId !== ownerClientId
					|| existing.namespace !== namespace || existing.scope !== scope)) {
					operationError = new Error('Only the execution owner may remove it');
					transaction.abort();
				} else if (existing) {
					store.delete(runId);
				}
			};
			get.onerror = () => {
				operationError = get.error;
				transaction.abort();
			};
			transaction.oncomplete = () => resolve(result);
			transaction.onabort = () => reject(operationError ?? transaction.error ?? new Error('Database transaction aborted'));
			transaction.onerror = () => reject(operationError ?? transaction.error);
		});
	} finally {
		database.close();
	}
}
