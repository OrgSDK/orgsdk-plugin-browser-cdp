import type { PluginContext } from "@orgsdk/plugins";

export function testContext(
	configuration: Record<string, unknown>,
): PluginContext {
	const deny = async () => {
		throw new Error("Read-only test snapshot");
	};
	const noop = () => {};
	const logger = {
		trace: noop,
		debug: noop,
		info: noop,
		warn: noop,
		error: noop,
		fatal: noop,
		child: () => logger,
	};
	return {
		publicBaseUrl: "",
		logger,
		stores: {
			config: {
				get: async (key) =>
					key === "plugin:browser-cdp"
						? { key, value: configuration, updatedAt: null }
						: null,
				list: async () => [],
				set: deny,
				delete: deny,
			},
			credential: {
				get: async () => null,
				list: async () => [],
				getSecrets: async () => null,
				upsert: deny,
				delete: deny,
				setSecrets: deny,
			},
		},
	};
}
