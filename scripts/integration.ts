import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright-core";
import { z } from "zod";
import { testContext } from "../tests/context";
import { runtimeTools } from "./runtime-tools";

const root = await mkdtemp(join(tmpdir(), "orgsdk-browser-cdp-test-"));
const previousDataDir = process.env.EXECUTOR_DATA_DIR;
const previousAgentDir = process.env.EXECUTOR_AGENT_DIR;
process.env.EXECUTOR_DATA_DIR = join(root, "executor");
delete process.env.EXECUTOR_AGENT_DIR;
const sessionName = `orgsdk-cdp-${crypto.randomUUID().slice(0, 8)}`;
const fixture = Bun.serve({
	hostname: "127.0.0.1",
	port: 0,
	fetch: async (request) => {
		if (new URL(request.url).pathname === "/slow") {
			await Bun.sleep(1_000);
		}
		return new Response(
			`<!doctype html><title>CDP fixture</title>
    <main><h1>Remote browser fixture</h1><label>Email<input id="email"></label>
    <select id="color"><option value="red">Red</option><option value="blue">Blue</option></select>
    <button onclick="document.querySelector('#result').textContent = document.querySelector('#email').value">Continue</button>
    <p id="result">Waiting</p><p hidden>Hidden text</p></main>`,
			{ headers: { "Content-Type": "text/html" } },
		);
	},
});
const addressServer = createServer();
await new Promise<void>((done) => addressServer.listen(0, "127.0.0.1", done));
const address = addressServer.address();
assert(address && typeof address === "object");
const cdpPort = address.port;
await new Promise<void>((done) => addressServer.close(() => done()));
const endpoint = `http://127.0.0.1:${cdpPort}`;
const configuration = { cdpEndpoint: endpoint, actionTimeoutMs: 5_000 };
const pageSchema = z.object({
	pageId: z.string(),
	title: z.string(),
	url: z.string(),
});
const moduleSchema = z.object({
	safeFunctions: z.array(
		z.object({
			name: z.string(),
			handler: z.custom<
				(credentials: unknown, input: unknown) => Promise<unknown>
			>((value) => typeof value === "function"),
		}),
	),
});

async function cli(...args: string[]) {
	const process = Bun.spawn(["playwright-cli", `-s=${sessionName}`, ...args], {
		cwd: root,
		stdout: "pipe",
		stderr: "pipe",
	});
	const [output, errors, exit] = await Promise.all([
		new Response(process.stdout).text(),
		new Response(process.stderr).text(),
		process.exited,
	]);
	assert.equal(exit, 0, `playwright-cli failed: ${output}\n${errors}`);
}

async function loadTools() {
	const entry = process.env.BROWSER_PLUGIN_ENTRY ?? resolve("plugin/index.ts");
	if (process.env.ORGSDK_RUNTIME_DIR) {
		assert(
			entry.endsWith(".mjs"),
			"Runtime verification requires BROWSER_PLUGIN_ENTRY pointing to an executable release.",
		);
		return runtimeTools(process.env.ORGSDK_RUNTIME_DIR, entry, configuration);
	}
	const exports = await import(pathToFileURL(entry).href);
	const context = testContext(configuration);
	const module = moduleSchema.parse(await exports.default(context));
	return async (name: string, input: Record<string, unknown> = {}) => {
		const tool = module.safeFunctions.find((tool) => tool.name === name);
		assert(tool, `Missing ${name}`);
		return tool.handler({}, input);
	};
}

