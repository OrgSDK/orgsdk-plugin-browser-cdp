# Public npm distribution and headless tests

Prepared **31 October 2026**. The plugin code is Apache-2.0, with OrgSDK
attribution in `NOTICE` and the trademark boundary in `TRADEMARKS.md`. Preparation
does not change repository visibility or publish a package. The source root
stays `private: true` to prevent publishing development files by accident.

## Dependencies and verification

Install from this repository's lockfile:

```sh
bun install --frozen-lockfile
bun run check
bun run typecheck
bun run test
bun audit
bun run version-guard
bun run validate
bun run package
bun run build:npm
bun run test:executor
bun run test:registration
```

The authoring API is downloaded from npm as `@orgsdk/plugins@0.2.2`; the packager
and real execution engine are `@orgsdk/executor@0.1.0` from npm. Neither command
uses a sibling platform/toolkit checkout, a Git dependency, or `bun link`. Node
22.22.0+ and Bun 1.4.0 are required; CI checks Node 22.22.1 and 24. Browser plugins
also require Chromium and system libraries matching their Playwright version:

```sh
bunx --no-install playwright install --with-deps chromium
```

`package` recreates `dist/`, so run it before `build:npm`. The latter produces
`dist/npm/`: the ESM entry, pinned manifest/catalogue, complete third-party
notices, Apache licence, attribution, trademark terms and public npm metadata.
JavaScript dependencies are embedded; Chromium remains an external prerequisite.
The versioned `package_url` points to the npm entry through jsDelivr and the
executor verifies its SHA256 digest. These URLs become available after an
authorised npm publication; they are not live release receipts.

`test:executor` packs and extracts the exact npm payload outside the checkout.
It starts with an empty executor store, serves those extracted bytes at the
versioned npm URL through a strict fixture, verifies the digest, loads the real
factory and executes every advertised function with named arguments. It checks
credential denial and absence, and bounded/redacted transport errors where
applicable. Google SDK native HTTP is intercepted with Nock. Browser tests use
owned headless Chromium profiles and a loopback-only CDP site. All credentials,
responses and model outputs are synthetic; unexpected provider traffic fails.

Native OAuth fixtures use precisely `{source: "byo", secret_accessToken}`. The
host owns client secrets, refresh and token rotation. Facebook's `pageId` is
plugin configuration; its page token is resolved using the supplied user access
token. First-party relay credentials are unsupported. Other token providers
receive their stored secret record. Xero and Zendesk currently use explicitly
managed OAuth access tokens; the published host has no native connect/refresh
flow for those providers. Multi-customer Zendesk use requires an approved global
OAuth client, independently of opening this plugin's source.

`test:registration` downloads `@orgsdk/cli@0.1.0` from npm into temporary storage,
starts it with an isolated home/database and Node-only PATH, completes setup and
login, and registers the generated external catalogue release in a new project.
It checks version, digest and package URL through the real tRPC endpoint. It
does not use a personal installation. Installing npm files alone does not
register a plugin: a release catalogue must be configured in OrgSDK and its
release added to the project. These tests establish packaging, registration and
execution contracts; provider app approval and live account permissions still
need an authorised integration check.

Retain the exact tested tarball with:

```sh
NPM_TEST_ARTIFACT_DIR=artifacts bun run test:executor
```

## Reviewed staged release workflow

CI checks author source, dependencies, npm execution and fresh registration.
`publish-npm.yml` verifies matching versions on a `v<version>` tag contained in
`main`, or a manual `main` run defaulting to dry run. It retains the tested npm
tarball and submits only those bytes to npm staging. Publication requires all of:

- Separate publication authority and a public GitHub repository matching the
  generated package's repository metadata. Local-only repositories still need
  their own independently owned remote and initial source publication.
- A protected `npm-publish` environment with maintainer review and a stage-only
  npm trusted publisher bound to `OrgSDK/orgsdk-plugin-browser-cdp`, workflow
  `publish-npm.yml`, environment `npm-publish`. Direct automated publication and
  dist-tag management are not required. No long-lived `NPM_TOKEN` is used.
- Explicit repository variable `ORGSDK_ENABLE_NPM_PUBLISH=true` and a release tag
  or a manual run with `dry_run=false`.

The stage job uses Node 24 and pinned npm 12.0.2, runs
`npm stage publish --access public --provenance`, grants `id-token: write` only
to that job, and checks Apache/public metadata and the exact GitHub identity.
The npm maintainer must inspect and approve the exact staged version through
npm's interactive 2FA flow before it is installable. A successful stage is not
publication. The first package bootstrap creates publicly visible placeholder
metadata; it also requires explicit release authority. Retain the bootstrap
reservation until the real version and trusted publisher are verified.

