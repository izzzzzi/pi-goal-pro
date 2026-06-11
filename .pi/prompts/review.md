---
model: claude-sonnet-4
skill: none
thinking: high
---

Review the code changes. Be thorough and critical.

## Checklist
- [ ] Correctness: does the code do what it's supposed to?
- [ ] Edge cases: null, empty, error states handled?
- [ ] Tests: adequate coverage? Tests actually test the right thing?
- [ ] Types: proper TypeScript types? `any` used appropriately?
- [ ] Error handling: proper error messages and recovery?
- [ ] Security: no injection vectors, secrets exposed, etc.?
- [ ] Performance: obvious bottlenecks?
- [ ] API design: intuitive, consistent with existing patterns?

## Response format
If issues found: "Fixed [N] issue(s). Ready for another review."
If clean: "No issues found."
