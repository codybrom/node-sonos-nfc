import { assertEquals } from '@std/assert';
import { decodeEntities, encodeEntities, getAttr, getTagBlocks, getTagText } from '../xml.ts';

Deno.test('encodeEntities escapes & first', () => {
  assertEquals(encodeEntities('a&b<c>"d\''), 'a&amp;b&lt;c&gt;&quot;d&apos;');
});

Deno.test('encode/decode round-trips', () => {
  const s = 'x-sonos-spotify:spotify%3Atrack%3A1?sid=12&flags=32&sn=1';
  assertEquals(decodeEntities(encodeEntities(s)), s);
});

Deno.test('decodeEntities handles numeric apostrophe', () => {
  assertEquals(decodeEntities('it&#39;s &amp; that'), "it's & that");
});

Deno.test('double-decode recovers nested DIDL (resMD style)', () => {
  const inner = '<DIDL-Lite>&meta</DIDL-Lite>';
  const onceEncoded = encodeEntities(inner);
  const twiceEncoded = encodeEntities(onceEncoded);
  assertEquals(decodeEntities(decodeEntities(twiceEncoded)), inner);
});

Deno.test('getTagText pulls namespaced tag content', () => {
  assertEquals(getTagText('<a><dc:title>Hello</dc:title></a>', 'dc:title'), 'Hello');
  assertEquals(getTagText('<a/>', 'missing'), undefined);
});

Deno.test('getTagBlocks returns each block incl. self-closing', () => {
  const xml = '<m UUID="1"/><m UUID="2">x</m>';
  assertEquals(getTagBlocks(xml, 'm'), ['<m UUID="1"/>', '<m UUID="2">x</m>']);
});

Deno.test('getAttr reads an attribute', () => {
  assertEquals(getAttr('<m UUID="abc" ZoneName="Office"/>', 'ZoneName'), 'Office');
  assertEquals(getAttr('<m/>', 'UUID'), undefined);
});
