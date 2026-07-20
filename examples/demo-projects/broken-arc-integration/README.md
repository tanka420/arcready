# Broken Arc Integration Demo

This is intentionally broken demo code for recording ArcReady v0.3.0.

It resembles a small Arc wallet, bridge, and App Kit integration, but it includes common static mistakes so ArcReady can show useful findings in a public demo.

The project is static only. It does not call live Arc RPCs, Circle APIs, bridge services, or App Kit runtime APIs.

## Role in the launch demo

Use this project as the realistic starting point. For the launch video, copy it into a temporary working directory, scan it, inspect the reported findings, and repair the flagged files using `../fixed-arc-integration` as the corrected reference state.

Files to open during the repair:

- `src/wallet/arc-wallet.ts`
- `src/bridge/cctp-bridge.ts`
- `src/app-kit/app-kit.ts`
- `arcready.config.json`

## Run ArcReady

```powershell
npx --yes arcready@0.3.0 scan .
npx --yes arcready@0.3.0 scan --format html --out arcready-report.html
```

Expected result: ArcReady should produce findings across the wallet and bridge presets, plus App Kit warnings.
