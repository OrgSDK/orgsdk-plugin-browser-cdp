# Changelog

## 0.1.2 (unreleased)

- Correct npm consumer installation, connection credentials and release workflow instructions.
- Replace obsolete proprietary wording with the plugin's Apache-2.0 licensing contract.
- Document the pinned Playwright test prerequisite and separate remote-browser execution from local browser installation.
- Point package discovery to the Browser CDP page. Runtime operations are unchanged.

## 0.1.1 (unreleased)

- Pin the authoring/execution packages to 0.2.2/0.1.0, with the tracked executor packaging fixes.
- Build a restricted npm distribution and verify every exported function from the packed artifact through the headless executor.
- Add versioned npm release CI that publishes the exact tested tarball after explicit repository activation.
- Pin Playwright to 1.64.1 and exercise the plugin with matching headless Chromium.
