/**
 * pi-goal-pro — Persistent autonomous goals for Pi
 *
 * A production-quality /goal extension combining the best ideas from:
 *   - Michaelliv/pi-goal (clean event architecture, session persistence)
 *   - capyup/pi-goal (immutable objective, completion audit)
 *   - prevalentWare/opencode-goal-plugin (no-progress detection, evidence requirements)
 *
 * Features:
 *   - /goal <objective> [--tokens N]  — set a long-running goal
 *   - /goal pause / resume / clear / status — manage goals
 *   - get_goal tool — agent reads current goal
 *   - update_goal tool — agent marks complete (requires evidence)
 *   - Auto-continuation with no-progress detection
 *   - Token budget tracking
 *   - Evidence/blocker requirements on completion
 *   - Status bar footer
 *   - Session entry persistence (survives compaction & reload)
 *
 * Install: cp to ~/.pi/agent/extensions/pi-goal-pro/index.ts, then /reload
 */

import { StringEnum } from '@earendil-works/pi-ai';
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { matchesKey } from '@earendil-works/pi-tui';
import { Type } from 'typebox';

// ─── Types ───────────────────────────────────────────────────────────────

type GoalStatus = 'active' | 'paused' | 'complete' | 'unmet' | 'budget_limited';

interface GoalState {
	version: 1;
	id: string;
	objective: string;
	status: GoalStatus;
	tokenBudget: number | null;
	tokensUsed: number;
	timeUsedMs: number;
	createdAt: number;
	updatedAt: number;
	completionEvidence?: string;
	blocker?: string;
	/** How many consecutive low-output / no-progress turns we've seen */
	noProgressCount: number;
	/** Total auto-continue turns fired */
	autoTurnCount: number;
	/** Max auto-continue turns before forced pause */
	maxAutoTurns: number;
}

interface GoalEvent {
	kind: 'active' | 'continuation' | 'paused' | 'resumed' | 'cleared' | 'budget_limited' | 'complete' | 'unmet';
	goal: GoalState;
	timestamp: number;
}

interface GoalSnapshot {
	action:
		| 'set'
		| 'update'
		| 'clear'
		| 'complete'
		| 'unmet'
		| 'pause'
		| 'resume'
		| 'budget_limited'
		| 'no_progress_pause';
	goals: GoalState[];
	config: GoalConfig;
}

interface GoalConfig {
	maxAutoTurns: number;
	noProgressTokenThreshold: number;
	maxNoProgressTurns: number;
	minContinueIntervalMs: number;
}

// ─── Defaults ────────────────────────────────────────────────────────────

const GOAL_STORAGE_TYPE = 'pi-goal-pro';

const DEFAULTS: GoalConfig = {
	maxAutoTurns: 25,
	noProgressTokenThreshold: 50,
	maxNoProgressTurns: 2,
	minContinueIntervalMs: 3000,
};

const GOAL_FOOTER_ID = 'pi-goal-pro';

// ─── Helpers ─────────────────────────────────────────────────────────────

