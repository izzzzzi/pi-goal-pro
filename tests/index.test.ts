import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
	extractOutputTokens,
	footerStatus,
	formatDuration,
	formatTokens,
	type GoalState,
	goalId,
	parseMaxAutoTurns,
	parseTokenBudget,
} from '../helpers';

// ─── Tests ───────────────────────────────────────────────────────────────

describe('parseTokenBudget', () => {
	it('parses objective without budget', () => {
		const r = parseTokenBudget('Refactor auth module');
		assert.equal(r.objective, 'Refactor auth module');
		assert.equal(r.tokenBudget, null);
	});

	it('parses --tokens 50k', () => {
		const r = parseTokenBudget('Refactor auth module --tokens 50k');
		assert.equal(r.objective, 'Refactor auth module');
		assert.equal(r.tokenBudget, 50_000);
	});

	it('parses --tokens=100k', () => {
		const r = parseTokenBudget('Refactor --tokens=100k');
		assert.equal(r.objective, 'Refactor');
		assert.equal(r.tokenBudget, 100_000);
	});

	it('parses --tokens 1m', () => {
		const r = parseTokenBudget('Refactor --tokens 1m');
		assert.equal(r.objective, 'Refactor');
		assert.equal(r.tokenBudget, 1_000_000);
	});

	it('parses --tokens 500000', () => {
		const r = parseTokenBudget('Refactor --tokens 500000');
		assert.equal(r.objective, 'Refactor');
		assert.equal(r.tokenBudget, 500_000);
	});

	it('handles --tokens at start', () => {
		const r = parseTokenBudget('--tokens 10k write tests');
		assert.equal(r.objective, 'write tests');
		assert.equal(r.tokenBudget, 10_000);
	});

	it('returns null for zero (input unchanged)', () => {
		const r = parseTokenBudget('refactor --tokens 0');
		assert.equal(r.objective, 'refactor --tokens 0');
		assert.equal(r.tokenBudget, null);
	});

	it('returns null for negative (input unchanged)', () => {
		const r = parseTokenBudget('refactor --tokens -5k');
		assert.equal(r.objective, 'refactor --tokens -5k');
		assert.equal(r.tokenBudget, null);
	});

	it('returns null for non-numeric (input unchanged)', () => {
		const r = parseTokenBudget('refactor --tokens abc');
		assert.equal(r.objective, 'refactor --tokens abc');
		assert.equal(r.tokenBudget, null);
	});

	it('handles empty string', () => {
		const r = parseTokenBudget('');
		assert.equal(r.objective, '');
		assert.equal(r.tokenBudget, null);
	});
});

describe('parseMaxAutoTurns', () => {
	it('parses --max-turns 10', () => {
		const r = parseMaxAutoTurns('Refactor --max-turns 10');
		assert.equal(r.rest, 'Refactor');
		assert.equal(r.maxAutoTurns, 10);
	});

	it('parses --max-turns=5', () => {
		const r = parseMaxAutoTurns('Refactor --max-turns=5');
		assert.equal(r.rest, 'Refactor');
		assert.equal(r.maxAutoTurns, 5);
	});

	it('returns null for zero (input unchanged)', () => {
		const r = parseMaxAutoTurns('Refactor --max-turns 0');
		assert.equal(r.rest, 'Refactor --max-turns 0');
		assert.equal(r.maxAutoTurns, null);
	});

	it('no flag returns null', () => {
		const r = parseMaxAutoTurns('Refactor auth');
		assert.equal(r.rest, 'Refactor auth');
		assert.equal(r.maxAutoTurns, null);
	});
});

describe('formatTokens', () => {
	it('formats 0', () => assert.equal(formatTokens(0), '0'));
	it('formats 100', () => assert.equal(formatTokens(100), '100'));
	it('formats 999', () => assert.equal(formatTokens(999), '999'));
	it('formats 1000', () => assert.equal(formatTokens(1_000), '1K'));
	it('formats 1500', () => assert.equal(formatTokens(1_500), '1.5K'));
	it('formats 999999 (boundary)', () => assert.equal(formatTokens(999_999), '1000K'));
	it('formats 1000000', () => assert.equal(formatTokens(1_000_000), '1M'));
	it('formats 2500000', () => assert.equal(formatTokens(2_500_000), '2.5M'));
	it('formats 10000000', () => assert.equal(formatTokens(10_000_000), '10M'));
});

