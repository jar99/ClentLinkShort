import fs from 'node:fs';
const html = fs.readFileSync('index.html','utf8');
const src = html.slice(html.indexOf('const SCHEME_MASK'), html.indexOf('/* --------------------------- redirect'));
const {pack, unpack, HOSTS} = await import('data:text/javascript,' + encodeURIComponent(src + '\nexport {pack, unpack, HOSTS};'));

const CH = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~/?#=&%+,;:@!$*()[]'éüñ日本語кот";
const rnd = n => Math.floor(Math.random()*n);
const pick = a => a[rnd(a.length)];

let fails = 0, n = 0, shorter = 0, modes = {};
for (let i = 0; i < 4000; i++) {
  const host = rnd(2) ? pick(HOSTS) : `${pick(['a','sub','shop','www'])}.example${pick(['.com','.co.uk','.io',''])}`;
  let path = '';
  for (let k = rnd(60); k > 0; k--) path += CH[rnd(CH.length)];
  const url = `${pick(['https','http'])}://${host}${rnd(4)?'/':''}${path}`;
  let src2;
  try { src2 = new URL(url).href; } catch { continue; }
  n++;
  try {
    const code = await pack(src2, {clean:false});
    const back = (await unpack(code)).href;
    if (back !== src2) {
      if (fails++ < 5) console.log(`MISMATCH\n  in : ${src2}\n  out: ${back}\n  code: ${code}`);
    }
    if (code.length < src2.length) shorter++;
    // record which mode won
    const B64="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    const m = (B64.indexOf(code[0]) >> 4) & 3;
    modes[m] = (modes[m]||0)+1;
  } catch (e) { if (fails++ < 5) console.log(`THROW ${src2} :: ${e.message}`); }
}
console.log(`\n${n} random URLs, ${fails} failures`);
console.log(`payload shorter than input: ${(100*shorter/n).toFixed(1)}%`);
console.log(`winning mode: text6=${modes[0]||0} raw=${modes[1]||0} deflate=${modes[2]||0}`);

// hostile fragments must never throw anything unhandled
let crashes = 0;
const B64="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
for (let i = 0; i < 20000; i++) {
  let s = ''; for (let k = rnd(40); k > 0; k--) s += B64[rnd(64)];
  try { const u = await unpack(s); if (!/^(https?|mailto|ftps?|tel|sms|magnet|ipfs|ipns):/.test(u.protocol)) { console.log('BAD SCHEME', u.href); crashes++; } }
  catch (e) { if (!(e instanceof Error)) crashes++; }
}
console.log(`20000 hostile fragments: ${crashes} unsafe outcomes`);