function formatTokens(v: number): string {
	if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(v >= 10_000_000 ? 0 : 1).replace(/\.0$/, '')}M`;
	if (v >= 1_000) return `${(v / 1_000).toFixed(v >= 10_000 ? 0 : 1).replace(/\.0$/, '')}K`;
	return String(v);
}

function formatDuration(ms: number): string {
	const total = Math.max(0, Math.floor(ms / 1000));
	const h = Math.floor(total / 3600);
	const m = Math.floor((total % 3600) / 60);
	const s = total % 60;
	if (h > 0) return `${h}h${String(m).padStart(2, '0')}m${String(s).padStart(2, '0')}s`;
	if (m > 0) return `${m}m${String(s).padStart(2, '0')}s`;
	return `${s}s`;
}

function goalId(): string {
	return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function parseTokenBudget(input: string): { objective: string; tokenBudget: number | null } {
	const m = input.match(/(?:^|\s)--tokens(?:=|\s+)(\d+(?:\.\d+)?)\s*([kKmM])?(?:\s|$)/);
	if (!m) return { objective: input.trim(), tokenBudget: null };
	const num = Number(m[1]);
	if (!Number.isFinite(num) || num <= 0) return { objective: input.trim(), tokenBudget: null };
	const mult = m[2]?.toLowerCase() === 'm' ? 1_000_000 : m[2]?.toLowerCase() === 'k' ? 1_000 : 1;
	const budget = Math.round(num * mult);
	const idx = m.index!;
	const objective = (input.slice(0, idx) + input.slice(idx + m[0].length)).trim();
	return { objective, tokenBudget: budget };
}

function parseMaxAutoTurns(input: string): { rest: string; maxAutoTurns: number | null } {
	const m = input.match(/(?:^|\s)--max-turns(?:=|\s+)(\d+)(?:\s|$)/);
	if (!m) return { rest: input.trim(), maxAutoTurns: null };
	const turns = Number.parseInt(m[1], 10);
	if (!Number.isFinite(turns) || turns <= 0) return { rest: input.trim(), maxAutoTurns: null };
	const idx = m.index!;
	const rest = (input.slice(0, idx) + input.slice(idx + m[0].length)).trim();
	return { rest, maxAutoTurns: turns };
}

function footerStatus(goal: GoalState | null, _config: GoalConfig, queueDepth: number): string | undefined {
	if (!goal) return undefined;
	const qs = queueDepth > 0 ? ` [+${queueDepth}]` : '';
	const usage = goal.tokenBudget
		? `${formatTokens(goal.tokensUsed)}/${formatTokens(goal.tokenBudget)}`
		: formatDuration(goal.timeUsedMs);
	switch (goal.status) {
		case 'active':
			return `🎯 goal active (${usage})${qs}`;
		case 'paused':
			return `⏸  goal paused${qs}`;
		case 'complete':
			return `✅ goal achieved${qs}`;
		case 'unmet':
			return `🚫 goal unmet${qs}`;
		case 'budget_limited':
			return `💰 goal budget (${usage})${qs}`;
	}
}

// ─── Token extraction ────────────────────────────────────────────────────

function extractOutputTokens(event: { message?: unknown }): number {
	const msg = event.message as Record<string, unknown> | undefined;
	const usage = msg?.usage as Record<string, unknown> | undefined;
	if (!usage) return 0;
	if (typeof usage.output === 'number')
		return usage.output + (typeof usage.reasoning === 'number' ? usage.reasoning : 0);
	if (typeof usage.totalTokens === 'number') {
		const total = usage.totalTokens as number;
		const cacheRead = typeof usage.cacheRead === 'number' ? (usage.cacheRead as number) : 0;
		const inputTokens = typeof usage.input === 'number' ? (usage.input as number) : 0;
		const delta = total - cacheRead - inputTokens;
		return delta > 0 ? delta : 0;
	}
	return 0;
}

// ─── Extension ───────────────────────────────────────────────────────────

/**
 * Check if the last assistant message was aborted or errored.
 */
function wasAgentAborted(event: { messages?: unknown[] }): boolean {
	const messages = event.messages ?? [];
	for (let i = messages.length - 1; i >= 0; i--) {
		const m = messages[i] as { role?: string; stopReason?: string } | undefined;
		if (m?.role === 'assistant' && (m.stopReason === 'aborted' || m.stopReason === 'error')) {
			return true;
		}
	}
	return false;
}

export default function piGoalPro(pi: ExtensionAPI) {
	let goals: GoalState[] = [];
	let config: GoalConfig = { ...DEFAULTS };

	// Steering state
	let goalDrivenInvocation = false;
	let userSuspended = false;
	let consecutiveContinuations = 0;

	// Per-turn accounting
	let turnStartedAt: number | null = null;
	let turnGoalId: string | null = null;
	let _turnOutputTokens = 0;

	let continuationTimer: ReturnType<typeof setTimeout> | null = null;

	// ── Helpers ────────────────────────────────────────────────────────

	function activeGoal(): GoalState | null {
		return goals.find((g) => g.status === 'active') ?? null;
	}

	function pausedGoals(): GoalState[] {
		return goals.filter((g) => g.status === 'paused' || g.status === 'budget_limited');
	}

	function queueDepth(): number {
		return goals.filter((g) => g.status === 'paused' || g.status === 'budget_limited').length;
	}

	function clearTimer() {
		if (continuationTimer) {
			clearTimeout(continuationTimer);
			continuationTimer = null;
		}
	}

	const GOAL_TOOLS = ['get_goal', 'update_goal'];

	function syncTools() {
		const want = !!activeGoal();
		const active = new Set(pi.getActiveTools());
		let changed = false;
		for (const name of GOAL_TOOLS) {
			if (want && !active.has(name)) {
				active.add(name);
				changed = true;
			} else if (!want && active.has(name)) {
				active.delete(name);
				changed = true;
			}
		}
		if (changed) pi.setActiveTools(Array.from(active));
	}

	function persist(action: GoalSnapshot['action']) {
		pi.appendEntry<GoalSnapshot>(GOAL_STORAGE_TYPE, {
			action,
			goals: goals.map((g) => ({ ...g })),
			config: { ...config },
		});
	}

	function updateFooter(ctx: ExtensionContext) {
		const a = activeGoal();
		if (!a && goals.every((g) => g.status === 'complete' || g.status === 'unmet')) {
			ctx.ui.setStatus(GOAL_FOOTER_ID, undefined);
			return;
		}
		const status = footerStatus(a, config, queueDepth());
		ctx.ui.setStatus(GOAL_FOOTER_ID, status ?? '');
	}

	function updateState(goalId: string, patch: Partial<GoalState>, ctx: ExtensionContext) {
		const g = goals.find((x) => x.id === goalId);
		if (!g) return;
		Object.assign(g, patch, { updatedAt: Date.now() });
		persist('update');
		updateFooter(ctx);
		syncTools();
	}

	// ── Continuation loop ──────────────────────────────────────────────

	function buildContinuationPrompt(goal: GoalState, isFirst: boolean): string {
		const budgetLine =
			goal.tokenBudget != null
				? `- Token budget: ${formatTokens(goal.tokenBudget)} (${formatTokens(Math.max(0, goal.tokenBudget - goal.tokensUsed))} remaining)`
				: '- No token budget set';
		return `Continue working toward the active goal.

