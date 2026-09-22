var fs = require('fs');
var html = fs.readFileSync(require('path').join(__dirname, '..', 'index.html'), 'utf8');
var m = html.match(/<script>([\s\S]*?)<\/script>\s*<\/body>/);
var js = m[1];
// keys defined (in I18N dict)
var defined = new Set();
var re = /'([a-z]+\.[a-zA-Z0-9]+)'\s*:/g, mm;
while ((mm = re.exec(js))) defined.add(mm[1]);
// keys used in JS t('...')
var used = new Set();
var re2 = /t\('([a-z]+\.[a-zA-Z0-9]+)'/g;
while ((mm = re2.exec(js))) used.add(mm[1]);
// keys used in HTML data-i18n
var re3 = /data-i18n="([a-z]+\.[a-zA-Z0-9]+)"/g;
while ((mm = re3.exec(html))) used.add(mm[1]);
var missing = [];
used.forEach(function (k) { if (!defined.has(k)) missing.push(k); });
console.log(missing.length ? 'MISSING KEYS: ' + missing.join(', ') : 'ALL ' + used.size + ' USED KEYS RESOLVE (' + defined.size + ' defined)');
// check en/zh parity: count occurrences of each key literal in whole js (should be 2: en+zh)
var bad = [];
defined.forEach(function (k) {
  var c = (js.match(new RegExp("'" + k.replace('.', '\\.') + "':", 'g')) || []).length;
  if (c !== 2) bad.push(k + '(' + c + ')');
});
console.log(bad.length ? 'PARITY ISSUES: ' + bad.join(', ') : 'EN/ZH PARITY OK');
