import { assertEquals } from '@std/assert';
import { decodeEntities, encodeEntities, getAttr, getTagBlocks, getTagText } from '../xml.ts';

Deno.test('encodeEntities escapes all five predefined entities', () => {
  // `'` is emitted as the numeric &#39; (std default), which is valid XML.
  assertEquals(encodeEntities('a&b<c>"d\''), 'a&amp;b&lt;c&gt;&quot;d&#39;');
});

Deno.test('encode/decode round-trips', () => {
  const s = 'x-sonos-spotify:spotify%3Atrack%3A1?sid=12&flags=32&sn=1';
  assertEquals(decodeEntities(encodeEntities(s)), s);
});

Deno.test('decodeEntities handles numeric apostrophe', () => {
  assertEquals(decodeEntities('it&#39;s &amp; that'), "it's & that");
});

Deno.test('decodeEntities handles both apostrophe forms', () => {
  // &apos; is XML-only; &#39; is what we emit — both must decode.
  assertEquals(decodeEntities('it&apos;s vs it&#39;s'), "it's vs it's");
});

Deno.test('decodeEntities decodes decimal & hex numeric entities (regression)', () => {
  // The old hand-rolled decoder only knew &#39;/&#34; and passed these through.
  assertEquals(decodeEntities('Caf&#233; &#8212; Beatles'), 'Café — Beatles');
  assertEquals(decodeEntities('Caf&#xe9; &#x2014; Beatles'), 'Café — Beatles');
});

Deno.test('double-decode recovers nested DIDL (resMD style)', () => {
  const inner = '<DIDL-Lite>&meta</DIDL-Lite>';
  const onceEncoded = encodeEntities(inner);
  const twiceEncoded = encodeEntities(onceEncoded);
  assertEquals(decodeEntities(decodeEntities(twiceEncoded)), inner);
});

Deno.test('getTagText pulls namespaced tag content', () => {
  assertEquals(
    getTagText('<a><dc:title>Hello</dc:title></a>', 'dc:title'),
    'Hello',
  );
  assertEquals(getTagText('<a/>', 'missing'), undefined);
});

Deno.test('getTagBlocks returns each block incl. self-closing', () => {
  const xml = '<m UUID="1"/><m UUID="2">x</m>';
  assertEquals(getTagBlocks(xml, 'm'), ['<m UUID="1"/>', '<m UUID="2">x</m>']);
});

Deno.test('getAttr reads an attribute', () => {
  assertEquals(
    getAttr('<m UUID="abc" ZoneName="Office"/>', 'ZoneName'),
    'Office',
  );
  assertEquals(getAttr('<m/>', 'UUID'), undefined);
});
