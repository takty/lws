// sw.js

// Install / Activate
self.addEventListener('install', evt => {
	evt.waitUntil(self.skipWaiting());
});
self.addEventListener('activate', evt => {
	evt.waitUntil(self.clients.claim());
});

// Hook '/static/...' via fetch events
self.addEventListener('fetch', evt => {
	const url = new URL(evt.request.url);
	console.log(`Fetch request for: ${url.pathname}`);

	// Check for the virtual-path prefix
	if (url.pathname.startsWith('/test/static/')) {
		evt.respondWith((async () => {
			try {
				// Obtain the root directory of the OPFS
				const root = await navigator.storage.getDirectory();
				// Convert virtual path '/static/a/b.html' - ['static', 'a', 'b.html']
				const segments = url.pathname.split('/').filter(Boolean);
				// Remove the leading 'static' (which denotes the root directory)
				segments.shift();

				// Treat the last segment as the filename, the rest as subdirectories
				const filename = segments.pop();
				const dir = await getDirectory(root, segments);

				// Retrieve the file handle and read its contents
				const fileHandle = await dir.getFileHandle(filename);
				const file = await fileHandle.getFile();
				const body = await file.arrayBuffer();

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