describe('formatDuration', () => {
	it('formats 0', () => assert.equal(formatDuration(0), '0s'));
	it('formats 5000ms', () => assert.equal(formatDuration(5_000), '5s'));
	it('formats 60000ms', () => assert.equal(formatDuration(60_000), '1m00s'));
	it('formats 61000ms', () => assert.equal(formatDuration(61_000), '1m01s'));
	it('formats 3600000ms', () => assert.equal(formatDuration(3_600_000), '1h00m00s'));
	it('formats 3661000ms', () => assert.equal(formatDuration(3_661_000), '1h01m01s'));
	it('formats large values', () => assert.equal(formatDuration(999_999_999), '277h46m39s'));
});

describe('goalId', () => {
	it('returns a non-empty string', () => {
		const id = goalId();
		assert.ok(typeof id === 'string');
		assert.ok(id.length > 0);
	});

	it('contains a dash separator', () => {
		assert.ok(goalId().includes('-'));
	});

	it('returns unique values', () => {
		const ids = new Set(Array.from({ length: 100 }, () => goalId()));
		assert.equal(ids.size, 100);
	});
});

describe('extractOutputTokens', () => {
	it('returns 0 for empty event', () => {
		assert.equal(extractOutputTokens({}), 0);
	});

	it('returns 0 for no usage', () => {
		assert.equal(extractOutputTokens({ message: {} }), 0);
	});

	it('extracts output + reasoning', () => {
		const event = { message: { usage: { output: 200, reasoning: 50 } } };
		assert.equal(extractOutputTokens(event), 250);
	});

	it('handles output only', () => {
		const event = { message: { usage: { output: 100 } } };
		assert.equal(extractOutputTokens(event), 100);
	});

	it('handles totalTokens fallback', () => {
		const event = {
			message: {
				usage: {
					totalTokens: 10_000,
					input: 7_500,
					cacheRead: 500,
				},
			},
		};
		// 10000 - 7500 - 500 = 2000
		assert.equal(extractOutputTokens(event), 2_000);
	});

	it('handles totalTokens without cache', () => {
		const event = {
			message: {
				usage: {
					totalTokens: 5_000,
					input: 3_000,
				},
			},
		};
		assert.equal(extractOutputTokens(event), 2_000);
	});

	it('returns 0 when delta is negative', () => {
		const event = {
			message: {
				usage: {
					totalTokens: 100,
					input: 200,
				},
			},
		};
		assert.equal(extractOutputTokens(event), 0);
	});
});

describe('footerStatus', () => {
	const makeGoal = (overrides: Partial<GoalState> = {}): GoalState => ({
		id: 'test-1',
		objective: 'Refactor auth',
		status: 'active',
		tokenBudget: null,
		tokensUsed: 0,
		timeUsedMs: 0,
		createdAt: 0,
		updatedAt: 0,
		noProgressCount: 0,
		autoTurnCount: 0,
		maxAutoTurns: 25,
		criteria: [],
		driftCount: 0,
		...overrides,
	});

	it('returns undefined for null goal', () => {
		assert.equal(footerStatus(null, 0), undefined);
	});

	it('shows active with time', () => {
		const g = makeGoal({ status: 'active', timeUsedMs: 5_000 });
		assert.match(footerStatus(g, 0) as string, /🎯 goal active \(5s\)/);
	});

	it('shows active with token budget', () => {
		const g = makeGoal({
			status: 'active',
			tokenBudget: 50_000,
			tokensUsed: 1_200,
		});
		assert.match(footerStatus(g, 0) as string, /🎯 goal active \(1\.2K\/50K\)/);
	});

	it('shows active with queue depth', () => {
		const g = makeGoal({ status: 'active', timeUsedMs: 10_000 });
		assert(footerStatus(g, 2)?.includes('[+2]'));
	});

	it('shows paused', () => {
		const g = makeGoal({ status: 'paused' });
		assert.match(footerStatus(g, 0) as string, /⏸/);
	});

	it('shows complete', () => {
		const g = makeGoal({ status: 'complete' });
		assert.match(footerStatus(g, 0) as string, /✅/);
	});

	it('shows unmet', () => {
		const g = makeGoal({ status: 'unmet' });
		assert.match(footerStatus(g, 0) as string, /🚫/);
	});

	it('shows budget_limited', () => {
		const g = makeGoal({
			status: 'budget_limited',
			tokenBudget: 100_000,
			tokensUsed: 100_000,
		});
		assert.match(footerStatus(g, 0) as string, /💰/);
	});
});
