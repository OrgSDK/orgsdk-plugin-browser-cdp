import { z } from "zod";

export const configSchema = z.strictObject({
	cdpEndpoint: z
		.url({ protocol: /^https?$|^wss?$/ })
		.describe(
			"Chrome CDP HTTP or WebSocket endpoint. Self-hosted Steel: ws://steel:3000; Chrome: http://chrome:9222; Steel Cloud: wss://connect.steel.dev.",
		),
	authMode: z
		.enum(["none", "bearer", "steel"])
		.default("none")
		.optional()
		.describe(
			"none for an unauthenticated endpoint; bearer sends the credential token in Authorization; steel adds apiKey to the connection URL.",
		),
	sessionId: z
		.string()
		.min(1)
		.optional()
		.describe(
			"Existing Steel session ID. Appended as sessionId to the CDP endpoint; session creation and release remain with Steel.",
		),
	connectTimeoutMs: z
		.number()
		.int()
		.min(1)
		.max(120_000)
		.default(15_000)
		.optional(),
	actionTimeoutMs: z
		.number()
		.int()
		.min(1)
		.max(120_000)
		.default(10_000)
		.optional(),
});

export function parseConfig(input: unknown) {
	const config = configSchema.parse(input);
	return {
		...config,
		authMode: config.authMode ?? "none",
		connectTimeoutMs: config.connectTimeoutMs ?? 15_000,
		actionTimeoutMs: config.actionTimeoutMs ?? 10_000,
	};
}

export type BrowserConfig = ReturnType<typeof parseConfig>;

const credentialSchema = z.object({
	secret_apiKey: z.string().min(1).optional(),
	secret_headers: z.string().optional(),
});

export function connectionOptions(config: BrowserConfig, credentials: unknown) {
	const bundle = z.record(z.string(), z.unknown()).parse(credentials);
	const secret = credentialSchema.parse(bundle["browser-cdp"] ?? {});
	const endpoint = new URL(config.cdpEndpoint);
	const headers = secret.secret_headers
		? z.record(z.string(), z.string()).parse(JSON.parse(secret.secret_headers))
		: {};
	if (config.sessionId) {
		endpoint.searchParams.set("sessionId", config.sessionId);
	}
	if (
		(config.authMode === "steel" ||
			endpoint.hostname === "connect.steel.dev") &&
		!endpoint.searchParams.get("sessionId")
	) {
		throw new Error(
			"An existing sessionId is required for Steel Cloud so reconnecting does not create another session.",
		);
	}
	if (config.authMode !== "none" && !secret.secret_apiKey) {
		throw new Error(
			"Attach a browser-cdp credential containing secret_apiKey for the selected authMode.",
		);
	}
	if (config.authMode === "steel" && secret.secret_apiKey) {
		endpoint.searchParams.set("apiKey", secret.secret_apiKey);
	}
	if (config.authMode === "bearer" && secret.secret_apiKey) {
		for (const name of Object.keys(headers)) {
			if (name.toLowerCase() === "authorization") {
				delete headers[name];
			}
		}
		headers.Authorization = `Bearer ${secret.secret_apiKey}`;
	}
	return { endpoint: endpoint.toString(), headers };
}
