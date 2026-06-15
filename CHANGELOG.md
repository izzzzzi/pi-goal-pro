# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.3.0] - 2026-06-15

### Added
- **Criteria-based evidence mapping (G2):** Goals now support `--criteria "a|b|c"` flag.
  Agent submits evidence per criterion via `update_goal({ criterionId, evidence })`.
  Completion is rejected until every criterion has ≥1 evidence — structural defense
  against proxy-signal collapse.
- **Drift detection (G3):** Tracks consecutive non-goal turns while a goal is active.
  After `driftThreshold` (default: 4) turns, goal auto-pauses with drift warning.
- **Abort reason differentiation (G6):** `agentAbortReason()` returns
  `'aborted' | 'api_error' | null`. API errors no longer permanently suspend
  goal continuation — agent retries on next timer.

### Changed
- `GoalState` now includes `criteria: CriterionState[]`, `driftCount: number`,
  `abortReason?: 'aborted' | 'api_error'`
- `GoalConfig` now includes `driftThreshold: number` (default: 4)
- `reconstruct()` migrates old persisted state (missing fields get defaults)

## [1.2.1] - 2026-06-15

### Fixed

### Fixed
- `agent_end` handler no longer shows "Goal continuations suspended" notification when no
  active goal exists, preventing false-positive interruptions on API errors

## [1.2.0] - 2026-06-11

### Added
- `.claude/CLAUDE.md` — agent instructions with git workflow and code style guide
- `.pi/prompts/commit.md` — AI prompt template for conventional commit messages
- `.pi/prompts/review.md` — AI prompt template for code review with checklist
- `VERSION` file — single source of truth for version number
- `.gitattributes` — consistent line endings (LF) and diff settings
- `.githooks/pre-commit` — Biome check on staged files before each commit
- `.githooks/commit-msg` — Enforce conventional commit format on each commit
- `prepare` script — auto-configures git hooks path on `npm install`
- `typecheck` script — `tsc --noEmit` for TypeScript validation
- `check:all` script — runs both Biome check and typecheck
- `lint-staged` config in package.json for pre-commit checks

### Changed
- **CI workflow**: renamed from `test.yml`, now with `concurrency` group and `cancel-in-progress: true`
- **CI split into two jobs**: `quality` (lint + typecheck) and `test` (unit tests on matrix)
- **CI matrix**: expanded to `os: [ubuntu-latest, macos-latest]` × `node: [20, 22]`
- **release.yml**: added tag-version verification, pre-release npm tag detection, `make_latest: true`
- `test:all` script now runs `check:all` (lint + format + typecheck) before tests
- README CI badge fixed to point to `test.yml` instead of non-existent `ci.yml`
- `.gitignore` expanded: added IDE files, logs, `.tgz`, coverage, `ideal-git-workflow.md`
- Fixed TypeScript `typeof theme` scoping error in index.ts

## [1.1.1] - 2026-06-11

### Added

- Separate `test.yml` (push/PR) and `release.yml` (tag + workflow_dispatch) CI/CD pipelines
- `CHANGELOG.md` following Keep a Changelog format
- `README.ru.md` — Russian language documentation
- `workflow_dispatch` trigger for manual releases
- `npm publish --provenance` for supply chain security

### Changed

- Split monolithic CI/CD into focused workflows (test quality vs. release)
- README installation order: npm install first, manual copy second
- Updated `.gitignore` to exclude `dist/` and `.env`
- Cleaner package.json scripts (`npm test` = only tests, `npm run test:all` = lint + tests)

### Fixed

- Biome linter warnings (non-null assertions → type casts)
- Message renderer cognitive complexity

## [1.1.0] - 2026-06-11

### Added

- 48 unit tests covering all pure functions
- Biome linter + strict TypeScript configuration
- GitHub Actions CI/CD pipeline

### Changed

- Split README into English (`README.md`) and Russian (`README.ru.md`)
- Simplified message renderer to reduce cognitive complexity

### Fixed

- Non-null assertion warnings in `parseTokenBudget` and `parseMaxAutoTurns`

## [1.0.1] - 2026-06-11

### Added

- Initial npm publish

## [1.0.0] - 2026-06-11

### Added

- `/goal <objective> [--tokens N] [--max-turns N]` command
- `get_goal` and `update_goal` tools for the agent
- Auto-continuation loop with no-progress detection
- Evidence-based completion (evidence/blocker required)
- Token budget tracking with auto-pause
- User input suspends auto-continuation
- Session entry persistence (survives reload, compaction, tree navigation)
- Footer status bar
- Bilingual README (English + Russian)
