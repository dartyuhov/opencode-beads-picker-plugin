# OpenCode plugin publishing best practices

This note records the publishing guidance used for
`opencode-beads-picker-plugin`. It reflects the official OpenCode and npm
documentation and the OpenCode plugin loader source available on September 15,
2026.

## OpenCode package shape

OpenCode loads npm server plugins from the `plugin` array in `opencode.json`.
It installs npm plugins and their dependencies automatically with Bun and
caches them under OpenCode's cache directory. The official plugin guide shows
both unscoped and scoped package names.

Source: [OpenCode plugins](https://opencode.ai/docs/plugins)

TUI plugins use a separate `tui.json` file with the TUI schema and its own
`plugin` array. A package that supports both targets must expose separate
target entrypoints, because the server and TUI loaders resolve different
package targets.

Sources:

- [OpenCode configuration](https://opencode.ai/docs/config)
- [TUI plugin specification](https://github.com/anomalyco/opencode/blob/a97622c801f4ca571530ddc51076af659a9c32cd/packages/opencode/specs/tui-plugins.md)

The current TUI module contract is a default-exported object containing a
`tui` function. Named TUI exports are ignored. A package can omit the module
`id` for npm installation because OpenCode uses the npm package name as the
identity; file-based plugins must provide an ID.

Source: [OpenCode plugin loader](https://github.com/anomalyco/opencode/blob/a97622c801f4ca571530ddc51076af659a9c32cd/packages/opencode/src/plugin/shared.ts)

Use package exports that map `./server` and `./tui` to target-specific files.
When a package has an `exports` map, OpenCode does not use the package root
export as a fallback for the TUI target. OpenCode can use `main` as a server
fallback, so a dual-target package benefits from both explicit subpaths and a
server `main` entrypoint.

Source: [OpenCode plugin resolution](https://github.com/anomalyco/opencode/blob/a97622c801f4ca571530ddc51076af659a9c32cd/packages/opencode/src/plugin/shared.ts)

Declare the supported OpenCode range in `engines.opencode`. The npm plugin
loader checks this range for npm packages and skips incompatible plugins with a
warning. Keep the range aligned with the APIs and runtime versions tested by
the project.

Source: [OpenCode TUI plugin specification](https://github.com/anomalyco/opencode/blob/a97622c801f4ca571530ddc51076af659a9c32cd/packages/opencode/specs/tui-plugins.md)

## npm package practices

The npm manifest needs a unique `name` and valid `version`. A useful
`description`, `keywords`, `repository`, `bugs`, `homepage`, `license`, and
explicit `files` list improve package discovery and make the published surface
intentional. npm also recommends reviewing the packed contents before
publishing.

Sources:

- [npm package.json reference](https://docs.npmjs.com/cli/v11/configuring-npm/package-json)
- [npm publishing documentation](https://docs.npmjs.com/cli/v11/commands/npm-publish)

OpenCode installs npm plugins without running package lifecycle scripts. A
TypeScript plugin must therefore publish its compiled JavaScript and
declarations rather than depend on `postinstall` or another installation-time
build. A `files` allowlist and `npm pack --dry-run` check make omissions visible
before release.

Source: [OpenCode TUI plugin specification](https://github.com/anomalyco/opencode/blob/a97622c801f4ca571530ddc51076af659a9c32cd/packages/opencode/specs/tui-plugins.md)

For reproducible project configuration, pin the package version in
`opencode.json` and `tui.json`. OpenCode's documentation supports bare package
names, but an explicit package version avoids silently changing the plugin
version when the cache is refreshed.

Source: [OpenCode TUI plugin specification](https://github.com/anomalyco/opencode/blob/a97622c801f4ca571530ddc51076af659a9c32cd/packages/opencode/specs/tui-plugins.md)

## GitHub and npm automation

npm Trusted Publishing is the preferred release authentication method for
GitHub Actions because it uses short-lived OIDC credentials instead of a
long-lived npm token. The workflow needs `id-token: write`, a GitHub-hosted
runner, npm CLI `11.5.1` or newer, and Node.js `22.14.0` or newer. Trusted
publishing also generates npm provenance automatically for public packages
published from public repositories.

Source: [npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers)

The trusted publisher configuration must match the GitHub user, repository, and
workflow filename exactly. The release workflow should install dependencies,
build the package, run tests, inspect the package contents, and only then run
`npm publish`.

Sources:

- [npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers)
- [Publishing Node.js packages with GitHub Actions](https://docs.github.com/en/actions/publishing-packages/publishing-nodejs-packages)

## Repository decisions

This repository follows the guidance above in these ways:

- `package.json` exposes `./server`, `./tui`, and `./shared` and uses `main` for the server fallback.
- `src/tui.tsx` default-exports a TUI module object with a stable plugin ID.
- `engines.opencode` declares `>=1.18.23 <2.0.0`.
- `dist` is built before packing, and the pack check verifies runtime entrypoints and release documents.
- The npm tarball excludes source files, tests, configuration examples, and the lockfile.
- CI tests Node and Bun paths separately and checks the package before release.
- The publish workflow uses npm Trusted Publishing and skips versions already present on npm.

## Release checklist

Complete these steps for the first public release:

1. Create the public GitHub repository `dartyuhov/opencode-beads-picker-plugin`.
2. Configure npm Trusted Publishing for `publish.yml`.
3. Push the repository's `main` branch and confirm CI passes.
4. Increment `version` for each subsequent release.
5. Push the release commit and confirm the package appears on npm.
6. Test installation with `opencode plugin opencode-beads-picker-plugin@<version>`.