<goal_objective>
${goal.objective}
</goal_objective>

Progress so far:
- Tokens used: ${formatTokens(goal.tokensUsed)}
${budgetLine}
- Time spent: ${formatDuration(goal.timeUsedMs)}
- Auto-continuation turns: ${goal.autoTurnCount} / ${goal.maxAutoTurns}
${isFirst ? '- This is the first continuation turn. Review what has been done so far and decide the next concrete step.' : ''}

Rules:
1. Before marking the goal complete, perform a strict completion audit against real evidence:
   - Inspect relevant files, command output, test results, PR state
   - Verify every explicit requirement has been met
   - Do not accept proxy signals or partial progress as completion
   - If any requirement is missing, incomplete, or unverified, keep working
2. Call update_goal({ status: "complete", evidence: "<summary>" }) ONLY when the objective is fully achieved.
3. Call update_goal({ status: "unmet", blocker: "<reason>" }) if the goal cannot be achieved or is blocked.
4. Do not mark complete merely because budget is nearly exhausted.
5. Do not ask for permission to mark complete — just do the audit and call the tool.`;
	}

	function buildBudgetLimitPrompt(goal: GoalState): string {
		return `The active goal has reached its token budget.

<goal_objective>
${goal.objective}
</goal_objective>

Usage:
- Tokens used: ${formatTokens(goal.tokensUsed)}
- Token budget: ${goal.tokenBudget != null ? formatTokens(goal.tokenBudget) : 'none'}
- Time spent: ${formatDuration(goal.timeUsedMs)}

