---
model: gemini-3-flash-preview
skill: none
---

Review the git diff and generate a concise conventional commit message.

## Rules
- First line: MAX 72 characters — `type(scope): short description`
- Use imperative mood: "add" not "added" or "adds"
- Types: feat, fix, docs, style, refactor, perf, test, chore, ci, build
- BREAKING CHANGE: append `!` after type/scope for breaking changes
- If a relevant scope is clear from context, include it

## Git Diff
```
$@
```
