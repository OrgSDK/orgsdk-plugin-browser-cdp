import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

export async function runtimeTools(
	runtime: string,
	entry: string,
	configuration: Record<string, unknown>,
) {
	const source = (file: string) =>
		pathToFileURL(join(runtime, "src", file)).href;
	const { pluginSchema } = await import(source("contract.ts"));
	const { installPlugin } = await import(source("plugin-store.ts"));
	const { loadPlugins } = await import(source("plugins.ts"));
	const { Client } = await import(source("client.ts"));
	const { SandboxExecutor } = await import(
		source("engine/sandbox/executor.ts")
	);
	const manifest = JSON.parse(
		await readFile(entry.replace(/\.mjs$/, ".manifest.json"), "utf8"),
	);
	const projectId = "orgsdk-cdp-integration-test";
	await installPlugin(
		pluginSchema.parse({ ...manifest, configuration }),
		projectId,
		entry,
	);
	return async (
		name: string,
		input: Record<string, unknown> = {},
	): Promise<unknown> => {
		assert.match(name, /^[a-z][a-zA-Z0-9]*$/);
		const plugin = pluginSchema.parse({ ...manifest, configuration });
		const functions = await loadPlugins(
			[plugin],
			new Client("http://unused", "unused"),
			projectId,
		);
		const executor = new SandboxExecutor();
		executor.registerMultiple(functions);
		const result = await executor.execute(
			`return browserCdp.${name}(actionParams);`,
			{},
			{ parameters: input, timeout: 15_000 },
		);
		return result.result;
	};
}
