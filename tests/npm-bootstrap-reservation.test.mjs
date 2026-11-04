import { expect, test } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import {
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rm,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const script = new URL("../scripts/prepare-npm-bootstrap.mjs", import.meta.url);
const release = {
	name: "@orgsdk/plugin-browser-cdp",
	version: "0.1.2",
	license: "Apache-2.0",
	repository: {
		type: "git",
		url: "git+https://github.com/OrgSDK/orgsdk-plugin-browser-cdp.git",
	},
	main: "./plugin.mjs",
	exports: { ".": "./plugin.mjs" },
	publishConfig: {
		access: "public",
		registry: "https://registry.npmjs.org/",
		provenance: true,
	},
};

test.each([
	["license", ""],
	["license", "\n  "],
	["notice", ""],
	["notice", "\n  "],
])(
	"reservation rejects empty %s before creating output",
	async (field, value) => {
		const { createIdentityReservation } = await import(script.href);
		const parent = await mkdtemp(join(tmpdir(), "orgsdk-bootstrap-legal-"));
		try {
			const directory = join(parent, "reservation");
			await expect(
				createIdentityReservation({
					release,
					license: "Apache License",
					notice: "OrgSDK",
					[field]: value,
					directory,
				}),
			).rejects.toThrow(/nonempty license and notice/);
			expect(existsSync(directory)).toBe(false);
		} finally {
			await rm(parent, { recursive: true, force: true });
		}
	},
);

test("direct CLI invocation outside GitHub fails instead of silently succeeding", () => {
	const environment = { ...process.env };
	delete environment.GITHUB_ACTIONS;
	const result = spawnSync(
		"node",
		[fileURLToPath(script), "missing.tgz", "reservation", "0".repeat(64)],
		{
			env: environment,
			encoding: "utf8",
		},
	);
	expect(result.status).not.toBe(0);
	expect(result.stderr).toContain("protected manual GitHub bootstrap");
});

test("prepare-only orchestration checks the archive and synthetic registry transport before creating metadata", async () => {
	const { prepareBootstrap } = await import(script.href);
	expect(typeof prepareBootstrap).toBe("function");
	const parent = await mkdtemp(join(tmpdir(), "orgsdk-bootstrap-prepare-"));
	try {
		const packageDir = join(parent, "package");
		await mkdir(packageDir);
		await writeFile(join(packageDir, "package.json"), JSON.stringify(release));
		await writeFile(join(packageDir, "LICENSE"), "Apache License");
		await writeFile(join(packageDir, "NOTICE"), "OrgSDK");
		const archive = join(parent, "fixture.tgz");
		execFileSync("tar", ["-czf", archive, "-C", parent, "package"]);
		const digest = createHash("sha256")
			.update(await readFile(archive))
			.digest("hex");
		let requests = 0;
		const directory = join(parent, "reservation");
		await prepareBootstrap({
			archive,
			directory,
			expectedDigest: digest,
			environment: {
				GITHUB_ACTIONS: "true",
				GITHUB_REPOSITORY: "OrgSDK/orgsdk-plugin-browser-cdp",
				GITHUB_REF: "refs/heads/main",
				GITHUB_EVENT_NAME: "workflow_dispatch",
				GITHUB_JOB: "bootstrap",
			},
			request: async (url, options) => {
				requests++;
				expect(url).toBe(
					"https://registry.npmjs.org/%40orgsdk%2Fplugin-browser-cdp",
				);
				expect(options.headers).toEqual({ accept: "application/json" });
				expect(options.redirect).toBe("error");
				return new Response(null, { status: 404 });
			},
		});
		expect(requests).toBe(1);
		const pkg = JSON.parse(
			await readFile(join(directory, "package.json"), "utf8"),
		);
		expect(pkg.version).toBe("0.0.0-bootstrap.0");
	} finally {
		await rm(parent, { recursive: true, force: true });
	}
});

test("only an anonymous registry 404 permits a first-package reservation", async () => {
	const { validateMissingPackage } = await import(script.href);
	expect(typeof validateMissingPackage).toBe("function");
	expect(() => validateMissingPackage(404)).not.toThrow();
	for (const status of [200, 204, 401, 403, 429, 500]) {
		expect(() => validateMissingPackage(status)).toThrow(/registry 404/);
	}
});

test("bootstrap preparation accepts only the approved archive digest", async () => {
	const { validateArchiveDigest } = await import(script.href);
	expect(typeof validateArchiveDigest).toBe("function");
	const bytes = Buffer.from(
		"archive unit-test fixture, not a published package",
	);
	const digest = createHash("sha256").update(bytes).digest("hex");
	expect(() => validateArchiveDigest(bytes, digest)).not.toThrow();
	for (const invalid of [undefined, "", "not-a-digest", "0".repeat(64)]) {
		expect(() => validateArchiveDigest(bytes, invalid)).toThrow(
			/approved artifact SHA256/,
		);
	}
});

test("bootstrap preparation admits only the intended manual GitHub main job context", async () => {
	const { validateBootstrapContext } = await import(script.href);
	expect(typeof validateBootstrapContext).toBe("function");
	const environment = {
		GITHUB_ACTIONS: "true",
		GITHUB_REPOSITORY: "OrgSDK/orgsdk-plugin-browser-cdp",
		GITHUB_REF: "refs/heads/main",
		GITHUB_EVENT_NAME: "workflow_dispatch",
		GITHUB_JOB: "bootstrap",
	};
	expect(() => validateBootstrapContext(environment)).not.toThrow();
	for (const [key, value] of [
		["GITHUB_ACTIONS", undefined],
		["GITHUB_REPOSITORY", "OrgSDK/another-repository"],
		["GITHUB_REF", "refs/heads/feature"],
		["GITHUB_EVENT_NAME", "pull_request"],
		["GITHUB_JOB", "stage"],
	]) {
		expect(() =>
			validateBootstrapContext({ ...environment, [key]: value }),
		).toThrow(/protected manual GitHub bootstrap/);
	}
});

test("bootstrap reserves identity without occupying the real release version or copying executable entry points", async () => {
	expect(existsSync(script)).toBe(true);
	const { createIdentityReservation } = await import(script.href);
	const parent = await mkdtemp(join(tmpdir(), "orgsdk-bootstrap-test-"));
	try {
		const directory = join(parent, "reservation");
		const license = await readFile(
			new URL("../LICENSE", import.meta.url),
			"utf8",
		);
		const notice = await readFile(
			new URL("../NOTICE", import.meta.url),
			"utf8",
		);
		await createIdentityReservation({ release, license, notice, directory });
		const pkg = JSON.parse(
			await readFile(join(directory, "package.json"), "utf8"),
		);
		expect((await readdir(directory)).sort()).toEqual([
			"LICENSE",
			"NOTICE",
			"README.md",
			"package.json",
		]);
		expect(pkg.name).toBe(release.name);
		expect(pkg.version).toBe("0.0.0-bootstrap.0");
		expect(pkg.private).toBe(false);
		expect(pkg.description).toContain("DO NOT APPROVE");
		expect(pkg.publishConfig).toEqual({
			access: "public",
			registry: "https://registry.npmjs.org/",
			provenance: false,
			tag: "bootstrap-reservation",
		});
		expect(pkg.main).toBeUndefined();
		expect(pkg.exports).toBeUndefined();
		expect(pkg.dependencies).toBeUndefined();
		expect(pkg.scripts).toBeUndefined();
		expect(await readFile(join(directory, "LICENSE"), "utf8")).toBe(license);
		expect(await readFile(join(directory, "README.md"), "utf8")).toContain(
			"DO NOT APPROVE OR INSTALL",
		);
	} finally {
		await rm(parent, { recursive: true, force: true });
	}
});

test.each([
	["package", { name: "@orgsdk/plugin-other" }],
	["version", { version: "0.1.3" }],
	["license", { license: "Proprietary" }],
	["private source", { private: true }],
	[
		"repository",
		{
			repository: {
				type: "git",
				url: "git+https://github.com/OrgSDK/another-repository.git",
			},
		},
	],
	[
		"restricted access",
		{ publishConfig: { ...release.publishConfig, access: "restricted" } },
	],
	[
		"registry",
		{
			publishConfig: {
				...release.publishConfig,
				registry: "https://example.com/",
			},
		},
	],
	[
		"provenance",
		{ publishConfig: { ...release.publishConfig, provenance: false } },
	],
])(
	"reservation rejects a changed approved release %s before creating output",
	async (_label, changed) => {
		const { createIdentityReservation } = await import(script.href);
		const parent = await mkdtemp(join(tmpdir(), "orgsdk-bootstrap-invalid-"));
		try {
			const directory = join(parent, "reservation");
			await expect(
				createIdentityReservation({
					release: { ...release, ...changed },
					license: "Apache License",
					notice: "OrgSDK",
					directory,
				}),
			).rejects.toThrow(/approved Browser CDP 0\.1\.2 release/);
			expect(existsSync(directory)).toBe(false);
		} finally {
			await rm(parent, { recursive: true, force: true });
		}
	},
);