Template repositories/packages remain blocked until renamed. Do not enable any
release gate as part of local preparation. The workflow file alone changes no
remote setting or package state. Consult
[npm provenance](https://docs.npmjs.com/generating-provenance-statements/) before
the authorised release. npm publication and catalogue promotion are separate
operations; the historical `publish:catalog` command remains manual-only.

## One-time GitHub-only identity bootstrap

Prepared **4 November 2026**. This is a separate, default-disabled recovery path
for the first publication of `@orgsdk/plugin-browser-cdp`, not a replacement for
the stage-only OIDC release above. Local npm login/trust setup does not authorise
local artifact uploads: all `npm stage publish` commands run on GitHub.

npm requires an existing package identity before configuring a trusted publisher.
For a missing package, staging creates the public npm-generated `0.0.0-stage`
placeholder. The submitted reservation is **`0.0.0-bootstrap.0`**, deliberately
different from the real release **`0.1.2`**. It contains only package metadata,
README, Apache licence and NOTICE; no executable plugin, entry points, scripts
or dependencies. **Never approve or install the reservation.** Its explicit
`bootstrap-reservation` tag and disabled provenance apply only to that candidate;
the real release retains OIDC, provenance and human npm 2FA approval.

### Human credential step

After separate bootstrap approval, the operator creates a granular token on the
npm website using the publishing account:

- Packages/scopes: **Read and write (stage only)**, only the **`@orgsdk` scope**.
  The not-yet-created individual package cannot be selected. Do not choose all
  packages or direct publish permission.
- **Bypass 2FA disabled**, organization-management permission **No access**,
  shortest permitted expiry (npm requires at least one day).
- Store it directly as environment secret **`NPM_BOOTSTRAP_TOKEN`** in this
  repository's protected **`npm-publish`** environment. Never put the value in
  chat, source, a repository variable, a command argument or a report.

GitHub required-reviewer approval authorises the job to run. It is distinct from
npm's later human approval of the real release, which requires 2FA.

### Controlled execution and handover

1. Merge and verify the reviewed workflow on `main`. A normal dry run must not
   run either upload job. Keep `ORGSDK_ENABLE_NPM_PUBLISH=false` during bootstrap.
2. Only after the credential is ready, separately enable
   `ORGSDK_ENABLE_NPM_BOOTSTRAP=true` and manually dispatch `publish-npm.yml` on
   `main` with `dry_run=false`, `bootstrap_identity=true`. Approve the protected
   GitHub environment for that exact run. The normal OIDC stage job is excluded.
3. The bootstrap job downloads the exact tarball tested by `verify`. Preparation
   checks the GitHub context, an anonymous registry 404 and the frozen SHA256
   `1d8d04203424652271c7f9136364ac5f09c0872900c61e418a5a0ef760a6df78`
   before creating reservation files from approved 0.1.2 metadata. Existing or
   unavailable registry responses fail closed; investigate rather than retrying
   blindly. Only the final staging step receives the temporary secret.
4. Read back the exact public placeholder and the private staged reservation.
   **Do not approve it and do not reject the only reservation yet.** If staging
   fails, inspect its actual result before retrying or changing any permission.
5. Configure a stage-only trusted publisher for this package, repository
   `OrgSDK/orgsdk-plugin-browser-cdp`, file `publish-npm.yml`, environment
   `npm-publish`. Verify the saved binding through npm; do not grant direct
   publication. This configuration is authentication setup, not an artifact upload.
6. Disable the bootstrap gate, revoke the temporary npm token and remove its
   GitHub environment secret. Then enable the normal release gate and dispatch
   with `dry_run=false`, `bootstrap_identity=false`. Inspect the exact OIDC-staged
   **0.1.2** artifact and provenance before the operator's npm 2FA approval.
7. Anonymously verify the real registry version, integrity, provenance and
   install/consumer path, then verify the trusted publisher again. Only afterward
   reject the identified bootstrap stage; do not remove the package identity.
   Website deployment and announcements remain separate gates.

This procedure is prepared implementation, not a successful registry bootstrap
or OIDC receipt. Primary references: [staged publishing](https://docs.npmjs.com/staged-publishing/),
[token permissions](https://docs.npmjs.com/creating-and-viewing-access-tokens/),
[npm trust](https://docs.npmjs.com/cli/v12/commands/npm-trust/) and
[npm stage](https://docs.npmjs.com/cli/v12/commands/npm-stage/).

## Packaging compatibility and maintenance

The tracked executor patch fixes dependency-root discovery when export maps use
an unnamed intermediate `package.json`, and allows explicit
`licenses/<encoded-package-name>.txt` supplements when an npm archive omits its
licence. It also exports configuration schemas in input mode, so host registration accepts fields the executor supplies defaults for. Missing notices still fail the build. Google plugins retain upstream
licence texts and source receipts in `licenses/`. Runtime dispatch is unchanged.

OrgSDK grants Apache-2.0 for the specific embedded dependency loader incorporated
from executor 0.1.0 into these plugin distributions, as recorded in `NOTICE`.
That permission does not relicense the rest of the executor/platform. Third-party
licences remain intact. The published executor is used as development tooling.

Canonical scripts, patch and baseline workflows live in
`OrgSDK/plugins/scripts/plugin-ci-templates/`. Each plugin retains independent
copies and its own fixture, so no sibling repository is needed in CI. This
plugin's `publish-npm.yml` deliberately uses the reviewed stage-only OIDC path
above instead of the baseline token publisher; do not overwrite that release
policy with an unreviewed template sync:

```sh
node scripts/sync-plugin-ci.mjs --root=..
node scripts/sync-plugin-ci.mjs --root=.. --check
```

When changing an advertised function, add successful headless coverage. Bump
matching package/manifest versions before releasing changed bytes; npm versions
cannot be overwritten.