try {
	const configFile = join(root, "cli.json");
	await writeFile(
		configFile,
		JSON.stringify({
			browser: {
				browserName: "chromium",
				launchOptions: {
					executablePath: chromium.executablePath(),
					headless: true,
					chromiumSandbox: false,
					args: [`--remote-debugging-port=${cdpPort}`],
				},
			},
		}),
	);
	await cli("open", "--config", configFile, "--profile", join(root, "profile"));
	const call = await loadTools();
	const before = z.array(pageSchema).parse(await call("listPages"));
	const tab = pageSchema.parse(
		await call("openPage", { url: fixture.url.toString() }),
	);
	assert.equal(tab.title, "CDP fixture");
	const snapshot = z
		.object({ snapshot: z.string(), truncated: z.boolean() })
		.parse(await call("snapshot", { pageId: tab.pageId }));
	assert(snapshot.snapshot.includes("Remote browser fixture"));
	await call("fill", {
		pageId: tab.pageId,
		selector: "#email",
		value: "test@example.com",
	});
	await call("press", { pageId: tab.pageId, selector: "#email", key: "End" });
	assert.deepEqual(
		await call("selectOption", {
			pageId: tab.pageId,
			selector: "#color",
			values: ["blue"],
		}),
		["blue"],
	);
	await call("click", {
		pageId: tab.pageId,
		selector: 'role=button[name="Continue"]',
	});
	assert.deepEqual(
		await call("readText", { pageId: tab.pageId, selector: "#result" }),
		{ text: "test@example.com", truncated: false },
	);
	assert.deepEqual(
		await call("readText", {
			pageId: tab.pageId,
			selector: "#result",
			maxChars: 4,
		}),
		{ text: "test", truncated: true },
	);
	await call("evaluate", {
		pageId: tab.pageId,
		expression: 'document.cookie = "cdpTest=retained; path=/"',
	});
	const reloadedCall = await loadTools();
	assert(
		String(
			await reloadedCall("evaluate", {
				pageId: tab.pageId,
				expression: "document.cookie",
			}),
		).includes("cdpTest=retained"),
	);
	const image = z
		.object({ base64: z.string() })
		.parse(await call("screenshot", { pageId: tab.pageId }));
	const bytes = Buffer.from(image.base64, "base64");
	assert.equal(bytes.subarray(1, 4).toString(), "PNG");
	await mkdir(".artifacts", { recursive: true });
	await writeFile(".artifacts/integration.png", bytes);
	const navigation = z.object({ status: z.number() }).parse(
		await call("navigate", {
			pageId: tab.pageId,
			url: fixture.url.toString(),
		}),
	);
	assert.equal(navigation.status, 200);

	configuration.actionTimeoutMs = 250;
	await assert.rejects(
		call("click", { pageId: tab.pageId, selector: "#missing" }),
		/exceeded|Timeout/,
	);
	await assert.rejects(
		call("evaluate", {
			pageId: tab.pageId,
			expression: "new Promise(() => {})",
		}),
		/exceeded/,
	);
	configuration.actionTimeoutMs = 5_000;
	assert(
		z
			.array(pageSchema)
			.parse(await call("listPages"))
			.some((page) => page.pageId === tab.pageId),
	);
	const countBeforeFailedNavigation = z
		.array(pageSchema)
		.parse(await call("listPages")).length;
	configuration.actionTimeoutMs = 250;
	await assert.rejects(
		call("openPage", { url: new URL("/slow", fixture.url).toString() }),
		/exceeded|Timeout/,
	);
	configuration.actionTimeoutMs = 5_000;
	assert.equal(
		z.array(pageSchema).parse(await call("listPages")).length,
		countBeforeFailedNavigation,
	);
	await assert.rejects(
		call("openPage", { url: "http://127.0.0.1:1/unreachable" }),
	);
	assert.equal(
		z.array(pageSchema).parse(await call("listPages")).length,
		countBeforeFailedNavigation,
	);

	const version = z
		.object({ webSocketDebuggerUrl: z.string() })
		.parse(await (await fetch(`${endpoint}/json/version`)).json());
	configuration.cdpEndpoint = version.webSocketDebuggerUrl;
	assert(
		z
			.array(pageSchema)
			.parse(await call("listPages"))
			.some((page) => page.pageId === tab.pageId),
	);
	await call("closePage", { pageId: tab.pageId });
	await assert.rejects(
		call("readText", { pageId: tab.pageId }),
		/no longer available/,
	);
	const after = z.array(pageSchema).parse(await call("listPages"));
	assert.deepEqual(
		after.map((page) => page.pageId).sort(),
		before.map((page) => page.pageId).sort(),
	);
	console.log(
		"PASS: all 12 tools, HTTP/WS CDP, stable IDs, retained cookies, timeout recovery, PNG output and tab cleanup.",
	);
} finally {
	await cli("close").catch((error: unknown) => console.error(String(error)));
	fixture.stop(true);
	await rm(root, { recursive: true, force: true });
	if (previousDataDir === undefined) {
		delete process.env.EXECUTOR_DATA_DIR;
	} else {
		process.env.EXECUTOR_DATA_DIR = previousDataDir;
	}
	if (previousAgentDir === undefined) {
		delete process.env.EXECUTOR_AGENT_DIR;
	} else {
		process.env.EXECUTOR_AGENT_DIR = previousAgentDir;
	}
}
