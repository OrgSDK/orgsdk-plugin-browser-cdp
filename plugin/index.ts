import type { PluginContext, PluginFactory } from "@orgsdk/plugins";
import { configSchema } from "./config";
import { createFunctions } from "./functions";

const createPlugin: PluginFactory = (context: PluginContext) => ({
	safeFunctions: createFunctions(context.stores.config),
	config: {
		title: "Remote browser (CDP)",
		description:
			"Set the browser endpoint before running an action. Store connection secrets in a browser-cdp credential.",
		schema: configSchema,
	},
});

export default createPlugin;
