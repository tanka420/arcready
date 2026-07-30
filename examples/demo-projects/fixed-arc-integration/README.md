# Fixed Arc Integration Demo

This is the corrected companion project for the ArcReady v0.3.0 demo.

It uses the same wallet, bridge, and App Kit integration ideas as the broken demo, but with static patterns corrected so ArcReady can show a clean scan.

The project is a static reference only, not proof of runtime behavior. It does
not call live Arc RPCs, Circle APIs, bridge services, or App Kit runtime APIs.

## Reproducible before/after demo

From the repository root, run:

```powershell
corepack pnpm demo:fixtures
```

The exact fixed-project expectation is status pass, score 100, and zero
critical, warning, info, or total findings.

## Standalone ArcReady scan

```powershell
npx --yes arcready@0.3.0 scan .
npx --yes arcready@0.3.0 scan --format html --out arcready-report.html
```

Expected result: pass, score 100, and zero findings.
