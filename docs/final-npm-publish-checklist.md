# Final npm Publish Checklist

ArcReady is prepared for a first npm publish as `arcready@0.1.0`.

Do not run the real publish command until the maintainer explicitly approves.

## Package

| Field | Value |
| --- | --- |
| Package name | `arcready` |
| Version | `0.1.0` |
| License | MIT |
| Node.js | `>=22` |
| CLI bin | `arcready` |

## Gate Results

| Check | Status |
| --- | --- |
| npm name availability | `npm view arcready` returned `E404 Not Found` |
| npm login | `npm whoami` returned `ENEEDAUTH`; npm login is required before real publish |
| Build | Passed |
| Test | Passed |
| Lint | Passed |
| Fixture validation | Passed |
| Package smoke test | Passed |
| Publish dry-run | Passed |

## Package Contents

The publish dry-run includes only the expected package files:

```text
README.md
dist/bin.d.ts
dist/bin.js
dist/bin.js.map
dist/chunk-B4MOC2YJ.js
dist/chunk-B4MOC2YJ.js.map
dist/index.d.ts
dist/index.js
dist/index.js.map
package.json
```

## Required Pre-Publish Commands

Run from the repository root:

```powershell
corepack pnpm build
corepack pnpm test
corepack pnpm lint
corepack pnpm validate:fixtures
corepack pnpm smoke:package
```

Run from the package directory:

```powershell
cd packages/arcready
npm publish --dry-run
```

## Do Not Run Until Release Approval

The real publish command has not been run yet. Use it only after explicit maintainer approval:

```powershell
cd packages/arcready
npm publish --access public
```

Before running the real publish, verify npm login:

```powershell
npm whoami
```
