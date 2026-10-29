import { expect, mock, test } from "bun:test";
import { createFunctions } from "../plugin/functions";
import createPlugin from "../plugin/index";
import { testContext } from "./context";

const context = testContext({ cdpEndpoint: "ws://steel:3000" });
const store = context.stores.config;

test("factory inspection needs neither configuration nor a browser", async () => {
	const module = await createPlugin(context);
	expect(module.safeFunctions).toHaveLength(12);
	expect(module.config?.schema).toBeDefined();
	expect(module.onLoad).toBeUndefined();
});

test("rejects unknown arguments, invalid URLs and missing IDs before any connection", async () => {
	const connect = mock(async () => {
		throw new Error("must not connect");
	});
	const tools = createFunctions(store, connect);
	for (const [name, input] of [
		["navigate", { pageId: "page", url: "file:///etc/passwd" }],
		["navigate", { pageId: "page", url: "javascript:alert(1)" }],
		["click", { selector: "button" }],
		["readText", { pageId: "page", maxChars: 0 }],
		["listPages", { endpoint: "ws://other-browser" }],
	] as const) {
		const tool = tools.find((tool) => tool.name === name);
		expect(tool).toBeDefined();
		await expect(tool?.handler({}, input)).rejects.toThrow();
	}
	expect(connect).not.toHaveBeenCalled();
});

test("metadata exposes named arguments and marks mutations accurately", () => {
	const tools = createFunctions(store);
	expect(new Set(tools.map((tool) => tool.name)).size).toBe(tools.length);
	for (const tool of tools) {
		expect(tool.requiredCredentials).toEqual(["browser-cdp"]);
		expect(tool.parameters).toBeDefined();
		expect(tool.returnType).toMatch(/^Promise</);
		expect(tool.metadata?.readonly).toBe(
			["listPages", "snapshot", "readText", "screenshot"].includes(tool.name),
		);
	}
});
