/**
 * Local Web Server (LWS)
 * A simple local web server implemented using Service Worker.
 *
 * @author Takuto Yanagida
 * @version 2025-07-09
 */

export function register(scope = './') {
	navigator.serviceWorker.register('lws-sw.js', { type: 'module', scope })
		.then(reg => console.log('LWS: SW registered:', reg.scope))
		.catch(err => console.error('LWS: SW registration failed:', err));
}

export async function setRoots(path, roots) {
	const reg = await navigator.serviceWorker.ready;
	reg.active.postMessage(
		{ action: 'SET_ROOTS', path, roots }
	);
	console.log('LWS: Set root directories to SW');
}

export async function clearRoots() {
	const reg = await navigator.serviceWorker.ready;
	reg.active.postMessage(
		{ action: 'CLEAR_ROOTS' }
	);
	console.log('LWS: Cleared root directories in SW');
}
