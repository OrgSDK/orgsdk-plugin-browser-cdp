import type { PluginContext, PluginFactory } from "@orgsdk/plugins";
import { configSchema } from "./config";
import { createFunctions } from "./functions";

const createPlugin: PluginFactory = (context: PluginContext) => ({
	safeFunctions: createFunctions(context.stores.config),
	config: {
		title: "Remote browser (CDP)",
		description:
			"Connect to an existing Chromium browser or Steel session. Authentication secrets belong in a browser-cdp credential.",
		schema: configSchema,
	},
});

export default createPlugin;
