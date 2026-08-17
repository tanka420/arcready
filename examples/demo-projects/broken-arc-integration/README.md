# Broken Arc Integration Demo

This is intentionally broken demo code for recording ArcReady v0.3.0.

It resembles a small Arc wallet, bridge, and App Kit integration, but it includes common static mistakes so ArcReady can show useful findings in a public demo.

The project is static only. Its retained Foundry JSON is test evidence, not a
claim about a live deployment. It does not call live Arc RPCs, Circle APIs,
bridge services, or App Kit runtime APIs.

## Reproducible before/after demo

From the repository root, run:

```powershell
corepack pnpm demo:fixtures
```

The broken project must fail with at least one critical finding and include all
six required findings:

- `wallet/ARC_CHAIN_METADATA`
- `wallet/NO_BLOB_TX_ON_ARC`
- `bridge/CCTP_DOMAIN_26`
- `app-kit/APPKIT_CHAIN_IDENTIFIER_VALID`
- `wallet/PREVRANDAO_NOT_SUPPORTED`
- `bridge/NO_PREVRANDAO_RELAY_SELECTION`

Additional findings may also be shown. The companion fixed project must pass
with score 100 and zero findings.

## Standalone ArcReady scan

```powershell
npx --yes arcready@0.3.0 scan .
npx --yes arcready@0.3.0 scan --format html --out arcready-report.html
```

The standalone scan has the same broken-project expectation: fail, at least one
critical finding, and all six required rule IDs above.
