import { register, setRoot, clearRoots } from './lws.js';

document.addEventListener('DOMContentLoaded', () => {
	document.getElementById('select-root').addEventListener('click', async () => {
		const handle = await window.showDirectoryPicker();
		setRoot('/test/static', handle);
	});
	document.getElementById('clear-root').addEventListener('click', () => {
		clearRoots();
	});

	if ('serviceWorker' in navigator) {
		window.addEventListener('load', () => register('static'));
	}
});

// Obtain the root handle of the OPFS
async function getOpfsRoot() {
	return await navigator.storage.getDirectory();
}

// Helper to recursively create or retrieve nested directories
async function getDirectory(rootHandle, pathSegments) {
	let dir = rootHandle;
	for (const name of pathSegments) {
		dir = await dir.getDirectoryHandle(name, { create: true });
	}
	return dir;
}

// Helper to write a single file into the OPFS
async function writeFileAtOpfs(virtualPath, content) {
	// Split the virtualPath into segments, e.g. ['dir1', 'dir2', 'file.html']
	const segments = virtualPath.split('/').filter(Boolean);
	const filename = segments.pop();
	const root = await getOpfsRoot();
	const parentDir = await getDirectory(root, segments);

	// Obtain or create the file handle
	const fileHandle = await parentDir.getFileHandle(filename, { create: true });
	// Open a writable stream and write the content
	const writable = await fileHandle.createWritable();
	await writable.write(content);
	await writable.close();
}
