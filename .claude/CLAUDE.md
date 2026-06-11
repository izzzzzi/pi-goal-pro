# pi-goal-pro — Project Instructions for AI Agent

## Git Workflow

1. **Feature branches only**: All work in `feature/<name>` branches
2. **Conventional commits**: `type(scope): description` (types: feat, fix, docs, style, refactor, perf, test, chore, ci, build)
3. **Small commits**: One logical change per commit
4. **PRs required**: Every merge to main must be a PR
5. **Review self**: Run review loop before creating PR
6. **Update CHANGELOG**: Under `[Unreleased]` section

## Development Loop

When implementing a feature:
1. `nanny init "description"` — Initialize task tracking
2. `nanny add "subtask" --check "npm test"` — Break into tasks
3. Commit each logical change with conventional commit message
4. `npm test` — Run tests
5. `npm run check` — Run lint + format + typecheck
6. `nanny done/fail` — Update task status
7. Create PR when all checks pass

## Before Release

1. Update `VERSION` file
2. Update `CHANGELOG.md` (move [Unreleased] to version)
3. Commit as `chore(release): v1.2.3`
4. Tag as `v1.2.3`
5. Push tag: `git push origin main --tags`

## Code Style

- TypeScript strict mode
- Biome for linting/formatting
- Single quotes, tabs, 120 line width
- ESM modules (`import`/`export`)
- No `any` types — prefer `unknown`
- Unit tests with `node:test` in `tests/`
