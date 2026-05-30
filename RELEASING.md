# Releasing

Coding Malo follows [Semantic Versioning](https://semver.org/): `MAJOR.MINOR.PATCH`.

- **PATCH** — bug fixes, no API/protocol change.
- **MINOR** — backward-compatible features (new tools, flags, config keys, additive headless events).
- **MAJOR** — breaking changes to the CLI surface, the [headless protocol](docs/headless-protocol.md),
  config schema, or session format.

## Single source of truth

The version lives in `package.json` only. `src/version.ts` imports it (inlined at build time), so
`--version` and the TUI banner always match. **Never edit `src/version.ts` by hand.**

## Steps

```bash
# 1. make sure everything is green
npm run typecheck && npm test && npm run e2e

# 2. move "## [Unreleased]" notes into a new dated section in CHANGELOG.md

# 3. bump (updates package.json, commits, and tags v<x.y.z>)
npm version patch        # or: minor | major

# 4. build so dist/ carries the new version, then push
npm run build
git push && git push --tags
```

`npm version` creates the commit and the `vX.Y.Z` tag. Because `prepublishOnly` runs `npm run build`,
a published package always ships a `dist/` with the correct version.

## Checklist

- [ ] typecheck + unit + e2e green
- [ ] `CHANGELOG.md` updated (new dated section; `[Unreleased]` emptied)
- [ ] version bumped via `npm version`
- [ ] `dist/` rebuilt
- [ ] tag pushed
- [ ] if the [headless protocol](docs/headless-protocol.md) changed, note it for the `oh-my-agent` adapter
