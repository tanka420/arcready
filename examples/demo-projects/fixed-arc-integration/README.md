# Fixed Arc Integration Demo

This is the corrected companion project for the ArcReady v0.3.0 demo.

It uses the same wallet, bridge, and App Kit integration ideas as the broken demo, but with static patterns corrected so ArcReady can show a clean or no-critical scan.

The project is static only. It does not call live Arc RPCs, Circle APIs, bridge services, or App Kit runtime APIs.

## Role in the launch demo

Use this project as the reference final state while repairing a temporary copy of `../broken-arc-integration`. The launch video should feel like one user workflow: scan a realistic integration, open the flagged files, apply the corrected patterns, and scan again until ArcReady passes.

Reference files:

- `src/wallet/arc-wallet.ts`
- `src/bridge/cctp-bridge.ts`
- `src/app-kit/app-kit.ts`
- `arcready.config.json`

## Run ArcReady

```powershell
npx --yes arcready@0.3.0 scan .
npx --yes arcready@0.3.0 scan --format html --out arcready-report.html
```

Expected result: ArcReady should pass or produce no critical findings.
