/**
 * This module provides functions to save and load a map using IndexedDB.
 *
 * @author Takuto Yanagida
 * @version 2025-07-09
 */

/**
 * Open a database and create an object store if it doesn't exist.
 * @param {string} dbName
 * @param {string} storeName
 * @returns {Promise<IDBDatabase>}
 */
function openDatabase(dbName, storeName) {
	return new Promise((resolve, reject) => {
		const req = indexedDB.open(dbName, 1);
		req.onupgradeneeded = () => {
			const db = req.result;
			if (!db.objectStoreNames.contains(storeName)) {
				db.createObjectStore(storeName);
			}
		};
		req.onsuccess = () => resolve(req.result);
		req.onerror   = () => reject(req.error);
	});
}

/**
 * Save a map to an IndexedDB object store.
 * @param {string} dbName
 * @param {string} storeName
 * @param {Map<string, any>} map
 * @returns {Promise<void>}
 */
export async function saveFileMap(dbName, storeName, map) {
	const db = await openDatabase(dbName, storeName);
	return new Promise((resolve, reject) => {
		const tx    = db.transaction(storeName, 'readwrite');
		const store = tx.objectStore(storeName);

		store.clear();
		for (const [key, value] of map.entries()) {
			store.put(value, key);
		}
		tx.oncomplete = () => resolve();
		tx.onerror    = () => reject(tx.error);
	});
}

/**
 * Load a map from an IndexedDB object store.
 * @param {string} dbName
 * @param {string} storeName
 * @returns {Promise<Map<string, any>>}
 */
export async function loadFileMap(dbName, storeName) {
	const db = await openDatabase(dbName, storeName);
	return new Promise((resolve, reject) => {
		const tx        = db.transaction(storeName, 'readonly');
		const store     = tx.objectStore(storeName);
		const cursorReq = store.openCursor();

		const map = new Map();
		cursorReq.onsuccess = () => {
			const cur = cursorReq.result;
			if (!cur) {
				resolve(map);
			} else {
				map.set(cur.key, cur.value);
				cur.continue();
			}
		};
		cursorReq.onerror = () => reject(cursorReq.error);
	});
}
