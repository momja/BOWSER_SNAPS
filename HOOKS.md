# Hooking a local process into new snaps

Bowser Snaps writes files; it doesn't call anyone. If you want a local process — a coding agent, a bug-tracker importer, a Slack notifier — to react the instant a snap is saved, you have to bridge that gap yourself. This page covers the options, roughly in order of "works today, zero extension changes" to "lowest latency, requires forking the extension".

All options hand your process the same document described in [SCHEMA.md](SCHEMA.md); which one to pick is mostly a latency/complexity tradeoff.

## Option 1: Watch the save directory (works today, no extension changes)

The extension always writes into `Downloads/<folder>/` (default `bowser-snaps`, configurable in the popup settings — see [README.md](README.md#use)). Point a filesystem watcher at that directory and react to new files.

```js
// tools/watch-snaps.mjs (sketch — not shipped in this repo)
import chokidar from 'chokidar';
import { readMetadata, METADATA_KEYWORD } from '../sdk/index.js';
import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const dir = path.join(os.homedir(), 'Downloads', 'bowser-snaps'); // match your folder setting

chokidar.watch(dir, { ignoreInitial: true, awaitWriteFinish: true })
  .on('add', async (file) => {
    if (!file.endsWith('.png')) return;
    const bytes = await readFile(file);
    const metadata = JSON.parse(readMetadata(bytes, METADATA_KEYWORD));
    // hand off to your agent here
  });
```

Notes:

- **`awaitWriteFinish`** (or equivalent debouncing) matters — `chrome.downloads.download()` writes the file incrementally, and a naive `fs.watch` callback can fire before the PNG is complete and its `iTXt` chunk is readable.
- **The folder setting is a browser-side preference**, not something a local process can read directly (it lives in the extension's `chrome.storage.local`, inside the browser profile). If a user changes it in the popup, your watcher's config has to be updated to match — there's no notification path for that today.
- **If the `.json` sidecar setting is on**, watch for `*.json` instead of `*.png` — it's the identical document, already flat JSON, no PNG chunk parsing needed. This is the lowest-effort integration.
- **`conflictAction: 'uniquify'`** means a same-second double-capture gets suffixed (`snap-….png`, `snap-…(1).png`) rather than overwritten — don't assume the filename you see is the only one for that timestamp.

This is the only option that requires *no* extension changes, at the cost of filesystem-poll latency (typically low, but not instant) and the config-drift issue above.

## Option 2: Native messaging (push, requires extension changes)

For push delivery with no filesystem watching at all, Chrome's [Native Messaging](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging) lets an extension talk to a local process directly over stdin/stdout. This isn't implemented in this repo — sketch of what it would take:

1. Add `"nativeMessaging"` to `permissions` in `extension/manifest.json`.
2. Register a native messaging host: a small JSON manifest (naming your host and the path to an executable) installed into a Chrome-specific OS directory (e.g. `~/.config/google-chrome/NativeMessagingHosts/` on Linux), plus the host process itself (any executable that speaks the length-prefixed JSON protocol on stdin/stdout).
3. In `extension/background.js`'s `finalizeCapture` (`extension/background.js:123`), after the metadata object is built but before/alongside the `chrome.downloads.download()` call, do:
   ```js
   const port = chrome.runtime.connectNative('com.yourname.bowsersnaps_agent');
   port.postMessage({ metadata, pngBase64: toBase64(stamped) });
   ```

This fires the moment the snap is finalized — no disk polling, no config-drift with the folder setting (the payload goes straight to your process). Tradeoff: the OS-level host registration is a real install step for whoever runs this, and it only works for a native binary/script you control, not a remote endpoint.

## Option 3: Local HTTP server (push, requires extension changes)

Simpler to set up than native messaging if your agent already speaks HTTP:

1. Add `"host_permissions": ["http://127.0.0.1/*"]` (or a specific port) to `extension/manifest.json`.
2. In `finalizeCapture`, `fetch()` the metadata to your local server:
   ```js
   fetch('http://127.0.0.1:PORT/snap', {
     method: 'POST',
     headers: { 'content-type': 'application/json' },
     body: metadataJson
   }).catch(() => {}); // best-effort — don't fail the capture if the agent is down
   ```
3. Run a small local server (e.g. wrapping a coding agent's headless/`-p` mode) listening on that port.

Tradeoffs versus native messaging: no OS registration step, but you're opening a loopback port that *any* local process (or, if misconfigured to bind beyond loopback, anything on the network) can reach. Bind to `127.0.0.1` explicitly, and check a shared-secret header or token so a random localhost request can't spoof a capture event or read back history if you add a GET endpoint.

## Security notes (all options)

The metadata your hook receives is the same as what's embedded in the PNG: URL, DOM snippet, console errors, on-screen text, the user's bug description. Anything with access to that stream has effectively the same visibility as someone reading the screenshots — treat the watcher process, the native host, and the local server with the same care you'd give the `Downloads/bowser-snaps/` folder itself.
