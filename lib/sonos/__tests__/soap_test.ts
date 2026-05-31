import { assertEquals } from '@std/assert';
import { buildBody, buildEnvelope, PATH, URN } from '../soap.ts';

Deno.test('buildEnvelope wraps the SOAP body', () => {
  assertEquals(
    buildEnvelope('<x/>'),
    '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" ' +
      's:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body><x/></s:Body></s:Envelope>',
  );
});

Deno.test('buildBody namespaces the action and embeds args', () => {
  assertEquals(
    buildBody(URN.AVTransport, 'Play', '<InstanceID>0</InstanceID><Speed>1</Speed>'),
    '<u:Play xmlns:u="urn:schemas-upnp-org:service:AVTransport:1">' +
      '<InstanceID>0</InstanceID><Speed>1</Speed></u:Play>',
  );
});

Deno.test('control paths and URNs are the Sonos-expected values', () => {
  assertEquals(PATH.AVTransport, '/MediaRenderer/AVTransport/Control');
  assertEquals(PATH.ContentDirectory, '/MediaServer/ContentDirectory/Control');
  assertEquals(URN.ContentDirectory, 'urn:schemas-upnp-org:service:ContentDirectory:1');
});
