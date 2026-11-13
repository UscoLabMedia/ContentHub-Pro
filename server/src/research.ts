// AI-assisted source finding: the model searches the web per scene, then EVERY cited page is opened locally
// and checked for the claimed figures/quotes. Nothing the model says is trusted without that check.
import { searchFree, splitClaims, textKey, type Gateway, type SceneCheck } from '@chp/core';
import { checkMany } from './verify.ts';

const BATCH = 8;

export interface ResearchScene {
  text: string;
}

export async function researchScenes(gw: Gateway, scenes: ResearchScene[], onProgress: (pct: number, label: string) => void): Promise<SceneCheck[]> {
  const keyed = scenes.map((s) => ({ key: textKey(s.text), text: s.text.replace(/\s+/g, ' ').trim() }));
  // identical scenes share one entry
  const unique = [...new Map(keyed.map((s) => [s.key, s])).values()];
  const found = new Map<string, SceneCheck>();

  for (let i = 0; i < unique.length; i += BATCH) {
    const batch = unique.slice(i, i + BATCH);
    onProgress(5 + Math.round((i / unique.length) * 70), `Buscando fuentes en la web (escenas ${i + 1}-${i + batch.length} de ${unique.length})`);
    const r = await gw.run('verifyClaims', batch.map((b) => `${b.key}|${b.text}`).join('\n'));
    for (const sc of r.data.scenes) {
      if (!batch.some((b) => b.key === sc.key)) continue; // ignore keys the model made up
      found.set(sc.key, {
        textKey: sc.key,
        opinion: sc.opinion && sc.claims.length === 0 ? true : undefined,
        claims: sc.claims.map((c) => ({
          text: c.claim,
          calc: c.calc.trim() || undefined,
          sources: c.sources.filter((s) => /^https?:\/\//i.test(s.url)).map((s) => ({ title: s.title, url: s.url, quote: s.quote || undefined, check: 'unchecked' as const })),
        })),
      });
    }
  }

  // Open every cited page and compare.
  onProgress(80, 'Abriendo cada fuente y comprobando las cifras');
  const flat = [...found.values()].flatMap((c) => c.claims.flatMap((cl) => cl.sources.map((s) => ({ s, claim: cl.text }))));
  const results = await checkMany(flat.map((f) => ({ url: f.s.url, claim: f.claim, quote: f.s.quote })));
  flat.forEach((f, i) => Object.assign(f.s, { check: results[i]!.check, snippet: results[i]!.snippet }));
  onProgress(100, 'Listo');
  return unique.map((u) => found.get(u.key) ?? { textKey: u.key, claims: [] });
}

/**
 * Free search: public APIs (Wikipedia, OpenAlex, datos.gov.co) + the local check. No AI, no plan usage.
 * Every sentence worth checking is recorded; the ones without a source stay visible as pending.
 */
export async function freeResearchScenes(scenes: ResearchScene[], onProgress: (pct: number, label: string) => void): Promise<SceneCheck[]> {
  const unique = [...new Map(scenes.map((s) => [textKey(s.text), s.text.replace(/\s+/g, ' ').trim()])).entries()];
  const cache = new Map<string, Awaited<ReturnType<typeof searchFree>>>();
  const out: SceneCheck[] = new Array(unique.length);
  let next = 0;
  let done = 0;
  await Promise.all(
    Array.from({ length: Math.min(3, unique.length) }, async () => {
      for (;;) {
        const i = next++;
        if (i >= unique.length) return;
        const [key, text] = unique[i]!;
        const claims = [];
        for (const claim of splitClaims(text)) {
          let hits = cache.get(claim);
          if (!hits) cache.set(claim, (hits = await searchFree(claim)));
          claims.push({ text: claim, sources: hits.map((h) => h.source) });
        }
        out[i] = { textKey: key, claims };
        onProgress(Math.round((++done / unique.length) * 100), `Buscando en Wikipedia, OpenAlex y datos abiertos (${done}/${unique.length})`);
      }
    }),
  );
  return out;
}
