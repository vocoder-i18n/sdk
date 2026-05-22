# Changesets - Vocoder SDK

This directory contains **changesets** - files that document changes to packages before they're published.

## What is a Changeset?

A changeset is a markdown file that describes:
1. Which packages changed
2. What type of change (patch/minor/major)
3. A summary of the changes

## Quick Usage

```bash
# 1. Create a changeset after making changes
pnpm changeset

# 2. Commit the changeset file
git add .changeset/
git commit -m "docs: add changeset for feature"

# 3. When ready to publish, bump versions
pnpm changeset version

# 4. Publish to npm
pnpm release
```

## Example Changeset File

After running `pnpm changeset`, a file like `.changeset/nice-lions-smile.md` is created:

```markdown
---
"@vocoder/react": minor
"@vocoder/cli": patch
---

Added msg prop for cleaner ICU MessageFormat syntax and fixed extraction bug
```

## Learn More

- [Changesets Documentation](https://github.com/changesets/changesets)
- [Vocoder SDK README](../README.md)
- [Contributing Guide](../CONTRIBUTING.md)
