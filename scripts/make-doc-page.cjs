// 資料ページ（Artifact）の HTML を作る: node scripts/make-doc-page.cjs <テンプレート.html> <データ.json> <出力.html>
// テンプレートの __DATA__ にデータ、__VERSION__ に data/site.json の appVersion を入れる
const fs = require('fs');
const [tpl, data, out] = process.argv.slice(2);
const json = fs.readFileSync(data, 'utf8').trim().replace(/</g, '\u003c');
const version = JSON.parse(fs.readFileSync('data/site.json', 'utf8')).appVersion;
fs.writeFileSync(out, fs.readFileSync(tpl, 'utf8').replace('__DATA__', () => json).replace('__VERSION__', version));
console.log(out, Math.round(fs.statSync(out).size / 1024) + 'KB');
