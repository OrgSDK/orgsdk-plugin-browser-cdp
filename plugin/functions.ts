import type { PluginContext, SafeFunction } from "@orgsdk/plugins";
import type { Page } from "playwright-core";
import { z } from "zod";
import {
	type BrowserSession,
	type ConnectBrowser,
	withBrowser,
} from "./browser";
import { parseConfig } from "./config";

const pageInput = z.strictObject({ pageId: z.string().min(1) });
const selectorInput = pageInput.extend({ selector: z.string().min(1) });
const urlInput = z.url({ protocol: /^https?$/ });
const limitInput = z.number().int().min(1).max(200_000).default(20_000);
const waitUntilInput = z
	.enum(["commit", "domcontentloaded", "load"])
	.default("domcontentloaded");
const pageParameter = {
	name: "pageId",
	type: "string",
	description: "Stable CDP page ID returned by listPages or openPage.",
};
const selectorParameter = {
	name: "selector",
	type: "string",
	description:
		"Playwright selector, for example #email, text=Continue or role=button[name=Submit].",
};
const pageType = "{ pageId: string; url: string; title: string }";

type Parameters = NonNullable<SafeFunction["parameters"]>;

export function createFunctions(
	store: PluginContext["stores"]["config"],
	connect?: ConnectBrowser,
): SafeFunction[] {
	function tool<Input, Result>(
		name: string,
		description: string,
		schema: z.ZodType<Input>,
		parameters: Parameters,
		returnType: string,
		readonly: boolean,
		operation: (session: BrowserSession, input: Input) => Promise<Result>,
	): SafeFunction {
		return {
			name,
			description,
			parameters,
			returnType: `Promise<${returnType}>`,
			requiredCredentials: ["browser-cdp"],
			metadata: {
				category: "browser",
				readonly,
				tags: readonly ? ["readonly"] : ["io"],
			},
			handler: async (credentials: unknown, input: unknown = {}) => {
				const parsed = schema.parse(input);
				const row = await store.get("plugin:browser-cdp");
				const config = parseConfig(row?.value ?? {});
				return withBrowser(
					config,
					credentials,
					(session) => operation(session, parsed),
					connect,
				);
			},
		};
	}

	function pageTool<Input extends { pageId: string }, Result>(
		name: string,
		description: string,
		schema: z.ZodType<Input>,
		parameters: Parameters,
		returnType: string,
		readonly: boolean,
		operation: (page: Page, input: Input) => Promise<Result>,
	) {
		return tool(
			name,
			description,
			schema,
			[pageParameter, ...parameters],
			returnType,
			readonly,
			async (session, input) =>
				operation(await session.page(input.pageId), input),
		);
	}

	return [
		tool(
			"listPages",
			"List tabs in the remote browser's default context.",
			z.strictObject({}),
			[],
			`${pageType}[]`,
			true,
			async (session) =>
				Promise.all(
					session.context.pages().map((page) => session.describePage(page)),
				),
		),
		tool(
			"openPage",
			"Open a tab in the existing browser context, preserving its cookies.",
			z.strictObject({ url: urlInput.optional(), waitUntil: waitUntilInput }),
			[
				{ name: "url", type: "string", optional: true },
				{
					name: "waitUntil",
					type: '"commit" | "domcontentloaded" | "load"',
					optional: true,
				},
			],
			pageType,
			false,
			async (session, input) => {
				const page = await session.context.newPage();
				session.pagesToClose.add(page);
				try {
					if (input.url) {
						await page.goto(input.url, { waitUntil: input.waitUntil });
					}
					const result = await session.describePage(page);
					session.pagesToClose.delete(page);
					return result;
				} catch (error) {
					await page.close().catch(() => {});
					session.pagesToClose.delete(page);
					throw error;
				}
			},
		),
		pageTool(
			"navigate",
			"Navigate an existing tab to an HTTP(S) URL.",
			pageInput.extend({ url: urlInput, waitUntil: waitUntilInput }),
			[
				{ name: "url", type: "string" },
				{
					name: "waitUntil",
					type: '"commit" | "domcontentloaded" | "load"',
					optional: true,
				},
			],
			"{ url: string; title: string; status: number | null }",
			false,
			async (page, input) => {
				const response = await page.goto(input.url, {
					waitUntil: input.waitUntil,
				});
				return {
					url: page.url(),
					title: await page.title(),
					status: response?.status() ?? null,
				};
			},
		),
		pageTool(
			"snapshot",
			"Read the accessibility tree to discover controls. Use selectors for subsequent interactions.",
			pageInput.extend({
				selector: z.string().min(1).default("body"),
				maxChars: limitInput,
			}),
			[
				{ ...selectorParameter, optional: true },
				{ name: "maxChars", type: "number", optional: true },
			],
			"{ snapshot: string; truncated: boolean }",
			true,
			async (page, input) => {
				const snapshot = await page.locator(input.selector).ariaSnapshot();
				return {
					snapshot: snapshot.slice(0, input.maxChars),
					truncated: snapshot.length > input.maxChars,
				};
			},
		),
		pageTool(
			"readText",
			"Read rendered text from a page or matching element.",
			pageInput.extend({
				selector: z.string().min(1).default("body"),
				maxChars: limitInput,
			}),
			[
				{ ...selectorParameter, optional: true },
				{ name: "maxChars", type: "number", optional: true },
			],
			"{ text: string; truncated: boolean }",
			true,
			async (page, input) => {
				// biome-ignore lint/performance/useDomNodeTextContent: Rendered text intentionally excludes hidden content and scripts.
				const text = await page.locator(input.selector).innerText();
				return {
					text: text.slice(0, input.maxChars),
					truncated: text.length > input.maxChars,
				};
			},
		),
		pageTool(
			"click",
			"Click a matching element. May submit forms or cause external changes.",
			selectorInput,
			[selectorParameter],
			"void",
			false,
			async (page, input) => {
				await page.locator(input.selector).click();
			},
		),
		pageTool(
			"fill",
			"Replace the value of a matching input or textarea.",
			selectorInput.extend({ value: z.string() }),
			[selectorParameter, { name: "value", type: "string" }],
			"void",
			false,
			async (page, input) => {
				await page.locator(input.selector).fill(input.value);
			},
		),
		pageTool(
			"press",
			"Press a key or shortcut on a matching element (for example Enter or Control+A).",
			selectorInput.extend({ key: z.string().min(1) }),
			[selectorParameter, { name: "key", type: "string" }],
			"void",
			false,
			async (page, input) => {
				await page.locator(input.selector).press(input.key);
			},
		),
		pageTool(
			"selectOption",
			"Select values in a matching select element.",
			selectorInput.extend({ values: z.array(z.string()).min(1) }),
			[selectorParameter, { name: "values", type: "string[]" }],
			"string[]",
			false,
			async (page, input) =>
				page.locator(input.selector).selectOption(input.values),
		),
		pageTool(
			"screenshot",
			"Capture a PNG screenshot as base64; no remote filesystem path is required.",
			pageInput.extend({ fullPage: z.boolean().default(false) }),
			[{ name: "fullPage", type: "boolean", optional: true }],
			'{ mimeType: "image/png"; base64: string }',
			true,
			async (page, input) => ({
				mimeType: "image/png",
				base64: (
					await page.screenshot({ type: "png", fullPage: input.fullPage })
				).toString("base64"),
			}),
		),
		pageTool(
			"evaluate",
			"Evaluate a JavaScript expression in the page and return a serializable value. May change the page or call its APIs.",
			pageInput.extend({ expression: z.string().min(1) }),
			[{ name: "expression", type: "string" }],
			"unknown",
			false,
			async (page, input): Promise<unknown> => page.evaluate(input.expression),
		),
		pageTool(
			"closePage",
			"Close only the explicitly selected tab. The browser session stays running.",
			pageInput,
			[],
			"void",
			false,
			async (page) => {
				await page.close();
			},
		),
	];
}
