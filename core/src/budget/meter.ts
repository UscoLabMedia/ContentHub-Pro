// Spend meter with daily and weekly windows. Source of truth is the real `usage` returned by
// every API call (recorded by the gateway), not estimates. Limits are user-configurable.

export interface BudgetConfig {
  dailyLimitUsd: number;
  weeklyLimitUsd: number;
  /** Minutes east of UTC; Colombia = -300. Windows renew at local midnight (week starts Monday). */
  utcOffsetMinutes: number;
}

export const DEFAULT_BUDGET: BudgetConfig = { dailyLimitUsd: 1, weeklyLimitUsd: 5, utcOffsetMinutes: -300 };

export interface LedgerEntry {
  t: number;
  usd: number;
  model: string;
  task: string;
  inTokens: number;
  outTokens: number;
}

export type WindowKind = 'day' | 'week';
const DAY = 86_400_000;

export interface WindowStatus {
  spent: number;
  limit: number;
  pct: number;
  resetsAt: number;
}

export interface BudgetStatus {
  day: WindowStatus;
  week: WindowStatus;
  blocked: boolean;
  /** When spending is allowed again (null if not blocked). */
  resumeAt: number | null;
}

export class BudgetMeter {
  /** Spend reported by the Claude account (Admin API), per window. See createAccountSpend. */
  external: Partial<Record<WindowKind, { usd: number; windowStart: number }>> = {};

  constructor(
    public cfg: BudgetConfig = DEFAULT_BUDGET,
    public ledger: LedgerEntry[] = [],
    private now: () => number = Date.now,
  ) {}

  windowStart(kind: WindowKind, at = this.now()): number {
    const shift = this.cfg.utcOffsetMinutes * 60_000;
    const dayIndex = Math.floor((at + shift) / DAY);
    // 1970-01-01 was a Thursday -> Monday-based weekday index
    const back = kind === 'day' ? 0 : (dayIndex + 3) % 7;
    return (dayIndex - back) * DAY - shift;
  }

  windowEnd(kind: WindowKind, at = this.now()): number {
    return this.windowStart(kind, at) + (kind === 'day' ? DAY : 7 * DAY);
  }

  /** Larger of: what this app recorded, and what the account itself reports for the same window. */
  spent(kind: WindowKind, at = this.now()): number {
    const from = this.windowStart(kind, at);
    const local = this.ledger.filter((e) => e.t >= from && e.t <= at).reduce((s, e) => s + e.usd, 0);
    const ext = this.external[kind];
    return Math.max(local, ext && ext.windowStart === from ? ext.usd : 0);
  }

  setExternal(kind: WindowKind, usd: number, at = this.now()): void {
    this.external[kind] = { usd, windowStart: this.windowStart(kind, at) };
  }

  private win(kind: WindowKind): WindowStatus {
    const limit = kind === 'day' ? this.cfg.dailyLimitUsd : this.cfg.weeklyLimitUsd;
    const spent = this.spent(kind);
    return { spent, limit, pct: limit > 0 ? Math.min(1, spent / limit) : 1, resetsAt: this.windowEnd(kind) };
  }

  status(): BudgetStatus {
    const day = this.win('day');
    const week = this.win('week');
    const blockers = [day, week].filter((w) => w.spent >= w.limit);
    return {
      day,
      week,
      blocked: blockers.length > 0,
      resumeAt: blockers.length ? Math.max(...blockers.map((w) => w.resetsAt)) : null,
    };
  }

  /** Can a call with this (upper-bound) estimated cost run now? Otherwise says when it can. */
  canAfford(estUsd: number): { ok: true } | { ok: false; resumeAt: number | null; reason: string } {
    const blocked: WindowStatus[] = [];
    for (const w of [this.win('day'), this.win('week')]) {
      if (estUsd > w.limit) return { ok: false, resumeAt: null, reason: 'task larger than the whole budget window' };
      if (w.spent + estUsd > w.limit) blocked.push(w);
    }
    if (!blocked.length) return { ok: true };
    return { ok: false, resumeAt: Math.max(...blocked.map((w) => w.resetsAt)), reason: 'budget window exhausted' };
  }

  record(e: LedgerEntry): void {
    this.ledger.push(e);
    const cutoff = this.now() - 15 * DAY;
    this.ledger = this.ledger.filter((x) => x.t >= cutoff);
  }
}
