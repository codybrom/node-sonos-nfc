// Minimal, dependency-free XML helpers for talking to Sonos over SOAP.
// We only ever build small request bodies and pull a handful of fields out of
// responses, so hand-rolled entity handling + regex extraction is enough — no
// XML library required.

// Encode a string for safe inclusion in XML text/attributes.
// Order matters: `&` must be escaped first or it would double-escape the others.
export function encodeEntities(str: string): string {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// Decode XML entities, including numeric forms. Sonos sometimes double-encodes
// nested DIDL (e.g. a Browse <Result>, or a favorite's <r:resMD>), so callers
// may need to run this twice.
export function decodeEntities(str: string): string {
  return String(str)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#0*39;/g, "'")
    .replace(/&#x0*27;/gi, "'")
    .replace(/&#0*34;/g, '"')
    .replace(/&amp;/g, '&'); // last, mirror of encode order
}

// Return the text content of the first <tag>...</tag> (tag may be namespaced,
// e.g. "dc:title" or "r:resMD"). Returns undefined if absent.
export function getTagText(xml: string, tag: string): string | undefined {
  const m = new RegExp(`<${escapeTag(tag)}\\b[^>]*>([\\s\\S]*?)</${escapeTag(tag)}>`).exec(xml);
  return m ? m[1] : undefined;
}

// Return an array of full <tag ...>...</tag> blocks (including self-closing).
export function getTagBlocks(xml: string, tag: string): string[] {
  const t = escapeTag(tag);
  const re = new RegExp(`<${t}\\b[^>]*?/>|<${t}\\b[^>]*>[\\s\\S]*?</${t}>`, 'g');
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
