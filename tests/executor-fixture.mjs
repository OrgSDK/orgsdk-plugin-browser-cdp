import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";
import { chromium } from "playwright";

export default async function createFixture({ temporary }) {
	const server = createServer((_request, response) => {
		response.setHeader("Content-Type", "text/html");
		response.end(`<!doctype html><title>Headless executor fixture</title>
<h1 id="heading">Synthetic page</h1><label>Value<input id="value"></label>
<select id="color"><option value="red">Red</option><option value="blue">Blue</option></select>
<button onclick="document.querySelector('#result').textContent = document.querySelector('#value').value">Continue</button>
<p id="result">Waiting</p>`);
	});
	await new Promise((done) => server.listen(0, "127.0.0.1", done));
	const origin = `http://127.0.0.1:${server.address().port}`;
	const profile = join(temporary, "browser-profile");
	let context;
	try {
		context = await chromium.launchPersistentContext(profile, {
			headless: true,
			args: ["--remote-debugging-port=0"],
		});
		await context.route("**/*", (route) =>
			new URL(route.request().url()).origin === origin
				? route.continue()
				: route.abort(),
		);
		const [port] = (
			await readFile(join(profile, "DevToolsActivePort"), "utf8")
		).split("\n");
		const endpoint = `http://127.0.0.1:${port}`;
		return {
			provider: "browser-cdp",
			optionalCredential: true,
			secret: { secret_headers: "{}" },
			configuration: { cdpEndpoint: endpoint, actionTimeoutMs: 5_000 },
			allowedOrigins: [origin, endpoint],
			async run(call) {
				assert(Array.isArray(await call("listPages")));
				const page = await call("openPage", { url: origin });
				assert.equal(page.title, "Headless executor fixture");
				const pageId = page.pageId;
				assert.equal(
					(await call("navigate", { pageId, url: `${origin}/second` })).title,
					page.title,
				);
				assert(
					(await call("snapshot", { pageId })).snapshot.includes(
						"Synthetic page",
					),
				);
				assert.equal(
					(await call("readText", { pageId, selector: "#heading" })).text,
					"Synthetic page",
				);
				await call("fill", { pageId, selector: "#value", value: "Example" });
				await call("press", { pageId, selector: "#value", key: "End" });
				assert.deepEqual(
					await call("selectOption", {
						pageId,
						selector: "#color",
						values: ["blue"],
					}),
					["blue"],
				);
				await call("click", { pageId, selector: "button" });
				assert.equal(
					(await call("readText", { pageId, selector: "#result" })).text,
					"Example",
				);
				const screenshot = await call("screenshot", { pageId });
				assert.equal(screenshot.mimeType, "image/png");
				assert(Buffer.from(screenshot.base64, "base64").length > 100);
				assert.equal(
					await call("evaluate", { pageId, expression: "document.title" }),
					page.title,
				);
				await call("closePage", { pageId });
			},
			async close() {
				await context.close();
				await new Promise((done) => server.close(done));
			},
		};
	} catch (error) {
		await context?.close();
		await new Promise((done) => server.close(done));
		throw error;
	}
}
