import fs from 'node:fs';
const html = fs.readFileSync('index.html','utf8');
const start = html.indexOf('const SCHEME_MASK');
const end = html.indexOf('/* --------------------------- redirect');
if (start < 0 || end < 0) throw new Error('anchors not found');
const src = html.slice(start, end);

const mod = await import('data:text/javascript,' + encodeURIComponent(src + '\nexport {pack, unpack, HOSTS};'));
const {pack, unpack} = mod;

const cases = [
  'https://example.com',
  'https://example.com/',
  'https://www.example.com/path/to/page',
  'http://example.com:8080/x?y=1#frag',
  'https://github.com/anthropics/claude-code/blob/main/README.md',
  'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s',
  'https://en.wikipedia.org/wiki/Uniform_Resource_Locator#Syntax',
  'example.com/bare',
  'mailto:someone@example.com?subject=Hi%20there',
  'https://docs.google.com/spreadsheets/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit#gid=0',
  'https://shop.example.co.uk/products/widget-2000?colour=blue&size=large&variant=998877&currency=GBP&ref=homepage-hero-banner-slot-3',
  'https://example.com/' + 'a'.repeat(300),
  'https://www.google.com/search?q=hello+world',
  'https://example.com/unicode/каталог/日本語?q=café',
  'https://user:pw@example.com/secure',
  'ftp://files.example.org/pub/thing.tar.gz',
  'https://example.com/path%20with%20spaces/and+plus',
];

let bad = 0;
for (const c of cases) {
  try {
    const code = await pack(c, {clean:false});
    const back = (await unpack(code)).href;
    const expect = new URL(/^[a-z][a-z0-9+.-]*:/i.test(c) ? c : 'https://'+c).href;
    const ok = back === expect;
    if (!ok) bad++;
    console.log(`${ok?'ok  ':'FAIL'}  ${String(code.length).padStart(3)}c  ${c.slice(0,60)}`);
    if (!ok) console.log(`        got: ${back}\n        exp: ${expect}`);
  } catch (e) {
    bad++; console.log(`ERR   ${c.slice(0,60)} :: ${e.message}`);
  }
}

console.log('\n--- tracking strip ---');
for (const c of [
  'https://www.youtube.com/watch?v=abc123&utm_source=news&utm_medium=email&si=xyz',
  'https://example.com/p?utm_campaign=x',
  'https://example.com/p?a=1&fbclid=IwAR0123456789&b=2',
]) {
  const code = await pack(c, {clean:true});
  console.log(`  ${(await unpack(code)).href}`);
}

console.log('\n--- rejections (should all throw) ---');
for (const c of ['javascript:alert(1)', 'data:text/html,<script>x', '   ', 'https://', 'vbscript:x']) {
  try { await pack(c,{clean:true}); console.log(`  FAIL accepted: ${c}`); bad++; }
  catch(e) { console.log(`  ok rejected "${c.trim()||'(empty)'}" -> ${e.message}`); }
}
console.log('\n--- corrupt payloads (should all throw) ---');
for (const c of ['', 'AAAA!!', 'CA', 'EQ', '____________']) {
  try { const r = await unpack(c); console.log(`  accepted "${c}" -> ${r.href}`); }
  catch(e) { console.log(`  ok rejected "${c}" -> ${e.message}`); }
}
console.log(bad ? `\n${bad} FAILURES` : '\nall round-trips passed');
