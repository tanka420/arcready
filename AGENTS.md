# ArcReady Agent Instructions

ArcReady is an Arc-specific CI quality gate and integration validator.

For this repository:

- Keep changes small, direct, and CLI-first.
- Do not add a web app, database, auth, telemetry, hosted dashboard, or runtime RPC calls unless explicitly requested.
- Prefer TypeScript with strict types.
- Keep rule implementations separate from reporters, presets, scoring, and config.
- Real Arc validation rules are intentionally out of scope for the initial foundation.
