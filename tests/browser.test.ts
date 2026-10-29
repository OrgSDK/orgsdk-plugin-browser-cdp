import { expect, mock, test } from "bun:test";
import type { Browser, BrowserContext } from "playwright-core";
import { type ConnectBrowser, withBrowser } from "../plugin/browser";
import { parseConfig } from "../plugin/config";

function connectionFixture() {
	const close = mock(async () => {});
	const context = {
		setDefaultTimeout: mock(() => {}),
		setDefaultNavigationTimeout: mock(() => {}),
	} as unknown as BrowserContext;
	const browser = { contexts: () => [context], close } as unknown as Browser;
	const connect = mock(async () => browser);
	return { connect, browser, close, context };
}

const config = parseConfig({ cdpEndpoint: "ws://steel:3000" });

test("disconnects after success and uses existing context without default overrides", async () => {
	const fixture = connectionFixture();
	const value = await withBrowser(
		config,
		{},
		async (session) => {
			expect(session.context).toBe(fixture.context);
			return "result";
		},
		fixture.connect,
	);
	expect(value).toBe("result");
	expect(fixture.close).toHaveBeenCalledTimes(1);
	expect(fixture.connect).toHaveBeenCalledWith("ws://steel:3000/", {
		headers: {},
		timeout: 15_000,
		noDefaults: true,
	});
});

test("disconnects after a failed operation without losing the error", async () => {
	const fixture = connectionFixture();
	await expect(
		withBrowser(
			config,
			{},
			async () => {
				throw new Error("Selector failed");
			},
			fixture.connect,
		),
	).rejects.toThrow("Selector failed");
	expect(fixture.close).toHaveBeenCalledTimes(1);
});

test("bounds hanging evaluation and disconnects", async () => {
	const fixture = connectionFixture();
	await expect(
		withBrowser(
			{ ...config, actionTimeoutMs: 10 },
			{},
			() => new Promise(() => {}),
			fixture.connect,
		),
	).rejects.toThrow("exceeded 10ms");
	expect(fixture.close).toHaveBeenCalledTimes(1);
});

test("a disconnect failure does not replace the operation result", async () => {
	const fixture = connectionFixture();
	fixture.close.mockImplementation(async () => {
		throw new Error("already disconnected");
	});
	expect(
		await withBrowser(config, {}, async () => "done", fixture.connect),
	).toBe("done");
});

test("rejects a browser with no default context and disconnects", async () => {
	const fixture = connectionFixture();
	fixture.browser.contexts = () => [];
	await expect(
		withBrowser(config, {}, async () => "unused", fixture.connect),
	).rejects.toThrow("no default context");
	expect(fixture.close).toHaveBeenCalledTimes(1);
});

test("connection errors cannot disclose credentials, headers or endpoint query values", async () => {
	const connect: ConnectBrowser = async () => {
		throw new Error(
			"ws://steel:3000?apiKey=secret Authorization: Bearer token",
		);
	};
	try {
		await withBrowser(config, {}, async () => "unused", connect);
		throw new Error("Expected connection failure");
	} catch (error) {
		expect(String(error)).toContain("Cannot connect");
		expect(String(error)).not.toContain("apiKey");
		expect(String(error)).not.toContain("Bearer");
	}
});

test("malformed credential JSON is not echoed and never connects", async () => {
	const fixture = connectionFixture();
	await expect(
		withBrowser(
			config,
			{ "browser-cdp": { secret_headers: "sensitive-value" } },
			async () => "unused",
			fixture.connect,
		),
	).rejects.toThrow("Invalid browser connection credentials");
	expect(fixture.connect).not.toHaveBeenCalled();
});
