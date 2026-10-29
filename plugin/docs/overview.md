# OrgSDK Browser CDP

A project-owned external OrgSDK plugin for controlling an existing Chromium
browser through Playwright's Chrome DevTools Protocol connection. Works with
self-hosted [Steel Browser](https://github.com/steel-dev/steel-browser), Steel
Cloud, and Chrome's remote debugging endpoint. Slug: `browser-cdp`; OrgSDK
namespace: `browserCdp`.

The executor only needs this plugin's JavaScript. `playwright-core` is embedded
in the release; no Chromium installation or Steel SDK is needed on the executor.

## Configure

Self-hosted Steel (its **CDP WebSocket is on the API port 3000**, not the optional
console debugger port 9223):

```json
{
	"cdpEndpoint": "ws://steel:3000",
	"authMode": "none"
}
```

Use the hostname reachable **from the executor**. `localhost` inside a Docker
job refers to that container. Steel must already be running and its browser
session must remain alive between calls.

For Chrome configured with remote debugging, use `http://chrome:9222` or its
full `ws://.../devtools/browser/...` URL. Both HTTP(S) discovery and WS(S)
connections are supported.

For an existing Steel Cloud session:

```json
{
	"cdpEndpoint": "wss://connect.steel.dev",
	"authMode": "steel",
	"sessionId": "YOUR_EXISTING_SESSION_ID",
	"connectTimeoutMs": 15000,
	"actionTimeoutMs": 10000
}
```

Attach an OrgSDK credential with provider `browser-cdp` and secret data:

```json
{ "secret_apiKey": "YOUR_STEEL_API_KEY" }
```

`authMode: "steel"` adds the key as the `apiKey` URL parameter, and `sessionId`
adds or replaces the session parameter. An existing session ID is required in Steel mode to prevent a fresh cloud
session on every call. Session creation, renewal and release are managed
through Steel itself. This plugin does not invoke Steel's REST API.

For an authenticated CDP proxy, `authMode: "bearer"` sends `secret_apiKey` as
`Authorization: Bearer ...`. Additional connection headers can be supplied as
JSON in the encrypted credential's `secret_headers` string:

```json
{ "secret_headers": "{\"X-Browser-Token\":\"YOUR_TOKEN\"}" }
```

Headers also work with `authMode: "none"`. Keep keys and auth headers in the
credential, not the plain configuration URL. No credential is needed for an
unauthenticated self-hosted endpoint. Credentials are injected by OrgSDK at call
time; the plugin does not read environment tokens or write credential stores.

## Use from OrgSDK

```typescript
const tab = await browserCdp.openPage({ url: "https://example.com" });
console.log(await browserCdp.snapshot({ pageId: tab.pageId }));
console.log(await browserCdp.readText({ pageId: tab.pageId }));
const image = await browserCdp.screenshot({ pageId: tab.pageId });
// image = { mimeType: "image/png", base64: "..." }
await browserCdp.closePage({ pageId: tab.pageId });
```

```typescript
const tabs = await browserCdp.listPages({});
const pageId = tabs[0].pageId;
await browserCdp.fill({
	pageId,
	selector: "#email",
	value: "test@example.com",
});
await browserCdp.click({ pageId, selector: 'role=button[name="Continue"]' });
console.log(await browserCdp.readText({ pageId, selector: "main" }));
```

| Tool           | Purpose                                                       |
| -------------- | ------------------------------------------------------------- |
| `listPages`    | List default-context tabs with stable `pageId`, URL and title |
| `openPage`     | Create a tab, optionally navigate to an HTTP(S) URL           |
| `navigate`     | Navigate a tab and return URL, title and HTTP status          |
| `snapshot`     | Read an accessibility tree, optionally scoped to a selector   |
| `readText`     | Read visible text, optionally scoped to a selector            |
| `click`        | Click a matching element                                      |
| `fill`         | Replace an input or textarea value                            |
| `press`        | Send a key or shortcut to a matching element                  |
| `selectOption` | Select one or more values in a select element                 |
| `screenshot`   | Return a PNG as base64; `fullPage` defaults to false          |
| `evaluate`     | Evaluate page JavaScript and return a serializable result     |
| `closePage`    | Close the explicitly selected tab                             |

Tools accept named argument objects. Locators use Playwright selector syntax;
accessibility snapshots describe controls but do not assign reusable element
references. Text/snapshot output defaults to 20,000 characters, with a
`truncated` flag and optional `maxChars` up to 200,000. Navigation defaults to
`domcontentloaded`; `waitUntil` also supports `commit` and `load`.

Each call makes a fresh connection, uses the existing default context (including
its cookies), and disconnects in `finally`. It never creates/closes a context,
launches a browser or releases a Steel session. Stable CDP target IDs survive
plugin/executor process restarts while the remote tab lives. An expired session
or closed tab requires `listPages` or `openPage` again. If initial navigation
fails, `openPage` closes the tab it just created. Other failures leave existing
tabs in place. There is no automatic retry of mutating operations.

Connection timeout defaults to 15 seconds and the total operation budget to 10
seconds; both are configurable up to 120 seconds. Timed-out operations disconnect
but cannot undo a click, form submission or page JavaScript already sent to the
browser. An evaluation that never settles is bounded by the operation budget.
Connection errors omit remote URLs and headers to avoid disclosing credentials.

This is a trusted browser automation plugin: it can use the remote session's
cookies and network access, submit forms, execute page JavaScript, and close
tabs. Assign a dedicated browser/session to each OrgSDK project. Sharing one
endpoint shares its default-context tabs and cookies, and concurrent actions on
the same tab may conflict. CDP supports Chromium only and has lower fidelity
than Playwright's native protocol; browser/server compatibility still matters.

## Develop and verify

Requires Bun 1.4, GNU tar for source packaging, and independently installed
dependencies. The package command normalizes archive timestamps, ownership and
permissions so repeated source builds have the same checksum:

```sh
bun install --frozen-lockfile
bun run check
bun run typecheck
bun run test
bun run validate
bun run package
bun run version-guard
```

`bun run test:integration` starts an isolated Chromium through `playwright-cli`,
serves a local fixture, exercises all tools over real HTTP and WebSocket CDP,
and closes only its test browser. It requires `playwright-cli` on PATH and the
Chromium matching Playwright 1.60.0. Install it into an isolated cache with
`PLAYWRIGHT_BROWSERS_PATH="$PWD/.browsers" bunx playwright-core install chromium`,
and use the same `PLAYWRIGHT_BROWSERS_PATH` for the test command.
No personal browser profile or OrgSDK installation is used. A screenshot is
saved to `.artifacts/integration.png`.

## Build an executable OrgSDK release

The authoring SDK's `bun run package` produces a source artifact. The local
OrgSDK executor requires its self-contained ESM adapter instead:

```sh
orgsdk-executor package-plugin \
  --directory "$PWD" --output "$PWD/release" \
  --embed-dependencies playwright-core --license "$PWD/LICENSE"
```

Or use the platform checkout's `runtime/src/cli.ts` with Bun. Embedding
`playwright-core` preserves its package-relative assets. The release contains
`browser-cdp.mjs`, digest-pinned manifest and catalog JSON, and third-party
notices. Its `package_url` is blank for local installation.

Preinstall into the selected project's executor:

```sh
orgsdk-executor install --agent PROJECT_ID \
  --manifest release/browser-cdp.manifest.json \
  --file release/browser-cdp.mjs --data /path/to/executor-data
```

For project installation, the current platform requires a non-empty HTTPS
`package_url` even when the bundle is preinstalled (its create/update handlers
currently reject the blank local-only URL). Host the versioned bundle at an
operator-controlled HTTPS URL, set that URL in the catalog entry, and add the
entry to the operator's `PLUGIN_CATALOG_PATH`. Then install it in the same
OrgSDK project and supply the connection configuration above. The emitted
SHA256 must remain unchanged; a source tarball is not an executable release.
When combining with an existing local catalog, retain its other entries. A local
preinstall alone does not grant the project permission to use the plugin.

To test an executable bundle instead of source, set
`BROWSER_PLUGIN_ENTRY=/absolute/path/to/release/browser-cdp.mjs` when running
`bun run test:integration`. Also set `ORGSDK_RUNTIME_DIR=/path/to/OrgSDK/runtime`
to install the bundle into temporary executor storage and exercise every tool
through the real OrgSDK loader and `browserCdp` sandbox namespace.

Source artifacts and executable releases stay local;
this repository has no automatic publish or deployment workflow.

Private proprietary source; see `LICENSE`. Playwright is Apache-2.0 and Zod is
MIT; the executor packaging command includes their installed license notices.
