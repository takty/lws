/**
 * Local Web Server (LWS)
 * A simple local web server implemented using Service Worker.
 *
 * @author Takuto Yanagida
 * @version 2025-07-08
 */

export function register(scope = './') {
	navigator.serviceWorker.register('lws-sw.js', { type: 'module', scope })
		.then(reg => console.log('LWS: SW registered:', reg.scope))
		.catch(err => console.error('LWS: SW registration failed:', err));
}

export async function setRoot(path, handle) {
	const reg = await navigator.serviceWorker.ready;
	reg.active.postMessage(
		{ action: 'STORE_ROOT', path, handle }
	);
	console.log(`LWS: Stored ${path} to SW`);
}

export async function clearRoots() {
	const reg = await navigator.serviceWorker.ready;
	reg.active.postMessage(
		{ action: 'CLEAR_ROOTS' }
	);
	console.log('LWS: Cleared root directory in SW');
}
