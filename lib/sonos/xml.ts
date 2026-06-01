// Small, dependency-free XML helpers for talking to Sonos over SOAP. We only
// build tiny request bodies and pull a handful of fields out of responses, so
// hand-rolled entity coding + regex extraction is enough — no XML library, and a
// regex walk is immune to XXE / entity-expansion attacks on the semi-trusted
// DIDL we parse.

// Encode a string for safe inclusion in XML text/attributes. `'` becomes the
// numeric `&#39;` (valid everywhere, unlike the XML-only `&apos;`).
// Order matters: `&` must be escaped first or it would double-escape the others.
export function encodeEntities(str: string): string {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Decode XML entities: the five predefined ones, plus every numeric character
// reference (decimal & hex) — e.g. a track title's `Caf&#233;`/`&#x2014;`. Sonos
// sometimes double-encodes nested DIDL (a Browse <Result>, a favorite's
// <r:resMD>), so callers may need to run this twice.
export function decodeEntities(str: string): string {
  return String(str)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&amp;/g, '&'); // last, mirror of encode order
}

// Return the text content of the first <tag>...</tag> (tag may be namespaced,
// e.g. "dc:title" or "r:resMD"). Returns undefined if absent.
export function getTagText(xml: string, tag: string): string | undefined {
  const m = new RegExp(
    `<${escapeTag(tag)}\\b[^>]*>([\\s\\S]*?)</${escapeTag(tag)}>`,
  ).exec(xml);
  return m ? m[1] : undefined;
}

// Return an array of full <tag ...>...</tag> blocks (including self-closing).
export function getTagBlocks(xml: string, tag: string): string[] {
  const t = escapeTag(tag);
  const re = new RegExp(
    `<${t}\\b[^>]*?/>|<${t}\\b[^>]*>[\\s\\S]*?</${t}>`,
    'g',
  );
  return xml.match(re) || [];
}

// Return the value of attr="..." from a single opening tag string.
export function getAttr(tagStr: string, attr: string): string | undefined {
  const m = new RegExp(`\\b${attr}="([^"]*)"`).exec(tagStr);
  return m ? m[1] : undefined;
}

function escapeTag(tag: string): string {
  return tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
