# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
