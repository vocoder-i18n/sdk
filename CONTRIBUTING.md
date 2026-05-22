# Contributing

Thanks for helping improve the Vocoder SDK.

## Before You Start

- Read the package README for the area you are changing.
- Keep secrets out of the repo. Never commit API keys, auth tokens, or `.env` files.
- For security issues, do not open a public issue. Follow [SECURITY.md](./SECURITY.md).

## Local Setup

```bash
pnpm install
pnpm run build
pnpm run test
```

Useful package-level commands:

```bash
pnpm --dir packages/react test
pnpm --dir packages/cli test
pnpm --dir packages/core build
```

## Making Changes

- Keep public package metadata accurate: `README.md`, `package.json`, exports, and changelog entries should match the code you ship.
- Add or update tests when behavior changes.
- If you change package behavior, add a changeset with `pnpm changeset`.
- Keep docs and examples aligned with the supported public API.

## Release Hygiene

Before publishing, make sure all of the following succeed from `sdk/`:

```bash
pnpm run build
pnpm run test
```

Then verify each package’s publish output with:

```bash
npm pack --dry-run
```

Run that from the package directory you plan to publish.

## Contribution Terms

We do not require a CLA at this time. By submitting a contribution, you agree that your contribution may be distributed under this repository’s MIT license.
