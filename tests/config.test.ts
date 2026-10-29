import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { configSchema, connectionOptions, parseConfig } from "../plugin/config";

describe("CDP connection configuration", () => {
	for (const endpoint of [
		"http://chrome:9222",
		"https://chrome.example",
		"ws://steel:3000",
		"wss://browser.example",
	]) {
		test(`accepts ${endpoint}`, () => {
			const config = parseConfig({ cdpEndpoint: endpoint });
			expect(connectionOptions(config, {}).endpoint).toBe(
				new URL(endpoint).toString(),
			);
		});
	}

	test("requires a supported endpoint and bounded timeouts", () => {
		for (const value of [
			{},
			{ cdpEndpoint: "file:///tmp/chrome" },
			{ cdpEndpoint: "ws://steel:3000", actionTimeoutMs: 0 },
			{ cdpEndpoint: "ws://steel:3000", connectTimeoutMs: 120_001 },
		]) {
			expect(configSchema.safeParse(value).success).toBe(false);
		}
	});

	test("adds Steel credentials and session without dropping existing URL parameters", () => {
		const config = parseConfig({
			cdpEndpoint: "wss://connect.steel.dev?region=eu&sessionId=old",
			authMode: "steel",
			sessionId: "session with / ?",
		});
		const options = connectionOptions(config, {
			"browser-cdp": { secret_apiKey: "key+&?/=" },
		});
		const endpoint = new URL(options.endpoint);
		expect(endpoint.searchParams.get("region")).toBe("eu");
		expect(endpoint.searchParams.getAll("sessionId")).toEqual([
			"session with / ?",
		]);
		expect(endpoint.searchParams.get("apiKey")).toBe("key+&?/=");
	});

	test("supports custom connection headers and an unambiguous bearer header", () => {
		const config = parseConfig({
			cdpEndpoint: "wss://browser.example",
			authMode: "bearer",
		});
		const options = connectionOptions(config, {
			"browser-cdp": {
				secret_apiKey: "token",
				secret_headers: JSON.stringify({
					authorization: "old",
					"X-Tenant": "tenant",
				}),
			},
		});
		expect(options.headers).toEqual({
			Authorization: "Bearer token",
			"X-Tenant": "tenant",
		});
		expect(options.endpoint).not.toContain("token");
	});

	test("does not send an attached token in unauthenticated mode", () => {
		const config = parseConfig({ cdpEndpoint: "ws://steel:3000" });
		expect(
			connectionOptions(config, { "browser-cdp": { secret_apiKey: "token" } }),
		).toEqual({ endpoint: "ws://steel:3000/", headers: {} });
	});

	test("rejects missing auth and invalid header JSON before connection", () => {
		const config = parseConfig({
			cdpEndpoint: "ws://steel:3000",
			authMode: "steel",
			sessionId: "existing-session",
		});
		expect(() => connectionOptions(config, {})).toThrow("secret_apiKey");
		expect(() =>
			connectionOptions(config, {
				"browser-cdp": { secret_headers: "invalid-json" },
			}),
		).toThrow();
	});

	test("requires an existing Steel Cloud session instead of opening one on each call", () => {
		const config = parseConfig({
			cdpEndpoint: "wss://connect.steel.dev",
			authMode: "steel",
		});
		expect(() =>
			connectionOptions(config, { "browser-cdp": { secret_apiKey: "key" } }),
		).toThrow("sessionId");
		const fromUrl = {
			...config,
			cdpEndpoint: "wss://connect.steel.dev?sessionId=existing",
		};
		expect(
			new URL(
				connectionOptions(fromUrl, { "browser-cdp": { secret_apiKey: "key" } })
					.endpoint,
			).searchParams.get("sessionId"),
		).toBe("existing");
	});

	test("exports a serializable schema for OrgSDK configuration forms", () => {
		const schema = z.toJSONSchema(configSchema);
		expect(schema.required).toEqual(["cdpEndpoint"]);
		expect(schema.additionalProperties).toBe(false);
	});
});
