# Open Source Checklist

## Must Be True Before Public Launch

- [ ] Rotate any npm tokens or credentials that may have been stored locally or committed previously.
- [ ] Review git history for secrets, not just the current working tree.
- [ ] Confirm the canonical GitHub repo slug and keep `repository`, `homepage`, and `bugs` fields aligned.
- [ ] Make sure `pnpm run build` succeeds from `sdk/`.
- [ ] Make sure `pnpm run test` succeeds from `sdk/`.
- [ ] Run `npm pack --dry-run` for every published package and confirm the tarball contents look correct.
- [ ] Verify every published package includes a `README.md`, `LICENSE`, and the intended entrypoints.
- [ ] Confirm each package that should remain private is still marked `"private": true`.
- [ ] Enable npm account 2FA and configure CI/release credentials with least privilege.
- [ ] Decide whether to enable npm provenance for releases.

## Community Files

- [x] `CONTRIBUTING.md`
- [x] `CODE_OF_CONDUCT.md`
- [x] `SECURITY.md`
- [x] `SUPPORT.md`
- [x] Issue templates
- [x] Pull request template

## Contribution Policy

- [x] MIT license is in place.
- [x] No CLA is required by default.
- [ ] Optional: enable DCO / commit signoff if you want lightweight provenance for contributions.

## After Launch

- [ ] Turn on branch protection for the default branch.
- [ ] Add CI required checks for build, test, and publish-shape verification.
- [ ] Add labels, milestones, and issue triage rules.
- [ ] Decide whether to enable GitHub Discussions for support questions.
