# Historical v0.3.0 npm Publish Checklist

Status: Completed historical record

ArcReady v0.3.0 was published on 2026-06-13. This document records that release
candidate and must not be reused to publish the same immutable version. Prepare
a new versioned checklist after a separately approved release selects the next
candidate.

## Package

| Field        | Value      |
| ------------ | ---------- |
| Package name | `arcready` |
| Version      | `0.3.0`    |
| License      | MIT        |
| Node.js      | `>=22`     |
| CLI bin      | `arcready` |

## Gate Results

| Check              | Status                                                                       |
| ------------------ | ---------------------------------------------------------------------------- |
| npm package status | `arcready@0.3.0` was published on 2026-06-13                                 |
| npm login          | `npm whoami` returned `ENEEDAUTH`; npm login is required before real publish |
| Build              | Passed                                                                       |
| Test               | Passed                                                                       |
| Lint               | Passed                                                                       |
| Fixture validation | Passed                                                                       |
| Package smoke test | Passed                                                                       |
| Publish dry-run    | Passed                                                                       |

## Package Contents

The publish dry-run includes only the expected package files:

```text
README.md
dist/bin.d.ts
dist/bin.js
dist/chunk-*.js
dist/index.d.ts
dist/index.js
package.json
```

## Commands Used for the Historical Candidate

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

## Historical Publish Command

The following command belonged to the completed v0.3.0 release and must not be
run again for that version:

```powershell
cd packages/arcready
npm publish --access public
```

For any future release, first select a new version and create a new checklist.
Before an explicitly approved publish, verify npm login:

```powershell
npm whoami
```
