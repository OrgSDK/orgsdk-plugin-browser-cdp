import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

// Run the actual fixture, replacing only its imported I/O and clock boundaries.
// No copy of the readiness implementation, browser install or shared endpoint.
const source = await readFile(
	new URL("./executor-fixture.mjs", import.meta.url),
	"utf8",
);
assert(source.includes("export default async function createFixture("));
const loadFixture = new Function(
	"assert",
	"readFile",
	"createServer",
	"join",
	"chromium",
	"performance",
	"setTimeout",
	source.replace(/^import .*;\n/gm, "").replace("export default ", "return "),
);
const ready = "43123\n/devtools/browser/00000000-0000-4000-8000-000000000000";

async function fixtureHarness(
	t,
	observations,
	{ closeError, launchError, readDuration = 0 } = {},
) {
	const temporary = await mkdtemp(join(tmpdir(), "cdp-readiness-unit-"));
	const file = join(temporary, "browser-profile", "DevToolsActivePort");
	const observed = { reads: 0, closes: 0, elapsed: 0, servers: [] };
	let fixture;
	let written;
	const context = {
		async route() {},
		async close() {
			observed.closes++;
			if (closeError) throw closeError;
		},
	};
	const create = loadFixture(
		assert,
		async (path, encoding) => {
			assert.equal(path, file);
			const state =
				observations[Math.min(observed.reads++, observations.length - 1)];
			if (state instanceof Error) throw state;
			if (state !== undefined && state !== written) {
				await writeFile(path, state);
				written = state;
			}
			// Only the producer is staged; every observation does a fresh real read.
			observed.elapsed += readDuration;
			return readFile(path, encoding);
		},
		(...args) => {
			const server = createServer(...args);
			observed.servers.push(server);
			return server;
		},
		join,
		{
			async launchPersistentContext(profile, options) {
				assert.equal(profile, join(temporary, "browser-profile"));
				assert.deepEqual(options, {
					headless: true,
					args: ["--remote-debugging-port=0"],
				});
				if (launchError) throw launchError;
				await mkdir(profile);
				return context;
			},
		},
		{ now: () => observed.elapsed },
		(callback, delay) => {
			assert(delay > 0, "poll must yield with a bounded positive interval");
			observed.elapsed += delay;
			queueMicrotask(callback);
		},
	);
	t.after(async () => {
		await fixture?.close();
		for (const server of observed.servers) {
			if (server.listening) await new Promise((done) => server.close(done));
		}
		await rm(temporary, { recursive: true, force: true });
	});
	return {
		observed,
		async create() {
			fixture = await create({ temporary });
			return fixture;
		},
		async close() {
			await fixture.close();
			fixture = undefined;
		},
	};
}

test("fixture times out an absent file with a useful deadline error and cleans up", async (t) => {
	const harness = await fixtureHarness(t, [undefined]);
	await assert.rejects(
		harness.create(),
		/Timed out after 5000ms waiting for .*DevToolsActivePort.*missing/,
	);
	assert.equal(harness.observed.elapsed, 5_000);
	assertClean(harness.observed);
});

for (const contents of [
	"not-a-port",
	"0",
	"65536",
	"123garbage",
	"123\n/not-a-browser",
	`${ready}\nextra`,
	ready.replace("43123", "99999"),
]) {
	test(`fixture rejects malformed port file ${JSON.stringify(contents)} without retry`, async (t) => {
		const harness = await fixtureHarness(t, [contents]);
		await assert.rejects(harness.create(), /Malformed DevToolsActivePort/);
		assert.equal(harness.observed.reads, 1);
		assert.equal(harness.observed.elapsed, 0);
		assertClean(harness.observed);
	});
}

for (const contents of ["", "4", "43123\n", "43123\n/devtools/browser/0000"]) {
	test(`fixture bounds never-completed file ${JSON.stringify(contents)} and cleans up`, async (t) => {
		const harness = await fixtureHarness(t, [contents]);
		await assert.rejects(
			harness.create(),
			/Timed out after 5000ms waiting for .*DevToolsActivePort.*incomplete/,
		);
		assert.equal(harness.observed.elapsed, 5_000);
		assertClean(harness.observed);
	});
}

