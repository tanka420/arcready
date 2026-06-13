# ArcReady Public Launch Readiness Checklist

This checklist verifies that ArcReady is ready to be shared publicly as an MVP.

The goal is not to make ArcReady perfect. The goal is to make sure the repository is clear, credible, usable, and not misleading.

## 1. Repository Basics

* [ ] Repository name is clear: `arcready`
* [ ] Repository description is added
* [ ] Repository topics are added
* [ ] Repository visibility is correct
* [ ] README is visible on the repository homepage
* [ ] Social preview image is set
* [ ] No generated report files are committed
* [ ] No local-only files are committed
* [ ] No secrets, tokens, or private config files are committed

Recommended topics:

```text
arc
circle
web3
evm
wallet
bridge
app-kit
ci
quality-gate
typescript
github-actions
developer-tools
```

## 2. README

* [ ] README explains what ArcReady is
* [ ] README explains why Arc-specific validation matters
* [ ] README clearly says the project is an MVP
* [ ] README does not claim npm publishing is available yet
* [ ] README does not claim GitHub Marketplace publishing is available yet
* [ ] README includes local development commands
* [ ] README includes demo fixture command
* [ ] README includes GitHub Action usage
* [ ] README includes v1 non-goals
* [ ] README badges render correctly
* [ ] README links work

Important claims to avoid:

* Do not say ArcReady is an official Arc or Circle product.
* Do not say ArcReady is production hardened.
* Do not say the npm package is published until it actually is.
* Do not say the GitHub Action is available on Marketplace until it actually is.

## 3. Local Validation

Before sharing publicly, run:

```bash
corepack pnpm build
corepack pnpm test
corepack pnpm lint
corepack pnpm demo:fixtures
```

Expected result:

* [ ] Build passes
* [ ] Test suite passes
* [ ] Lint passes
* [ ] Fixture demo passes
* [ ] Good fixtures pass
* [ ] Bad fixtures produce expected findings

Current expected test status:

```text
114 tests passing
```

## 4. GitHub Actions

* [ ] GitHub Actions workflow runs on push
* [ ] ArcReady workflow passes
* [ ] Job summary shows ArcReady report
* [ ] Score is shown
* [ ] Status is shown
* [ ] Summary table is shown
* [ ] Report artifacts are uploaded
* [ ] Workflow does not fail due to missing report files
* [ ] Workflow does not rely on unpublished npm package behavior

Known non-blocking warning:

```text
GitHub may show Node.js 20 deprecation warnings for actions/checkout@v4 or actions/upload-artifact@v4.
```

This is not a launch blocker if the workflow still passes.

## 5. Release

* [ ] Tag `v0.1.0-mvp` exists
* [ ] Release `ArcReady v0.1.0 MVP` exists
* [ ] Release notes explain what is included
* [ ] Release notes explain what is not included
* [ ] Release does not overclaim production readiness
* [ ] Release links back to repository

## 6. Roadmap

* [ ] Roadmap issues are created
* [ ] Roadmap document exists
* [ ] v0.2 direction is clear
* [ ] Roadmap focuses on rule precision and adoption readiness
* [ ] Roadmap does not introduce SaaS/dashboard scope creep

Recommended current roadmap issues:

* Improve rule precision for wallet checks
* Add more Arc App Kit integration examples
* Prepare npm package publishing
* Prepare GitHub Marketplace action publishing

## 7. Demo Materials

* [ ] Demo script exists
* [ ] Demo recording checklist exists
* [ ] Launch post draft exists
* [ ] Fixture demo command works
* [ ] GitHub Action summary is available for screenshot/demo
* [ ] No private local files are visible in demo materials

Demo command:

```bash
corepack pnpm demo:fixtures
```

Expected final line:

```text
Result: PASS
```

## 8. Scope Control

ArcReady v0.1.0 MVP should not include:

* [ ] hosted dashboard
* [ ] database
* [ ] auth
* [ ] telemetry
* [ ] SaaS workspace
* [ ] plugin marketplace
* [ ] runtime bridge simulation
* [ ] generic multi-chain abstraction
* [ ] paid plans
* [ ] user accounts

If any of these appear in the repo, README, release notes, or roadmap as near-term committed features, revise the wording.

## 9. Brand / Positioning

* [ ] ArcReady has its own project identity
* [ ] ArcReady does not use the official Arc logo as its own logo
* [ ] ArcReady does not imply official endorsement by Circle or Arc
* [ ] Social preview is readable at small size
* [ ] Visual style is clean and developer-tool focused

Suggested positioning:

```text
ArcReady is an open-source Arc-specific CI quality gate and integration validator.
```

Avoid positioning like:

```text
The official Arc validator
The Arc certification tool
The complete Arc security platform
```

## 10. Final Pre-share Check

Run:

```bash
git status
```

Expected:

```text
nothing to commit, working tree clean
```

Check GitHub:

* [ ] README looks good
* [ ] Action badge is green
* [ ] Release is visible
* [ ] Issues are visible
* [ ] Social preview is set
* [ ] No obvious broken links
* [ ] No accidental private files

## Launch Decision

ArcReady is ready to share publicly when:

* local validation passes
* GitHub Action passes
* README is clear
* release exists
* roadmap exists
* no generated/private files are committed
* scope is clear
* MVP limitations are honestly stated

Final status:

```text
ArcReady v0.1.0 MVP is ready for public sharing.
```
