// Zero-token metrics ingestion helpers: number parsing, header aliases, text extraction, digest.
export const METRICS = ['views', 'likes', 'comments', 'shares', 'saves', 'reach', 'impressions', 'followers', 'watchTimeMin'] as const;
export type Metric = (typeof METRICS)[number];

const ALIASES: Record<Metric | 'title' | 'date', string[]> = {
  views: ['views', 'video views', 'vistas', 'reproducciones', 'plays', 'visualizaciones'],
  likes: ['likes', 'me gusta', 'reacciones', 'reactions'],
  comments: ['comments', 'comentarios'],
  shares: ['shares', 'compartidos', 'veces compartido', 'veces compartida'],
  saves: ['saves', 'guardados', 'veces guardado'],
  reach: ['reach', 'alcance', 'cuentas alcanzadas'],
  impressions: ['impressions', 'impresiones'],
  followers: ['followers', 'seguidores', 'new followers', 'nuevos seguidores'],
  watchTimeMin: ['watch time', 'watch time (minutes)', 'tiempo de reproduccion', 'tiempo de visualizacion'],
  title: ['title', 'titulo', 'post', 'publicacion', 'video title', 'video'],
  date: ['date', 'fecha', 'publish time', 'fecha de publicacion'],
};

export const norm = (s: string): string =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

export function canonicalKey(header: string): Metric | 'title' | 'date' | null {
  const h = norm(header);
  for (const [k, list] of Object.entries(ALIASES)) if (list.includes(h)) return k as Metric | 'title' | 'date';
  return null;
}

/** "1.2K", "3,4 mil", "1.234", "1,234.5", "2M" -> number. */
export function parseNumber(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== 'string') return null;
  const m = norm(raw).replace(/\s+/g, ' ').match(/^(-?\d[\d.,]*)\s*(k|m|mil)?\b/);
  if (!m) return null;
  let n = m[1]!;
  const lastDot = n.lastIndexOf('.');
  const lastComma = n.lastIndexOf(',');
  if (lastDot >= 0 && lastComma >= 0) {
    const dec = lastDot > lastComma ? '.' : ',';
    n = n.split(dec === '.' ? ',' : '.').join('').replace(dec, '.');
  } else if (lastComma >= 0) {
    n = /^\d{1,3}(,\d{3})+$/.test(n) ? n.replace(/,/g, '') : n.replace(',', '.');
  } else if (lastDot >= 0 && /^\d{1,3}(\.\d{3})+$/.test(n)) {
    n = n.replace(/\./g, '');
  }
  const v = parseFloat(n);
  if (!Number.isFinite(v)) return null;
  const mult = m[2] === 'k' || m[2] === 'mil' ? 1e3 : m[2] === 'm' ? 1e6 : 1;
  return v * mult;
}

export interface MetricRow {
  title?: string;
  date?: string;
  values: Partial<Record<Metric, number>>;
}

export function rowsFromRecords(records: Record<string, unknown>[]): MetricRow[] {
  return records.map((rec) => {
    const row: MetricRow = { values: {} };
    for (const [h, v] of Object.entries(rec)) {
      const k = canonicalKey(h);
      if (!k) continue;
      if (k === 'title' || k === 'date') row[k] = String(v ?? '');
      else {
        const n = parseNumber(v);
        if (n !== null) row.values[k] = n;
      }
    }
    return row;
  });
}

/** Best-effort "label: number" extraction from OCR/PDF text. */
export function rowFromText(text: string): MetricRow {
  const t = norm(text);
  const values: Partial<Record<Metric, number>> = {};
  for (const metric of METRICS) {
    for (const alias of ALIASES[metric]) {
      const a = alias.replace(/[()]/g, '\\$&');
      const after = t.match(new RegExp(`${a}\\s*[:\\-]?\\s*(\\d[\\d.,]*\\s*(?:mil|k|m)?)`));
      const before = t.match(new RegExp(`(\\d[\\d.,]*\\s*(?:mil|k|m)?)\\s+${a}\\b`));
      const n = parseNumber((after ?? before)?.[1] ?? '');
      if (n !== null) {
        values[metric] = n;
        break;
      }
    }
  }
  return { values };
}

export interface Digest {
  source: string;
  rows: number;
  totals: Partial<Record<Metric, number>>;
  top: { title: string; metric: Metric; value: number }[];
  engagementRate?: number;
}

export function buildDigest(source: string, rows: MetricRow[]): Digest {
  const totals: Partial<Record<Metric, number>> = {};
  for (const r of rows) for (const [k, v] of Object.entries(r.values)) totals[k as Metric] = (totals[k as Metric] ?? 0) + (v as number);
  const rankBy: Metric = totals.views !== undefined ? 'views' : totals.reach !== undefined ? 'reach' : (Object.keys(totals)[0] as Metric);
  const top = rankBy
    ? rows
        .filter((r) => r.title && r.values[rankBy] !== undefined)
        .sort((a, b) => (b.values[rankBy] ?? 0) - (a.values[rankBy] ?? 0))
        .slice(0, 5)
        .map((r) => ({ title: r.title!.slice(0, 80), metric: rankBy, value: r.values[rankBy]! }))
    : [];
  const base = totals.views ?? totals.reach ?? totals.impressions;
  const inter = (totals.likes ?? 0) + (totals.comments ?? 0) + (totals.shares ?? 0) + (totals.saves ?? 0);
  const engagementRate = base && inter ? Math.round((inter / base) * 10_000) / 100 : undefined;
  return { source, rows: rows.length, totals, top, engagementRate };
}

/** Compact text for the AI: a few hundred tokens regardless of file size. */
export function digestToPrompt(d: Digest): string {
  const tot = Object.entries(d.totals).map(([k, v]) => `${k}=${v}`).join(', ');
  const top = d.top.map((t, i) => `${i + 1}. ${t.title} (${t.metric}=${t.value})`).join('\n');
  return [`Fuente: ${d.source}; filas: ${d.rows}`, `Totales: ${tot || 'n/d'}`, d.engagementRate !== undefined ? `Engagement %: ${d.engagementRate}` : '', top ? `Top:\n${top}` : '']
    .filter(Boolean)
    .join('\n');
}
