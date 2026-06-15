/**
 * helpers.ts — Pure utility functions and types for pi-goal-pro
 *
 * No pi framework imports — safe to import in tests without peer dependencies.
 */

export type GoalStatus = 'active' | 'paused' | 'complete' | 'unmet' | 'budget_limited';

export interface CriterionState {
	id: string;
	description: string;
	evidence: string[];
}

export interface GoalState {
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
	noProgressCount: number;
	autoTurnCount: number;
	maxAutoTurns: number;
	criteria: CriterionState[];
	driftCount: number;
	abortReason?: 'aborted' | 'api_error';
}

export interface GoalConfig {
	maxAutoTurns: number;
	noProgressTokenThreshold: number;
	maxNoProgressTurns: number;
	minContinueIntervalMs: number;
	driftThreshold: number;
}

export interface GoalEvent {
	kind: 'active' | 'continuation' | 'paused' | 'resumed' | 'cleared' | 'budget_limited' | 'complete' | 'unmet';
	goal: GoalState;
	timestamp: number;
}

export interface GoalSnapshot {
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

export const GOAL_STORAGE_TYPE = 'pi-goal-pro';
export const GOAL_FOOTER_ID = 'pi-goal-pro';

export const DEFAULTS: GoalConfig = {
	maxAutoTurns: 25,
	noProgressTokenThreshold: 50,
	maxNoProgressTurns: 2,
	minContinueIntervalMs: 3000,
	driftThreshold: 4,
};

// ─── Formatting ──────────────────────────────────────────────────────────

export function formatTokens(v: number): string {
	if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(v >= 10_000_000 ? 0 : 1).replace(/\.0$/, '')}M`;
	if (v >= 1_000) return `${(v / 1_000).toFixed(v >= 10_000 ? 0 : 1).replace(/\.0$/, '')}K`;
	return String(v);
}

export function formatDuration(ms: number): string {
	const total = Math.max(0, Math.floor(ms / 1000));
	const h = Math.floor(total / 3600);
	const m = Math.floor((total % 3600) / 60);
	const s = total % 60;
	if (h > 0) return `${h}h${String(m).padStart(2, '0')}m${String(s).padStart(2, '0')}s`;
	if (m > 0) return `${m}m${String(s).padStart(2, '0')}s`;
	return `${s}s`;
}

// ─── ID generation ───────────────────────────────────────────────────────

export function goalId(): string {
	return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function criterionId(): string {
	return `c${Math.random().toString(36).slice(2, 7)}`;
}

// ─── Argument parsing ────────────────────────────────────────────────────

export function parseTokenBudget(input: string): { objective: string; tokenBudget: number | null } {
	const m = input.match(/(?:^|\s)--tokens(?:=|\s+)(\d+(?:\.\d+)?)\s*([kKmM])?(?:\s|$)/);
	if (!m) return { objective: input.trim(), tokenBudget: null };
	const num = Number(m[1]);
	if (!Number.isFinite(num) || num <= 0) return { objective: input.trim(), tokenBudget: null };
	const mult = m[2]?.toLowerCase() === 'm' ? 1_000_000 : m[2]?.toLowerCase() === 'k' ? 1_000 : 1;
	const budget = Math.round(num * mult);
	const idx = m.index as number;
	const objective = (input.slice(0, idx) + input.slice(idx + m[0].length)).trim();
	return { objective, tokenBudget: budget };
}

export function parseMaxAutoTurns(input: string): { rest: string; maxAutoTurns: number | null } {
	const m = input.match(/(?:^|\s)--max-turns(?:=|\s+)(\d+)(?:\s|$)/);
	if (!m) return { rest: input.trim(), maxAutoTurns: null };
	const turns = Number.parseInt(m[1], 10);
	if (!Number.isFinite(turns) || turns <= 0) return { rest: input.trim(), maxAutoTurns: null };
	const idx = m.index as number;
	const rest = (input.slice(0, idx) + input.slice(idx + m[0].length)).trim();
	return { rest, maxAutoTurns: turns };
}

export function parseCriteria(input: string): { rest: string; criteria: string[] } {
	const m = input.match(/(?:^|\s)--criteria(?:=|\s+)"([^"]*)"(?:\s|$)/);
	if (!m) return { rest: input.trim(), criteria: [] };
	const list = m[1]
		.split('|')
		.map((s) => s.trim())
		.filter(Boolean);
	const idx = m.index as number;
	const rest = (input.slice(0, idx) + input.slice(idx + m[0].length)).trim();
	return { rest, criteria: list };
}

// ─── Token extraction ────────────────────────────────────────────────────

export function extractOutputTokens(event: { message?: unknown }): number {
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

export function agentAbortReason(
	event: { messages?: unknown[] },
): 'aborted' | 'api_error' | null {
	const messages = event.messages ?? [];
	for (let i = messages.length - 1; i >= 0; i--) {
		const m = messages[i] as { role?: string; stopReason?: string } | undefined;
		if (m?.role === 'assistant') {
			if (m.stopReason === 'aborted') return 'aborted';
			if (m.stopReason === 'error') return 'api_error';
		}
	}
	return null;
}

// ─── Footer ──────────────────────────────────────────────────────────────

export function footerStatus(goal: GoalState | null, queueDepth: number): string | undefined {
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
