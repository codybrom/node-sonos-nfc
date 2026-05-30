import { buildEnvelope, buildBody, PATH, URN } from '../soap.js';

test('buildEnvelope wraps the SOAP body', () => {
  expect(buildEnvelope('<x/>')).toBe(
    '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" ' +
      's:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body><x/></s:Body></s:Envelope>'
  );
});

test('buildBody namespaces the action and embeds args', () => {
  expect(buildBody(URN.AVTransport, 'Play', '<InstanceID>0</InstanceID><Speed>1</Speed>')).toBe(
    '<u:Play xmlns:u="urn:schemas-upnp-org:service:AVTransport:1">' +
      '<InstanceID>0</InstanceID><Speed>1</Speed></u:Play>'
  );
});

test('control paths and URNs are the Sonos-expected values', () => {
  expect(PATH.AVTransport).toBe('/MediaRenderer/AVTransport/Control');
  expect(PATH.ContentDirectory).toBe('/MediaServer/ContentDirectory/Control');
  expect(URN.ContentDirectory).toBe('urn:schemas-upnp-org:service:ContentDirectory:1');
});
