# Release Process

This document describes how to create releases for KubeView MCP.

## Quick Release

For a complete release with all quality checks and tagging:

```bash
npm run release
```

This single command will:
1. ✅ **Check git status** - Ensure working directory is clean
2. ✅ **Run quality assurance** - Lint, typecheck, and test the codebase
3. ✅ **Build the project** - Compile TypeScript to JavaScript
4. ✅ **Create git tag** - Tag the current version for release

## Step-by-Step Release

If you need more control, you can run individual release steps:

### 1. Pre-release Validation
```bash
npm run release:check
```
Ensures your git working directory is clean (no uncommitted changes).

### 2. Quality Assurance
```bash
npm run release:qa
```
Runs the complete QA pipeline:
- `npm run lint` - ESLint validation
- `npm run typecheck` - TypeScript compilation check
- `npm run test` - Full test suite (261 tests)

### 3. Build
```bash
npm run release:build
```
Compiles the project with `tsc` to the `dist/` directory.

### 4. Create Git Tag
```bash
npm run release:tag
```
Creates a git tag with the current version from `package.json` (e.g., `v1.0.0`).

## Version Management

### Updating Version
Before releasing, update the version in `package.json`:

```json
{
  "version": "1.0.1"
}
```

### Version Conventions
We follow [Semantic Versioning](https://semver.org/):
- **Major** (1.0.0 → 2.0.0): Breaking changes
- **Minor** (1.0.0 → 1.1.0): New features, backwards compatible
- **Patch** (1.0.0 → 1.0.1): Bug fixes, backwards compatible

## Publishing to npm

The release scripts prepare the project but do not automatically publish to npm.

To publish manually after a successful release:

```bash
# Login to npm (if not already logged in)
npm login

# Publish the package
npm publish
```

## Release Checklist

Before running `npm run release`:

- [ ] Update version in `package.json`
- [ ] Update `CHANGELOG.md` with new features/fixes
- [ ] Ensure all changes are committed to git
- [ ] Verify tests pass: `npm test`
- [ ] Check the build works: `npm run build`

## Troubleshooting

### "Working directory not clean" Error
If `release:check` fails:
```bash
# Check what files have changes
git status

# Either commit the changes
git add .
git commit -m "Prepare for release"

# Or stash them
git stash
```

### Test Failures
If `release:qa` fails during testing:
```bash
# Run tests individually to debug
npm run test -- --verbose

# Fix any failing tests, then retry
npm run release:qa
```

### Build Errors
If `release:build` fails:
```bash
# Check TypeScript errors
npm run typecheck

# Fix any compilation issues, then retry
npm run release:build
```

## Advanced Usage

### Dry Run
To see what the release would do without making changes:
```bash
# Check git status (safe to run)
npm run release:check

# Run QA checks (safe to run)
npm run release:qa

# Build project (creates dist/ but no tags)
npm run release:build
```

### Manual Tag Creation
If you need to create a tag manually:
```bash
# Create tag for current version
git tag v$(node -p "require('./package.json').version")

# Push tag to remote
git push origin v$(node -p "require('./package.json').version")
```

## Release History

See [CHANGELOG.md](CHANGELOG.md) for detailed release history.
