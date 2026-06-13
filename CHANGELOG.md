# Changelog

## v0.3.0 - Rule quality hardening

- Removed placeholder/internal no-op rules from the public API and default presets
- Improved wallet rule precision and false-positive handling
- Improved bridge rule precision and false-positive handling
- Improved App Kit static integration-pattern rule precision
- Added cross-preset regression coverage
- Improved finding messages and suggestions across all 18 active rules
- Preserved ArcReady's static CI quality gate scope

## v0.2.0 - External GitHub Action readiness

- Published `arcready@0.2.0`
- Added root GitHub Action metadata for external usage
- Added action smoke workflow
- Added GitHub Action usage documentation
- Added example external workflow
- Validated external GitHub Action usage with `uses: tanka420/arcready@v0.2.0`
- Kept ArcReady focused as a static CI quality gate
