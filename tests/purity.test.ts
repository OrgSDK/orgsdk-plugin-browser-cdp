/**
 * Source purity guard — ensures the plugin has no runtime dependency on
 * private OrgSDK packages and that @orgsdk/plugins is imported type-only.
 *
 * The public authoring SDK (@orgsdk/plugins) is permitted as a dev-only,
 * type-only import — it ships types, not runtime code. All other
 * @orgsdk/* or orgsdk/* specifiers are forbidden (they would couple the
 * plugin to private daemon/platform/storage internals).
 */
import { describe, expect, it } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

const PLUGIN_DIR = resolve(import.meta.dir, "..", "plugin");

/** Any import from a private @orgsdk/* or orgsdk/* package. */
const FORBIDDEN_SPECIFIER =
	/(?:^|\n)\s*import\b[^;]*?from\s+["']((?:@orgsdk\/|orgsdk\/)[^"']+)["']/g;

/**
 * A value (non-type) import from @orgsdk/plugins — forbidden because the
 * SDK is dev-only; the runtime artifact must not depend on it.
 */
const SDK_VALUE_IMPORT =
	/(?:^|\n)\s*import\s+(?!type\b)\{[^}]*\}\s+from\s+["']@orgsdk\/plugins["']/;

async function collectTsFiles(dir: string): Promise<string[]> {
	const out: string[] = [];
	for (const entry of await readdir(dir, { withFileTypes: true })) {
		const abs = join(dir, entry.name);
		if (entry.isDirectory()) {
			out.push(...(await collectTsFiles(abs)));
		} else if (entry.isFile() && entry.name.endsWith(".ts")) {
			out.push(abs);
		}
	}
	return out;
}

describe("source purity", () => {
	it("no plugin source imports a private @orgsdk/* or orgsdk/* package", async () => {
		const files = await collectTsFiles(PLUGIN_DIR);
		expect(files.length).toBeGreaterThan(0);

		const offenders: Array<{ file: string; specifier: string }> = [];
		for (const file of files) {
			const src = await readFile(file, "utf-8");
			for (const match of src.matchAll(FORBIDDEN_SPECIFIER)) {
				const spec = match[1];
				if (spec === "@orgsdk/plugins" || spec.startsWith("@orgsdk/plugins/")) {
					continue;
				}
				offenders.push({
					file: relative(PLUGIN_DIR, file),
					specifier: spec,
				});
			}
		}

		expect(offenders).toEqual([]);
	});

	it("@orgsdk/plugins is imported type-only everywhere (no runtime value imports)", async () => {
		const files = await collectTsFiles(PLUGIN_DIR);
		const offenders: string[] = [];

		for (const file of files) {
			const src = await readFile(file, "utf-8");
			if (SDK_VALUE_IMPORT.test(src)) {
				offenders.push(relative(PLUGIN_DIR, file));
			}
		}

		expect(offenders).toEqual([]);
	});

	it("no cross-plugin or relative parent imports", async () => {
		const files = await collectTsFiles(PLUGIN_DIR);
		const offenders: string[] = [];

		for (const file of files) {
			const src = await readFile(file, "utf-8");
			const parentImport = /from\s+["']\.\.[/"']/;
			if (parentImport.test(src)) {
				offenders.push(relative(PLUGIN_DIR, file));
			}
		}

		expect(offenders).toEqual([]);
	});
});
