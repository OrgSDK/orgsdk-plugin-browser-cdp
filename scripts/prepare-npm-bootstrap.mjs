import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export function validateMissingPackage(status) {
	assert.equal(
		status,
		404,
		"Expected anonymous npm registry 404 before first-package bootstrap; inspect existing or unavailable packages manually",
	);
}

export function validateArchiveDigest(bytes, expectedDigest) {
	const message = "Expected the approved artifact SHA256";
	assert.equal(typeof expectedDigest, "string", message);
	assert.match(expectedDigest, /^[a-f0-9]{64}$/, message);
	assert.equal(
		createHash("sha256").update(bytes).digest("hex"),
		expectedDigest,
		message,
	);
}

export function validateBootstrapContext(environment) {
	const required = {
		GITHUB_ACTIONS: "true",
		GITHUB_REPOSITORY: "OrgSDK/orgsdk-plugin-browser-cdp",
		GITHUB_REF: "refs/heads/main",
		GITHUB_EVENT_NAME: "workflow_dispatch",
		GITHUB_JOB: "bootstrap",
	};
	for (const [key, value] of Object.entries(required)) {
		assert.equal(
			environment[key],
			value,
			`Expected protected manual GitHub bootstrap context: ${key}`,
		);
	}
}

export async function prepareBootstrap({
	archive,
	directory,
	expectedDigest,
	environment = process.env,
	request = fetch,
}) {
	validateBootstrapContext(environment);
	const archivePath = resolve(archive);
	validateArchiveDigest(await readFile(archivePath), expectedDigest);
	const extract = (file) =>
		execFileSync("tar", ["-xOf", archivePath, `package/${file}`], {
			encoding: "utf8",
			timeout: 10000,
			maxBuffer: 1048576,
		});
	const release = JSON.parse(extract("package.json"));
	const license = extract("LICENSE");
	const notice = extract("NOTICE");
	const response = await request(
		"https://registry.npmjs.org/%40orgsdk%2Fplugin-browser-cdp",
		{
			headers: { accept: "application/json" },
			redirect: "error",
			signal: AbortSignal.timeout(15000),
		},
	);
	validateMissingPackage(response.status);
	await createIdentityReservation({ release, license, notice, directory });
	return {
		name: release.name,
		version: "0.0.0-bootstrap.0",
		directory,
		warning: "DO NOT APPROVE this reservation; stage 0.1.2 through OIDC",
	};
}

export async function createIdentityReservation({
	release,
	license,
	notice,
	directory,
}) {
	const message = "Expected the approved Browser CDP 0.1.2 release";
	assert.equal(release?.name, "@orgsdk/plugin-browser-cdp", message);
	assert.equal(release.version, "0.1.2", message);
	assert.equal(release.license, "Apache-2.0", message);
	assert.notEqual(release.private, true, message);
	assert.deepEqual(
		release.repository,
		{
			type: "git",
			url: "git+https://github.com/OrgSDK/orgsdk-plugin-browser-cdp.git",
		},
		message,
	);
	assert.equal(release.publishConfig?.access, "public", message);
	assert.equal(
		release.publishConfig?.registry,
		"https://registry.npmjs.org/",
		message,
	);
	assert.equal(release.publishConfig?.provenance, true, message);
	assert.ok(
		typeof license === "string" &&
			license.trim() &&
			typeof notice === "string" &&
			notice.trim(),
		"Expected nonempty license and notice before reserving package identity",
	);
	const reservation = {
		name: release.name,
		version: "0.0.0-bootstrap.0",
		private: false,
		description:
			"Identity reservation only - DO NOT APPROVE. Real release: 0.1.2.",
		license: "Apache-2.0",
		repository: release.repository,
		author: "OrgSDK",
		files: ["README.md", "LICENSE", "NOTICE"],
		publishConfig: {
			access: "public",
			registry: "https://registry.npmjs.org/",
			provenance: false,
			tag: "bootstrap-reservation",
		},
	};
	await mkdir(directory);
	await writeFile(
		join(directory, "package.json"),
		`${JSON.stringify(reservation, null, 2)}\n`,
	);
	await writeFile(
		join(directory, "README.md"),
		"# npm identity reservation\n\nDO NOT APPROVE OR INSTALL THIS VERSION.\n\n" +
			"This metadata-only candidate reserves the package identity for a stage-only trusted publisher. " +
			"It contains no executable plugin. Stage the verified Browser CDP 0.1.2 artifact through OIDC instead.\n\n" +
			"Retain this reservation until the real version is published and trust is verified, then reject only this bootstrap stage.\n",
	);
	await writeFile(join(directory, "LICENSE"), license);
	await writeFile(join(directory, "NOTICE"), notice);
}

if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
	try {
		assert.equal(
			process.argv.length,
			5,
			"Usage: prepare-npm-bootstrap.mjs ARCHIVE OUTPUT SHA256",
		);
		const result = await prepareBootstrap({
			archive: process.argv[2],
			directory: process.argv[3],
			expectedDigest: process.argv[4],
		});
		console.log(JSON.stringify(result));
	} catch (error) {
		console.error(error.message);
		process.exitCode = 1;
	}
}
