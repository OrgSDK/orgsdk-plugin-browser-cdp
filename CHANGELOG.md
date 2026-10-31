# Changelog

## 0.1.1 (unreleased)

- Pin the authoring/execution packages to 0.2.2/0.1.0, with the tracked executor packaging fixes.
- Build a restricted npm distribution and verify every exported function from the packed artifact through the headless executor.
- Add versioned npm release CI that publishes the exact tested tarball after explicit repository activation.
- Pin Playwright to 1.64.1 and exercise the plugin with matching headless Chromium.
