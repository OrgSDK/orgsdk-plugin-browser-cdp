import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

test("npm README and preferred executor documentation describe the same current distribution", async () => {
	const pkg = JSON.parse(
		await readFile(new URL("../package.json", import.meta.url), "utf8"),
	);
	for (const path of ["../README.md", "../plugin/docs/overview.md"]) {
		const documentation = await readFile(
			new URL(path, import.meta.url),
			"utf8",
		);
		expect(documentation).toContain(pkg.name);
		expect(documentation).toContain(pkg.dependencies["playwright-core"]);
		expect(documentation).toMatch(/installing npm files alone/i);
		expect(documentation).toContain("Apache-2.0");
		expect(documentation).toContain("publish-npm.yml");
		expect(documentation).not.toContain("Private proprietary source");
		expect(documentation).not.toContain("Playwright 1.60.0");
		expect(documentation).not.toContain("no automatic publish");
	}
});
