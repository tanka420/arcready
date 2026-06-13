# npm Publishing

ArcReady is being prepared for npm publishing as an installable CLI package.

## Current Package

| Field | Value |
| --- | --- |
| Package name | `arcready` |
| Version | `0.2.0` |
| License | MIT |
| Node.js | `>=22` |
| CLI bin | `arcready` |

The npm package should include only:

```text
dist/
README.md
package.json
```

Do not commit generated `.tgz` package artifacts.

## Readiness Checks

Run these from the repository root before any release approval:

```bash
corepack pnpm build
corepack pnpm test
corepack pnpm lint
corepack pnpm validate:fixtures
corepack pnpm smoke:package
```

The smoke test builds and packs the package, installs the generated tarball in a temporary npm project, runs `npx arcready --help`, runs `npx arcready init`, runs terminal and JSON scans, verifies the package metadata version in terminal output, and verifies JSON output parses.

## Dry Run

Run the npm publish dry run from the package directory:

```bash
cd packages/arcready
npm publish --dry-run
```

Inspect the output before release. The dry run should show `arcready@0.2.0` and only the expected package files.

## Before Real Publish

Verify npm login and account/package permissions before any real publish:

```bash
npm whoami
```

Confirm the package name is still available or owned by the project:

```bash
npm view arcready
```

## Do Not Run This Until Release Approval

The real publish command is not part of this task:

```bash
npm publish
```

Do not run `npm publish` without explicit release approval.

## Rollback Caution

npm unpublish and deprecation behavior is constrained and should not be treated as a normal rollback path. Prefer validating with `npm publish --dry-run`, `corepack pnpm smoke:package`, and a clean release checklist before publishing.