for (const code of ["EACCES", "EIO", "EISDIR", "ENOTDIR"]) {
	test(`fixture propagates genuine ${code} unchanged and cleans up without retry`, async (t) => {
		const error = Object.assign(new Error("synthetic filesystem failure"), {
			code,
		});
		const harness = await fixtureHarness(t, [error]);
		await assert.rejects(harness.create(), (actual) => actual === error);
		assert.equal(harness.observed.reads, 1);
		assert.equal(harness.observed.elapsed, 0);
		assertClean(harness.observed);
	});
}

test("fixture propagates launch failure rather than calling it file-readiness failure", async (t) => {
	const error = new Error("synthetic Chromium launch failure");
	const harness = await fixtureHarness(t, [], { launchError: error });
	await assert.rejects(harness.create(), (actual) => actual === error);
	assert.equal(harness.observed.reads, 0);
	assert.equal(harness.observed.closes, 0);
	assert.equal(harness.observed.servers[0].listening, false);
});

test("fixture preserves the readiness timeout and closes the server even if context close fails", async (t) => {
	const harness = await fixtureHarness(t, [undefined], {
		closeError: new Error("synthetic close failure"),
	});
	await assert.rejects(
		harness.create(),
		/Timed out after 5000ms waiting for .*DevToolsActivePort/,
	);
	assertClean(harness.observed);
});

for (const [port, ending] of [
	["1", ""],
	["65535", "\n"],
]) {
	test(`fixture accepts complete port ${port} without a startup delay`, async (t) => {
		const harness = await fixtureHarness(t, [
			ready.replace("43123", port) + ending,
		]);
		const fixture = await harness.create();
		assert.equal(fixture.configuration.cdpEndpoint, `http://127.0.0.1:${port}`);
		assert.equal(harness.observed.reads, 1);
		assert.equal(harness.observed.elapsed, 0);
		await harness.close();
		assertClean(harness.observed);
	});
}

test("fixture refreshes every missing and partial file observation until the whole record arrives", async (t) => {
	const states = [
		undefined,
		...Array.from({ length: ready.length + 1 }, (_, end) =>
			ready.slice(0, end),
		),
	];
	const harness = await fixtureHarness(t, states);
	const fixture = await harness.create();
	assert.equal(fixture.configuration.cdpEndpoint, "http://127.0.0.1:43123");
	assert.equal(harness.observed.reads, states.length);
	await harness.close();
	assertClean(harness.observed);
});

test("fixture refuses a complete record observed only after the startup deadline", async (t) => {
	const harness = await fixtureHarness(t, [ready], { readDuration: 5_001 });
	await assert.rejects(
		harness.create(),
		/Timed out after 5000ms waiting for .*DevToolsActivePort/,
	);
	assert.equal(harness.observed.reads, 1);
	assertClean(harness.observed);
});

function assertClean(observed) {
	assert.equal(observed.closes, 1, "owned context must be closed exactly once");
	assert.equal(observed.servers.length, 1);
	assert.equal(
		observed.servers[0].listening,
		false,
		"owned HTTP server must close",
	);
}

test("fixture waits for its initially absent DevToolsActivePort file", async (t) => {
	const harness = await fixtureHarness(t, [undefined, ready]);
	const fixture = await harness.create();
	assert.equal(fixture.configuration.cdpEndpoint, "http://127.0.0.1:43123");
	assert.equal(harness.observed.reads, 2);
	await harness.close();
	assertClean(harness.observed);
});

test("fixture does not accept a partially written port or browser path", async (t) => {
	const harness = await fixtureHarness(t, [
		"4",
		"43123\n/devtools/browser/",
		ready,
	]);
	const fixture = await harness.create();
	assert.equal(fixture.configuration.cdpEndpoint, "http://127.0.0.1:43123");
	assert.equal(harness.observed.reads, 3);
	await harness.close();
	assertClean(harness.observed);
});