The system has marked the goal as budget_limited. Do not start new substantive work. 
Wrap up: summarize progress, identify remaining work, and leave the user with a clear next step.
Do not call update_goal unless the goal is actually complete.`;
	}

	function sendContinuationNow(_ctx: ExtensionContext) {
		const a = activeGoal();
		if (!a) return;
		if (userSuspended) return;
		clearTimer();
		queueMicrotask(() => {
			const a2 = activeGoal();
			if (!a2) return;
			if (userSuspended) return;
			goalDrivenInvocation = true;
			pi.sendMessage(
				{
					customType: `${GOAL_STORAGE_TYPE}:continuation`,
					content: buildContinuationPrompt(a2, consecutiveContinuations === 0),
					display: false,
				},
				{ triggerTurn: true, deliverAs: 'followUp' },
			);
		});
	}

	function scheduleContinuation(ctx: ExtensionContext) {
		clearTimer();
		if (userSuspended) return;
		const a = activeGoal();
		if (!a) return;
		if (!ctx.isIdle() || ctx.hasPendingMessages()) return;

		if (a.noProgressCount >= config.maxNoProgressTurns) {
			// No-progress detection: pause the goal
			updateState(a.id, { status: 'paused' as GoalStatus }, ctx);
			const e: GoalEvent = { kind: 'paused', goal: { ...a, status: 'paused' }, timestamp: Date.now() };
			pi.sendMessage(
				{
					customType: `${GOAL_STORAGE_TYPE}:event`,
					content: `Goal paused: no progress detected after ${config.maxNoProgressTurns} turns (output < ${config.noProgressTokenThreshold} tokens each). Use /goal resume to continue.`,
					display: true,
					details: e,
				},
				{ triggerTurn: false },
			);
			ctx.ui.notify(
				`⏸ Goal paused (no progress for ${config.maxNoProgressTurns} turns). Use /goal resume to continue.`,
				'warning',
			);
			return;
		}

		if (a.autoTurnCount >= a.maxAutoTurns) {
			// Max turns reached: pause the goal
			updateState(a.id, { status: 'paused' as GoalStatus }, ctx);
			const e: GoalEvent = { kind: 'paused', goal: { ...a, status: 'paused' }, timestamp: Date.now() };
			pi.sendMessage(
				{
					customType: `${GOAL_STORAGE_TYPE}:event`,
					content: `Goal paused: reached max auto-continue turns (${a.maxAutoTurns}). Use /goal resume to continue.`,
					display: true,
					details: e,
				},
				{ triggerTurn: false },
			);
			return;
		}

		const goalId = a.id;
		continuationTimer = setTimeout(() => {
			continuationTimer = null;
			const a2 = activeGoal();
			if (!a2 || a2.id !== goalId) return;
			if (userSuspended) return;
			goalDrivenInvocation = true;
			pi.sendMessage(
				{
					customType: `${GOAL_STORAGE_TYPE}:continuation`,
					content: buildContinuationPrompt(a2, false),
					display: false,
				},
				{ triggerTurn: true, deliverAs: 'followUp' },
			);
		}, config.minContinueIntervalMs);
	}

	// ── Mutation helpers ───────────────────────────────────────────────

	function setGoal(
		objective: string,
		opts: { tokenBudget?: number | null; maxAutoTurns?: number | null; replace?: boolean },
		ctx: ExtensionContext,
	): GoalState {
		const now = Date.now();
		const existing = activeGoal();
		if (existing) {
			if (opts.replace) {
				existing.status = 'unmet';
				existing.blocker = 'Replaced by user';
				existing.updatedAt = now;
			}
		}

		const goal: GoalState = {
			version: 1,
			id: goalId(),
			objective,
			status: 'active',
			tokenBudget: opts.tokenBudget ?? null,
			tokensUsed: 0,
			timeUsedMs: 0,
			createdAt: now,
			updatedAt: now,
			noProgressCount: 0,
			autoTurnCount: 0,
			maxAutoTurns: opts.maxAutoTurns ?? config.maxAutoTurns,
		};
		goals.push(goal);

		userSuspended = false;
		consecutiveContinuations = 0;

		persist('set');
		updateFooter(ctx);
		syncTools();

		// Start first continuation immediately
		sendContinuationNow(ctx);

		return goal;
	}

	function clearGoal(ctx: ExtensionContext): boolean {
		if (goals.length === 0) return false;
		const a = activeGoal();
		if (a) {
			const e: GoalEvent = { kind: 'cleared', goal: { ...a }, timestamp: Date.now() };
			pi.sendMessage(
				{
					customType: `${GOAL_STORAGE_TYPE}:event`,
					content: `Goal cleared by user.\n\nObjective was: ${a.objective}`,
					display: true,
					details: e,
				},
				{ triggerTurn: false },
			);
		}
		clearTimer();
		goals = [];
		userSuspended = false;
		consecutiveContinuations = 0;
		goalDrivenInvocation = false;
		persist('clear');
		updateFooter(ctx);
		syncTools();
		return true;
	}

	function pauseGoal(ctx: ExtensionContext): boolean {
		const a = activeGoal();
		if (!a) return false;
		updateState(a.id, { status: 'paused' }, ctx);
		clearTimer();
		userSuspended = true;
		const e: GoalEvent = { kind: 'paused', goal: { ...a, status: 'paused' }, timestamp: Date.now() };
		pi.sendMessage(
			{
				customType: `${GOAL_STORAGE_TYPE}:event`,
				content: `Goal paused.\n\nObjective: ${a.objective}`,
				display: true,
				details: e,
			},
			{ triggerTurn: false },
		);
		return true;
	}

	function resumeGoal(ctx: ExtensionContext): GoalState | null {
		const paused = pausedGoals();
		const target = paused.length > 0 ? paused[0] : null;
		if (!target) return null;
		userSuspended = false;
		consecutiveContinuations = 0;
		target.noProgressCount = 0;
		updateState(target.id, { status: 'active' }, ctx);
		const e: GoalEvent = { kind: 'resumed', goal: { ...target, status: 'active' }, timestamp: Date.now() };
		pi.sendMessage(
			{
				customType: `${GOAL_STORAGE_TYPE}:event`,
				content: `Goal resumed.\n\nObjective: ${target.objective}`,
				display: true,
				details: e,
			},
			{ triggerTurn: false },
		);
		sendContinuationNow(ctx);
		return target;
	}

	// ── State reconstruction ──────────────────────────────────────────

	function reconstruct(ctx: ExtensionContext) {
		goals = [];
		config = { ...DEFAULTS };
		turnStartedAt = null;
		turnGoalId = null;
		_turnOutputTokens = 0;
		goalDrivenInvocation = false;
		userSuspended = false;
		consecutiveContinuations = 0;
		clearTimer();

		for (const entry of ctx.sessionManager.getBranch()) {
			if (entry.type !== 'custom' || entry.customType !== GOAL_STORAGE_TYPE) continue;
			const data = entry.data as GoalSnapshot | undefined;
			if (!data) continue;
			goals = data.goals.map((g) => ({ ...g }));
			if (data.config) config = { ...data.config };
		}
	}

	// ── Events ─────────────────────────────────────────────────────────

	pi.on('session_start', async (_event, ctx) => {
		reconstruct(ctx);
		syncTools();

		const a = activeGoal();
		if (a) {
			ctx.ui.notify(
				`🎯 Goal restored: ${a.objective.replace(/\s+/g, ' ').slice(0, 80)}…\n/goal pause to stop, /goal clear to remove.`,
				'info',
			);
		}
		updateFooter(ctx);
	});

	pi.on('session_tree', async (_event, ctx) => {
		reconstruct(ctx);
		syncTools();
		updateFooter(ctx);
	});

	pi.on('session_shutdown', async () => {
		clearTimer();
		turnStartedAt = null;
		turnGoalId = null;
	});

	// User input → suspend auto-continuation
	pi.on('input', async (_event, _ctx) => {
		clearTimer();
		if (activeGoal()) {
			userSuspended = true;
		}
	});

	pi.on('turn_start', async (_event, _ctx) => {
		if (goalDrivenInvocation) {
			consecutiveContinuations += 1;
		} else {
			consecutiveContinuations = 0;
		}

		const a = activeGoal();
		if (a) {
			turnStartedAt = Date.now();
			turnGoalId = a.id;
			_turnOutputTokens = 0;
		} else {
			turnStartedAt = null;
			turnGoalId = null;
			_turnOutputTokens = 0;
		}
	});

	pi.on('turn_end', async (event, ctx) => {
		if (turnStartedAt === null || turnGoalId === null) return;

		const charged = goals.find((g) => g.id === turnGoalId);
		const elapsed = Date.now() - turnStartedAt;
		const outputTokens = extractOutputTokens(event);
		turnStartedAt = null;
		turnGoalId = null;
		_turnOutputTokens = 0;

		if (!charged) return;

		charged.timeUsedMs += elapsed;
		charged.tokensUsed += outputTokens;

		// No-progress tracking
		if (outputTokens < config.noProgressTokenThreshold) {
			charged.noProgressCount += 1;
		} else {
			charged.noProgressCount = 0;
		}

		// Auto-turn tracking
		if (goalDrivenInvocation) {
			charged.autoTurnCount += 1;
		}

		// Budget check
		if (charged.status === 'active' && charged.tokenBudget !== null && charged.tokensUsed >= charged.tokenBudget) {
			charged.status = 'budget_limited';
			charged.updatedAt = Date.now();
			persist('budget_limited');
			updateFooter(ctx);
			syncTools();
			const e: GoalEvent = { kind: 'budget_limited', goal: { ...charged }, timestamp: Date.now() };
			pi.sendMessage(
				{
					customType: `${GOAL_STORAGE_TYPE}:event`,
					content: buildBudgetLimitPrompt(charged),
					display: true,
					details: e,
				},
				{ triggerTurn: true, deliverAs: 'steer' },
			);
			return;
		}

		persist('update');
		updateFooter(ctx);
	});

	pi.on('agent_end', async (event, ctx) => {
		updateFooter(ctx);
		const wasGoalDriven = goalDrivenInvocation;
		goalDrivenInvocation = false;

		if (wasAgentAborted(event)) {
			userSuspended = true;
			clearTimer();
			ctx.ui.notify('⏸ Goal continuations suspended (interrupted). Use /goal resume to continue.', 'info');
			return;
		}

		if (!wasGoalDriven) return;
		if (userSuspended) return;
		if (ctx.hasPendingMessages()) return;

		scheduleContinuation(ctx);
	});

	// System prompt injection
	pi.on('before_agent_start', async (event, _ctx) => {
		const a = activeGoal();
		if (!a) return;
		if (!goalDrivenInvocation) return;

		const lines = ['', '## Active Goal', `Objective: ${a.objective}`, `Status: ${a.status}`];
		if (a.tokenBudget !== null) {
			const remaining = Math.max(0, a.tokenBudget - a.tokensUsed);
			lines.push(`Token budget: ${formatTokens(a.tokenBudget)} (${formatTokens(remaining)} remaining)`);
		}
		const qd = queueDepth();
		if (qd > 0) lines.push(`${qd} paused goal(s) remaining.`);
		lines.push('');
		lines.push('Use update_goal({ status: "complete", evidence: "..." }) when the objective is fully achieved.');
		lines.push('Use update_goal({ status: "unmet", blocker: "..." }) if the goal cannot be achieved.');

		return {
			systemPrompt: event.systemPrompt + lines.join('\n'),
			message: !goalDrivenInvocation
				? undefined
				: {
						customType: `${GOAL_STORAGE_TYPE}:context`,
						content: `Active goal context:\nObjective: ${a.objective}\nStatus: ${a.status}`,
						display: false,
					},
		};
	});

	// ── Message renderer for goal events ───────────────────────────────

	pi.registerMessageRenderer(`${GOAL_STORAGE_TYPE}:event`, (message, options, theme) => {
		const details = message.details as GoalEvent | undefined;
		const kind = details?.kind ?? 'continuation';
		const state = details?.goal ?? null;

		const box = new (class {
			private children: import('@earendil-works/pi-tui').Component[] = [];

			render(_width: number): string[] {
				const lines: string[] = [];
				const isExpanded = options.expanded;
				const prefix = theme.fg('accent', theme.bold('Goal'));
				const kindLabel = this.kindLabel(kind, theme);
				const statusText = theme.fg('dim', isExpanded ? '' : '(ctrl+o to expand)');

				lines.push(`${prefix} ${kindLabel} ${!isExpanded ? statusText : ''}`);

				if (isExpanded && state) {
					lines.push(`${theme.fg('dim', '  Status: ')}${theme.fg('text', kind)}`);
					lines.push(`${theme.fg('dim', '  Goal: ')}${theme.fg('text', state.objective)}`);
					if (state.completionEvidence) {
						lines.push(`${theme.fg('dim', '  Evidence: ')}${theme.fg('success', state.completionEvidence)}`);
					}
					if (state.blocker) {
						lines.push(`${theme.fg('dim', '  Blocker: ')}${theme.fg('warning', state.blocker)}`);
					}
					const usage = state.tokenBudget
						? `${formatTokens(state.tokensUsed)}/${formatTokens(state.tokenBudget)}`
						: formatDuration(state.timeUsedMs);
					lines.push(`${theme.fg('dim', '  Usage: ')}${theme.fg('text', usage)}`);
				}

				return lines;
			}

			invalidate(): void {}

			handleInput?(data: string): void {
				if (matchesKey(data, 'escape') || matchesKey(data, 'ctrl+c')) {
					// no-op, let parent handle
				}
			}

			private kindLabel(k: string, th: typeof theme): string {
				const labels: Record<string, string> = {
					active: th.fg('accent', 'active'),
					continuation: th.fg('muted', 'continuing'),
					paused: th.fg('warning', 'paused'),
					resumed: th.fg('accent', 'resumed'),
					cleared: th.fg('dim', 'cleared'),
					budget_limited: th.fg('warning', 'budget'),
					complete: th.fg('success', 'achieved'),
					unmet: th.fg('error', 'unmet'),
				};
				return labels[k] ?? k;
			}
		})();

		return box;
	});

	// ── Commands ───────────────────────────────────────────────────────

	pi.registerCommand('goal', {
		description: 'Set, view, pause, resume, clear, or configure a long-running goal',
		getArgumentCompletions: (prefix) => {
			const cmds = ['pause', 'resume', 'clear', 'status', 'help', 'config'];
			return cmds.filter((c) => c.startsWith(prefix)).map((c) => ({ value: c, label: c }));
		},
		handler: async (args, ctx) => {
			const trimmed = args.trim();

			if (!trimmed || trimmed === 'status') {
				if (goals.length === 0) {
					ctx.ui.notify(
						'Usage: /goal <objective> [--tokens N] [--max-turns N]\n  /goal pause|resume|clear|status|config',
						'info',
					);
					return;
				}
				const a = activeGoal();
				const paused = pausedGoals();
				const done = goals.filter((g) => g.status === 'complete' || g.status === 'unmet');
				let msg = `Goals: ${goals.length} total`;
				if (a) {
					msg += `\nActive: ${a.objective.replace(/\s+/g, ' ').slice(0, 80)}`;
					msg += `\n  Status: ${a.status} | Tokens: ${formatTokens(a.tokensUsed)}${a.tokenBudget ? `/${formatTokens(a.tokenBudget)}` : ''} | Time: ${formatDuration(a.timeUsedMs)}`;
					msg += `\n  Turns: ${a.autoTurnCount}/${a.maxAutoTurns}`;
				}
				if (paused.length > 0) {
					msg += `\nPaused: ${paused.length}`;
				}
				if (done.length > 0) {
					msg += `\nDone: ${done.length}`;
				}
				msg += `\nContinuations: ${userSuspended ? 'suspended' : 'active'}`;
				ctx.ui.notify(msg, 'info');
				return;
			}

			if (trimmed === 'help') {
				ctx.ui.notify(
					`/goal <objective> [--tokens N] [--max-turns N] — set a goal
