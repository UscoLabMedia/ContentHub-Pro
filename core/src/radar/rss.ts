// Tiny RSS/XML reader (no dependencies) for the handful of public feeds the radar uses.
const ENT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export const decode = (s: string): string =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
      if (e[0] === '#') {
        const code = e[1]!.toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : m;
      }
      return ENT[e.toLowerCase()] ?? m;
    })
    .replace(/<[^>]+>/g, '')
    .trim();

const re = (name: string) => new RegExp(`<${name.replace(':', '\\:')}(?:\\s[^>]*)?>([\\s\\S]*?)</${name.replace(':', '\\:')}>`, 'gi');

/** Blocks of every `<name>…</name>` in `xml` (raw inner XML). */
export function blocks(xml: string, name: string): string[] {
  return [...xml.matchAll(re(name))].map((m) => m[1]!);
}

export function tag(xml: string, name: string): string | undefined {
  const m = re(name).exec(xml);
  return m ? decode(m[1]!) : undefined;
}

export function attr(xml: string, name: string, attribute: string): string | undefined {
  const m = new RegExp(`<${name.replace(':', '\\:')}\\s[^>]*${attribute}="([^"]*)"`, 'i').exec(xml);
  return m ? decode(m[1]!) : undefined;
}
