# LWS

LWS serves generated text files and files from a `FileSystemDirectoryHandle` through a Service Worker. The client keeps the content and directory handle in page memory; the Service Worker stores only execution metadata in IndexedDB. Keep the page that called `publish()` open while the published URL is in use.

```js
import { Lws } from './src/lws.js';

const lws = new Lws(new URL('./src/lws-sw.js', import.meta.url), {
	scope: new URL('./src/', import.meta.url),
});

const directoryHandle = await window.showDirectoryPicker();
const { id, url } = await lws.publish({
	files: new Map([['index.html', '<h1>Hello</h1>']]),
	entryPath: 'index.html',
	sources: new Map(),
	sourceDirectory: '',
}, directoryHandle);

// Use url, then stop serving this execution with:
await lws.remove(id);
```

`files` maps published paths to generated text. `sources` optionally maps published paths to paths under `directoryHandle`; other ungenerated paths resolve relative to `sourceDirectory`. Paths are relative to the selected directory and cannot contain `.` or `..` segments.

This is not an isolation boundary against other JavaScript running on the same origin. The owner client must remain open and responsive; requests fail if it closes, loses the in-memory execution, or cannot answer within the timeout.

LWS does not automatically delete storage from older versions. A one-time application migration may remove only the known legacy names (`lws-db`, `${namespace}-v1`, and Cache Storage entries prefixed with `${namespace}-v1:${scope}`); do not remove the current `lws-v2` database or broadly clear origin storage.

## Development and distribution

```sh
yarn dev    # Serve src/_docs with Vite
yarn docs   # Build the documentation site into docs/
yarn build  # Bundle the client and Service Worker into dist/
yarn test   # Run client, Service Worker, and IndexedDB regression tests
```

The distribution build emits `lws.min.js` and `lws-sw.min.js` with source maps. The Service Worker bundle includes its IndexedDB helper.
