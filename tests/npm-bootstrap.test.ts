import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

type Step = {
	name?: string;
	uses?: string;
	run?: string;
	env?: Record<string, string>;
};

type Workflow = {
	on: {
		workflow_dispatch: {
			inputs: Record<
				string,
				{ description: string; type: string; default: boolean }
			>;
		};
	};
	jobs: Record<
		string,
		{
			if?: string;
			environment?: string;
			needs?: string;
			permissions?: Record<string, string>;
			env?: Record<string, string>;
			steps: Step[];
		}
	>;
};

test("identity bootstrap is a separately gated protected manual job", async () => {
	const workflow = Bun.YAML.parse(
		await readFile(
			new URL("../.github/workflows/publish-npm.yml", import.meta.url),
			"utf8",
		),
	) as Workflow;
	expect(workflow.on.workflow_dispatch.inputs.bootstrap_identity).toEqual({
		description:
			"Reserve missing package identity only; never approve the bootstrap candidate",
		type: "boolean",
		default: false,
	});
	const bootstrap = workflow.jobs.bootstrap;
	expect(bootstrap).toBeDefined();
	expect(bootstrap.needs).toBe("verify");
	expect(bootstrap.environment).toBe("npm-publish");
	expect(bootstrap.permissions).toEqual({ contents: "read" });
	for (const guard of [
		"github.event_name == 'workflow_dispatch'",
		"github.ref == 'refs/heads/main'",
		"inputs.dry_run == false",
		"inputs.bootstrap_identity == true",
		"vars.ORGSDK_ENABLE_NPM_BOOTSTRAP == 'true'",
	]) {
		expect(bootstrap.if).toContain(guard);
	}
	expect(workflow.jobs.publish.if).toContain("!inputs.bootstrap_identity");
	const tokenSteps = bootstrap.steps.filter(
		(step) => step.env?.NODE_AUTH_TOKEN,
	);
	expect(tokenSteps).toHaveLength(1);
	expect(tokenSteps[0].env?.NODE_AUTH_TOKEN).toBe(
		"${{ secrets.NPM_BOOTSTRAP_TOKEN }}",
	);
	expect(tokenSteps[0].run).toContain("npm stage publish");
	expect(tokenSteps[0].run).toContain("--provenance=false");
	expect(tokenSteps[0].run).toContain("--ignore-scripts");
	expect(tokenSteps[0].run).toContain("--tag bootstrap-reservation");
	const publishText = JSON.stringify(workflow.jobs.publish);
	expect(publishText).not.toContain("NPM_BOOTSTRAP_TOKEN");
	expect(publishText).toContain("--provenance");
	expect(JSON.stringify(bootstrap)).not.toMatch(/npm publish\b/);
});

test("bootstrap preparation is pinned to the approved tested release archive", async () => {
	const workflow = Bun.YAML.parse(
		await readFile(
			new URL("../.github/workflows/publish-npm.yml", import.meta.url),
			"utf8",
		),
	) as Workflow;
	expect(workflow.jobs.bootstrap.env?.EXPECTED_NPM_SHA256).toBe(
		"fcca746efb1d5aabc76550dc9b4f8a7512b1447c38841a18521b852eb78e81cd",
	);
	const preparation = workflow.jobs.bootstrap.steps.find((step) =>
		step.run?.includes("node scripts/prepare-npm-bootstrap.mjs"),
	);
	expect(preparation?.run).toContain('"$EXPECTED_NPM_SHA256"');
	expect(preparation?.env?.NODE_AUTH_TOKEN).toBeUndefined();
});
