// Native SOAP transport for Sonos UPnP control. Uses the runtime's built-in
// fetch (Node 18+/24) — no `request`, no HTTP library.

// Control endpoint paths (relative to http://<player-ip>:1400).
export const PATH = Object.freeze({
  AVTransport: '/MediaRenderer/AVTransport/Control',
  RenderingControl: '/MediaRenderer/RenderingControl/Control',
  ContentDirectory: '/MediaServer/ContentDirectory/Control',
  MusicServices: '/MusicServices/Control',
  ZoneGroupTopology: '/ZoneGroupTopology/Control',
});

// Service URNs used to build the SOAPACTION header and the body's xmlns:u.
export const URN = Object.freeze({
  AVTransport: 'urn:schemas-upnp-org:service:AVTransport:1',
  RenderingControl: 'urn:schemas-upnp-org:service:RenderingControl:1',
  ContentDirectory: 'urn:schemas-upnp-org:service:ContentDirectory:1',
  MusicServices: 'urn:schemas-upnp-org:service:MusicServices:1',
  ZoneGroupTopology: 'urn:schemas-upnp-org:service:ZoneGroupTopology:1',
});

const ENVELOPE_OPEN =
  '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" ' +
  's:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body>';
const ENVELOPE_CLOSE = '</s:Body></s:Envelope>';

export function buildEnvelope(innerXml) {
  return ENVELOPE_OPEN + innerXml + ENVELOPE_CLOSE;
}

// Build the SOAP body for an action: <u:Action xmlns:u="urn">...args...</u:Action>
export function buildBody(urn, action, argsXml = '') {
  return `<u:${action} xmlns:u="${urn}">${argsXml}</u:${action}>`;
}

// POST a SOAP action to a player and return the raw response body text.
// Throws on non-2xx (with status + body for diagnostics) or timeout.
export async function invoke(baseUrl, path, urn, action, argsXml = '', { timeout = 4000 } = {}) {
  const body = buildEnvelope(buildBody(urn, action, argsXml));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const res = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'CONTENT-TYPE': 'text/xml; charset="utf-8"',
        SOAPACTION: `"${urn}#${action}"`,
      },
      body,
      signal: controller.signal,
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`SOAP ${action} -> HTTP ${res.status}: ${text.slice(0, 300)}`);
    }
    return text;
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error(`SOAP ${action} timed out after ${timeout}ms (${baseUrl}${path})`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
