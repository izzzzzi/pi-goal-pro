
<p align="center">
  <img src="https://img.shields.io/badge/pi-extension-8B5CF6?style=flat-square&logo=pi-hole&logoColor=white" alt="pi extension">
  <img src="https://img.shields.io/npm/v/pi-goal-pro?style=flat-square&color=cb3837" alt="npm">
  <img src="https://img.shields.io/github/actions/workflow/status/izzzzzi/pi-goal-pro/test.yml?style=flat-square&branch=main" alt="CI">
  <img src="https://img.shields.io/badge/license-MIT-green?style=flat-square" alt="MIT">
</p>

# pi-goal-pro 🎯

> Persistent autonomous goals for [Pi](https://pi.dev) — with no-progress detection, evidence-based completion, token budgets, and auto-continuation.

Set a long-running objective and let the agent work autonomously until it's done, paused, or blocked — without you having to re-prompt every turn.

```bash
/goal Refactor the auth module to use JWT with proper error handling
```

Then walk away. The agent keeps going. When it's done, it reports with evidence.

---

## Installation

### Via npm (recommended)

```bash
pi install npm:pi-goal-pro
/reload
```

### Manual

```bash
mkdir -p ~/.pi/agent/extensions/pi-goal-pro
cp ./index.ts ~/.pi/agent/extensions/pi-goal-pro/
/reload
```

Verify it's loaded:

```
/goal status
```

---

## Quick Start

Set a goal and let the agent work:

```text
/goal Add retry logic to the API client with exponential backoff
```

The agent starts working immediately. Watch the status bar:

```
🎯 goal active (1.2K/50K)    ← footer status while the agent works
```

Manage the goal lifecycle:

```text
/goal status        # Show current goal state
/goal pause         # Pause the active goal
/goal resume        # Resume a paused goal
/goal clear         # Clear all goals
```

---

## Features

### 🎯 Goal Setting

```text
/goal Refactor the auth module

# With a token budget (auto-pauses when exceeded):
/goal Refactor the auth module --tokens 100k

# With a max auto-continue turn limit:
/goal Refactor the auth module --max-turns 10

# Combine them:
/goal Refactor the auth module --tokens 50k --max-turns 20
```

### 🤖 Agent Tools

Once a goal is active, the agent gets two tools:

**`get_goal`** — Read the current goal state:

```json
{
  "active": {
    "objective": "Refactor the auth module to use JWT",
    "status": "active",
    "tokens_used": 12400,
    "token_budget": 50000,
    "remaining_tokens": 37600,
    "time_used_seconds": 89,
    "auto_turns": 3,
    "max_auto_turns": 25
  }
}
```

**`update_goal`** — Mark complete or unmet (with evidence/blocker):

```typescript
// Complete — requires evidence
update_goal({
  status: "complete",
  evidence: "JWT middleware implemented, 12 tests passing, no regressions in CI"
})

// Unmet — requires a blocker
update_goal({
  status: "unmet",
  blocker: "Blocked on JWT library decision — waiting for security review"
})
```

### 🔄 Auto-Continuation

After each agent turn, the extension automatically sends a continuation prompt if:
- The goal is still `active`
- The previous turn was goal-driven
- The user hasn't typed anything (which suspends auto-continuation)
- No limits have been hit

### 🛡️ No-Progress Detection

If the agent generates very low output (default: <50 tokens) for 2 consecutive turns, the goal auto-pauses with a warning:

```
⏸ Goal paused (no progress for 2 turns). Use /goal resume to continue.
```

This prevents infinite loops where the agent keeps acknowledging without making progress.

### 💰 Token Budget

Set a token budget with `--tokens`:

```text
/goal Write documentation for all API endpoints --tokens 100k
```

When the budget is exhausted, the goal auto-pauses with a wrap-up prompt so the agent summarizes what was done and what remains.

### 📋 Evidence-Based Completion

The agent must provide concrete evidence before marking a goal complete. This prevents premature "done" claims and ensures real verification against files, tests, and command output.

---

## Commands

| Command | Description |
|---------|-------------|
| `/goal <objective>` | Set a new goal (replaces active with confirmation) |
| `/goal <text> --tokens N` | Set a goal with a token budget |
| `/goal <text> --max-turns N` | Set a goal with a max auto-turn limit |
| `/goal status` | Show current goal state |
| `/goal pause` | Pause the active goal |
| `/goal resume` | Resume a paused goal |
| `/goal clear` | Clear all goals |
| `/goal help` | Show help |
| `/goal config` | Show current configuration |

---

## Configuration

Set these at the top of `index.ts` if you need to tune behavior:

| Setting | Default | Description |
|---------|---------|-------------|
| `maxAutoTurns` | `25` | Max auto-continue turns before auto-pause |
| `noProgressTokenThreshold` | `50` | Output tokens below this = "no progress" |
| `maxNoProgressTurns` | `2` | Consecutive no-progress turns before auto-pause |
| `minContinueIntervalMs` | `3000` | Debounce interval between continuations |

---

## How It Works

```
/goal Refactor auth module
        │
        ▼
  ✓ Goal created & saved as session entry
  ✓ Agent gets get_goal + update_goal tools
  ✓ First continuation fires immediately
        │
        ▼
  ┌── Auto-continuation loop ──────────────────┐
  │                                            │
  │  turn_start → turn_end → agent_end         │
  │                               │            │
  │                     ┌─────────┴─────────┐  │
  │                     │ Goal still active? │  │
  │                     │ No progress?       │  │
  │                     │ User suspended?    │  │
  │                     │ Budget exhausted?  │  │
  │                     │ Max turns reached? │  │
  │                     └─────────┬─────────┘  │
  │                               │            │
  │                    ┌──────────┴──────────┐ │
  │                    │ Yes → send          │ │
  │                    │       continuation  │ │
  │                    │ No → stop / pause   │ │
  │                    └─────────────────────┘ │
  │                                            │
  └────────────────────────────────────────────┘
        │
        ▼
  Agent calls update_goal({ status: "complete", evidence })
  → Goal archived, agent stops
```

### State Persistence

Goal state is stored in Pi session entries (custom type `pi-goal-pro`). It survives:
- Session reloads (`/reload`)
- Compaction
- Tree navigation (`/tree`)
- Session resume

State is branch-local — navigating to a different branch restores that branch's goal state.

---

## Design Philosophy

1. **User owns intent** — The agent can't silently change the goal. Objective is set by the user.
2. **Evidence before completion** — The agent must verify against real artifacts, not just claim "done".
3. **No infinite loops** — No-progress detection, max turns, and token budgets prevent runaway agents.
4. **User input suspends** — When you type something, auto-continuation pauses automatically. No interference.
5. **Branch-local state** — Goal state follows session branches. `/tree` to a different point and you get that point's goals.

---

## Comparison

| Feature | pi-goal-pro | Michaelliv/pi-goal | capyup/pi-goal | opencode-goal-plugin |
|---------|------------|-------------------|----------------|---------------------|
| No-progress detection | ✅ | ❌ | ❌ | ✅ |
| Evidence/blocker required | ✅ | ❌ | ❌ | ✅ |
| Token budget | ✅ | ✅ | ✅ | ✅ |
| Max auto-turns | ✅ | ❌ | ❌ | ✅ |
| Auto-continuation | ✅ | ✅ | ✅ | ✅ |
| User input suspends | ✅ | ❌ | ❌ | ❌ |
| Session entry persistence | ✅ | ✅ | ✅ | N/A |
| Compaction survival | ✅ | ✅ | ✅ | N/A |
| Footer status bar | ✅ | ✅ | ✅ | N/A |
| Multiple goals (queue) | ✅ (paused) | ✅ (FIFO) | ✅ (focus) | ❌ |

---

## Development

Built as a single-file Pi extension — no build step required. Edit `index.ts`, then `/reload`.

To run without installing:

```bash
pi -e ~/.pi/agent/extensions/pi-goal-pro/index.ts
```

---

## Credits

Inspired by and building upon:
- [Michaelliv/pi-goal](https://github.com/Michaelliv/pi-goal) — Clean architecture and session persistence patterns
- [capyup/pi-goal](https://github.com/capyup/pi-goal) — Immutable objective, completion audit concepts
- [prevalentWare/opencode-goal-plugin](https://github.com/prevalentWare/opencode-goal-plugin) — No-progress detection, evidence requirements

---

## License

MIT