/goal status — show current goal
/goal pause — pause active goal
/goal resume — resume paused goal
/goal clear — clear all goals
/goal config — show configuration`,
					'info',
				);
				return;
			}

			if (trimmed === 'clear') {
				if (goals.length === 0) {
					ctx.ui.notify('No goals to clear.', 'info');
					return;
				}
				clearGoal(ctx);
				ctx.ui.notify('All goals cleared.', 'info');
				return;
			}

			if (trimmed === 'pause') {
				if (!pauseGoal(ctx)) {
					ctx.ui.notify('No active goal to pause.', 'info');
				} else {
					ctx.ui.notify('Goal paused.', 'info');
				}
				return;
			}

			if (trimmed === 'resume') {
				if (activeGoal()) {
					ctx.ui.notify('A goal is already active.', 'info');
					return;
				}
				const g = resumeGoal(ctx);
				if (!g) {
					ctx.ui.notify('No paused goal to resume.', 'info');
				} else {
					ctx.ui.notify(`Goal resumed: ${g.objective.replace(/\s+/g, ' ').slice(0, 60)}…`, 'info');
				}
				return;
			}

			if (trimmed === 'config') {
				ctx.ui.notify(
					`Configuration:
  maxAutoTurns: ${config.maxAutoTurns}
  noProgressTokenThreshold: ${config.noProgressTokenThreshold}
  maxNoProgressTurns: ${config.maxNoProgressTurns}
  minContinueIntervalMs: ${config.minContinueIntervalMs}`,
					'info',
				);
				return;
			}

			// /goal <objective> [--tokens N] [--max-turns N]
			let rest = trimmed;

			// Parse --max-turns
			const turnsResult = parseMaxAutoTurns(rest);
			rest = turnsResult.rest;

			// Parse --tokens
			const budgetResult = parseTokenBudget(rest);
			const objective = budgetResult.objective;

			if (!objective) {
				ctx.ui.notify('Usage: /goal <objective> [--tokens N] [--max-turns N]', 'warning');
				return;
			}

			const existing = activeGoal();
			if (existing) {
				const ok = await ctx.ui.confirm(
					'Replace active goal?',
					`Current: ${existing.objective.replace(/\s+/g, ' ').slice(0, 80)}…\n\nNew: ${objective.slice(0, 80)}…`,
				);
				if (!ok) return;
			}

			const goal = setGoal(
				objective,
				{
					tokenBudget: budgetResult.tokenBudget,
					maxAutoTurns: turnsResult.maxAutoTurns,
					replace: !!existing,
				},
				ctx,
			);

			ctx.ui.notify(`🎯 Goal set: ${goal.objective.replace(/\s+/g, ' ').slice(0, 80)}…`, 'info');
		},
	});

	// ── Tools ──────────────────────────────────────────────────────────

	pi.registerTool({
		name: 'get_goal',
		label: 'Get Goal',
		description: 'Get the current active goal, its status, token usage, budget, and queue.',
		promptSnippet: 'Read the current pi-goal-pro objective and remaining budget',
		promptGuidelines: ['Use get_goal when you need the current objective or remaining budget.'],
		parameters: Type.Object({}),
		async execute() {
			if (goals.length === 0) {
				return { content: [{ type: 'text', text: 'No goal is currently set.' }], details: {} };
			}
			const a = activeGoal();
			const info = {
				active: a
					? {
							id: a.id,
							objective: a.objective,
							status: a.status,
							tokens_used: a.tokensUsed,
							token_budget: a.tokenBudget,
							remaining_tokens: a.tokenBudget !== null ? Math.max(0, a.tokenBudget - a.tokensUsed) : null,
							time_used_seconds: Math.floor(a.timeUsedMs / 1000),
							auto_turns: a.autoTurnCount,
							max_auto_turns: a.maxAutoTurns,
						}
					: null,
				paused: pausedGoals().map((g) => ({
					id: g.id,
					objective: g.objective,
					status: g.status,
				})),
				completed: goals
					.filter((g) => g.status === 'complete' || g.status === 'unmet')
					.map((g) => ({
						id: g.id,
						objective: g.objective,
						status: g.status,
					})),
				continuations_suspended: userSuspended,
			};
			return {
				content: [{ type: 'text', text: JSON.stringify(info, null, 2) }],
				details: info,
			};
		},
	});

	pi.registerTool({
		name: 'update_goal',
		label: 'Update Goal',
		description: `Close the active goal. Use status "complete" with evidence when the objective is fully achieved and verified against real artifacts (files, tests, command output). Use status "unmet" with blocker when the goal cannot be achieved or is blocked. Do not close a goal merely because work is stopping or budget is exhausted.`,
		promptSnippet: 'Mark the active goal complete or unmet after a strict completion audit',
		promptGuidelines: [
			'Use update_goal only after a strict completion audit against real evidence.',
			'Provide concrete evidence for complete, or a concrete blocker for unmet.',
		],
		parameters: Type.Object({
			status: StringEnum(['complete', 'unmet'] as const),
			evidence: Type.Optional(
				Type.String({ description: 'Required for complete. Summarize concrete evidence verified.' }),
			),
			blocker: Type.Optional(Type.String({ description: 'Required for unmet. Explain the concrete blocker.' })),
		}),
		async execute(_id, params, _signal, _onUpdate, ctx) {
			const a = activeGoal();
			if (!a) {
				return { content: [{ type: 'text', text: 'No active goal to update.' }], details: {}, isError: true };
			}

			if (params.status === 'complete') {
				if (!params.evidence) {
					return {
						content: [
							{
								type: 'text',
								text: 'Evidence is required to mark a goal complete. Provide a summary of verification evidence.',
							},
						],
						details: {},
						isError: true,
					};
				}
				updateState(a.id, { status: 'complete', completionEvidence: params.evidence, noProgressCount: 0 }, ctx);
				const e: GoalEvent = { kind: 'complete', goal: { ...a, status: 'complete' }, timestamp: Date.now() };
				pi.sendMessage(
					{
						customType: `${GOAL_STORAGE_TYPE}:event`,
						content: `Goal achieved!\n\nObjective: ${a.objective}\nEvidence: ${params.evidence}`,
						display: true,
						details: e,
					},
					{ triggerTurn: false },
				);
				return {
					content: [
						{
							type: 'text',
							text: `Goal complete: ${a.objective}\nEvidence: ${params.evidence}\nTokens used: ${formatTokens(a.tokensUsed)}\nTime: ${formatDuration(a.timeUsedMs)}`,
						},
					],
					details: { goal: { ...a, status: 'complete', completionEvidence: params.evidence } },
				};
			}

			if (params.status === 'unmet') {
				if (!params.blocker) {
					return {
						content: [
							{ type: 'text', text: 'Blocker is required to mark a goal unmet. Describe why it cannot be achieved.' },
						],
						details: {},
						isError: true,
					};
				}
				updateState(a.id, { status: 'unmet', blocker: params.blocker, noProgressCount: 0 }, ctx);
				const e: GoalEvent = { kind: 'unmet', goal: { ...a, status: 'unmet' }, timestamp: Date.now() };
				pi.sendMessage(
					{
						customType: `${GOAL_STORAGE_TYPE}:event`,
						content: `Goal unmet.\n\nObjective: ${a.objective}\nBlocker: ${params.blocker}`,
						display: true,
						details: e,
					},
					{ triggerTurn: false },
				);
				return {
					content: [
						{
							type: 'text',
							text: `Goal unmet: ${a.objective}\nBlocker: ${params.blocker}\nTokens used: ${formatTokens(a.tokensUsed)}\nTime: ${formatDuration(a.timeUsedMs)}`,
						},
					],
					details: { goal: { ...a, status: 'unmet', blocker: params.blocker } },
				};
			}

			return {
				content: [{ type: 'text', text: "Invalid status. Use 'complete' or 'unmet'." }],
				details: {},
				isError: true,
			};
		},
	});
}
