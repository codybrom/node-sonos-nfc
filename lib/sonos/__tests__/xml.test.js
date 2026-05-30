import { encodeEntities, decodeEntities, getTagText, getTagBlocks, getAttr } from '../xml.js';

test('encodeEntities escapes & first', () => {
  expect(encodeEntities('a&b<c>"d\'')).toBe('a&amp;b&lt;c&gt;&quot;d&apos;');
});

test('encode/decode round-trips', () => {
  const s = 'x-sonos-spotify:spotify%3Atrack%3A1?sid=12&flags=32&sn=1';
  expect(decodeEntities(encodeEntities(s))).toBe(s);
});

test('decodeEntities handles numeric apostrophe', () => {
  expect(decodeEntities('it&#39;s &amp; that')).toBe("it's & that");
});

test('double-decode recovers nested DIDL (resMD style)', () => {
  const inner = '<DIDL-Lite>&meta</DIDL-Lite>';
  const onceEncoded = encodeEntities(inner); // as embedded in a Result
  const twiceEncoded = encodeEntities(onceEncoded); // wire form
  expect(decodeEntities(decodeEntities(twiceEncoded))).toBe(inner);
});

test('getTagText pulls namespaced tag content', () => {
  expect(getTagText('<a><dc:title>Hello</dc:title></a>', 'dc:title')).toBe('Hello');
  expect(getTagText('<a/>', 'missing')).toBeUndefined();
});

test('getTagBlocks returns each block incl. self-closing', () => {
  const xml = '<m UUID="1"/><m UUID="2">x</m>';
  expect(getTagBlocks(xml, 'm')).toEqual(['<m UUID="1"/>', '<m UUID="2">x</m>']);
});

test('getAttr reads an attribute', () => {
  expect(getAttr('<m UUID="abc" ZoneName="Office"/>', 'ZoneName')).toBe('Office');
  expect(getAttr('<m/>', 'UUID')).toBeUndefined();
});
