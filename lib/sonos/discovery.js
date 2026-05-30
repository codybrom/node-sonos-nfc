// SSDP discovery of any Sonos ZonePlayer on the LAN, using native UDP (dgram).
// We only need ONE reachable player to bootstrap; topology (all rooms/groups) is
// then fetched from it via SOAP. Multicast must reach the player, so this is
// expected to run on the same L2 network as the speakers (e.g. the Pi).

import dgram from 'node:dgram';

const SSDP_ADDR = '239.255.255.250';
const SSDP_PORT = 1900;
const TARGET = 'urn:schemas-upnp-org:device:ZonePlayer:1';

const M_SEARCH = Buffer.from(
  [
    'M-SEARCH * HTTP/1.1',
    `HOST: ${SSDP_ADDR}:${SSDP_PORT}`,
    'MAN: "ssdp:discover"',
    'MX: 1',
    `ST: ${TARGET}`,
    '',
    '',
  ].join('\r\n')
);

// Resolve to { ip } of the first ZonePlayer that answers, or reject on timeout.
export function discoverAnyPlayer({ timeout = 5000 } = {}) {
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    let done = false;
    let retryTimer;

    const finish = (err, ip) => {
      if (done) return;
      done = true;
      clearInterval(retryTimer);
      clearTimeout(deadline);
      try {
        socket.close();
      } catch {
        /* already closed */
      }
      err ? reject(err) : resolve({ ip });
    };

    socket.on('error', (err) => finish(err));

    socket.on('message', (msg, rinfo) => {
      const text = msg.toString('ascii');
      if (text.includes(TARGET) && /\r\nLOCATION:/i.test(text)) {
        finish(null, rinfo.address);
      }
    });

    socket.bind(() => {
      try {
        socket.setBroadcast(true);
        socket.setMulticastTTL(2);
      } catch {
        /* some platforms restrict these; multicast send still works */
      }
      const send = () => {
        if (!done) socket.send(M_SEARCH, 0, M_SEARCH.length, SSDP_PORT, SSDP_ADDR);
      };
      send();
      retryTimer = setInterval(send, 1000);
    });

    const deadline = setTimeout(
      () => finish(new Error(`No Sonos ZonePlayer found within ${timeout}ms (SSDP)`)),
      timeout
    );
  });
}
