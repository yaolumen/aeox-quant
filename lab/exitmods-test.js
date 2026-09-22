var fs = require('fs');
var html = fs.readFileSync(require('path').join(__dirname, '..', 'index.html'), 'utf8');

function extractFn(src, name) {
  var i = src.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('fn not found: ' + name);
  var p = src.indexOf('(', i), depth = 0;
  for (var j = p; j < src.length; j++) {
    if (src[j] === '(') depth++;
    else if (src[j] === ')') { depth--; if (!depth) break; }
  }
  var b = src.indexOf('{', j);
  depth = 0;
  for (var k = b; k < src.length; k++) {
    if (src[k] === '{') depth++;
    else if (src[k] === '}') { depth--; if (!depth) return src.slice(i, k + 1); }
  }
  throw new Error('unbalanced: ' + name);
}

function build(st) {
  var deps = [
    extractFn(html, 'clamp'),
    extractFn(html, 'closes'),
    extractFn(html, 'sma'),
    extractFn(html, 'ema'),
    extractFn(html, 'calcRSI'),
    extractFn(html, 'regimeSeries'),
    'var state = ' + JSON.stringify(st) + ';',
    extractFn(html, 'applyExitMods'),
    'return applyExitMods;'
  ].join('\n');
  return new Function(deps)();
}

function buildRegimeSer() {
  var deps = [
    extractFn(html, 'clamp'),
    extractFn(html, 'closes'),
    extractFn(html, 'ema'),
    extractFn(html, 'regimeSeries'),
    'return regimeSeries;'
  ].join('\n');
  return new Function(deps)();
}

function buildRsi() {
  return new Function('return ' + extractFn(html, 'calcRSI'))();
}

// ---- 合成数据 ----
// 0-249 横盘 100（EMA200 于 bar199 起有效，regime≈0）→ 250-299 深跌 ×0.99（regime < -40）→ 300-449 反弹 ×1.005
var candles = [];
var price = 100;
for (var i = 0; i < 450; i++) {
  if (i >= 250 && i < 300) price *= 0.99;
  else if (i >= 300) price *= 1.005;
  candles.push({ time: 1700000000 + i * 3600, open: price, high: price * 1.001, low: price * 0.999, close: price });
}

var events = [
  { time: candles[299].time, index: 299, dir: 'buy' },
  { time: candles[350].time, index: 350, dir: 'sell' },
  { time: candles[420].time, index: 420, dir: 'buy' }
];

var fails = [];

// T1: 默认关闭 → 原样返回
var t1 = build({ regimeFilter: false, quickExit: false })(candles, events);
if (!(t1 === events || (t1.length === events.length && t1.every(function (e, k) { return e === events[k]; })))) fails.push('T1 default-off passthrough');

// T2: regimeFilter 开 → 深跌段 buy@299 被滤掉，sell@350 与反弹段 buy@420 保留
var rs = buildRegimeSer()(candles);
if (!(rs[299] !== null && rs[299] <= -40)) fails.push('T2 sanity: regime@299 should be <= -40, got ' + rs[299]);
if (!(rs[420] !== null && rs[420] > -40)) fails.push('T2 sanity: regime@420 should be > -40, got ' + rs[420]);
var t2 = build({ regimeFilter: true, quickExit: false })(candles, events);
var t2idx = t2.map(function (e) { return e.index + ':' + e.dir; });
if (t2idx.indexOf('299:buy') >= 0) fails.push('T2 filter should drop deep-bear buy@299, got: ' + t2idx.join(','));
if (t2idx.indexOf('350:sell') < 0) fails.push('T2 filter must keep sell@350');
if (t2idx.indexOf('420:buy') < 0) fails.push('T2 filter must keep rebound buy@420');

// T3: quickExit 开 → 原 sell@350 移除，替换为 RSI14>70 crossing；buy 全保留；index 有序
var t3 = build({ regimeFilter: false, quickExit: true })(candles, events);
var r14 = buildRsi()(candles.map(function (c) { return c.close; }), 14);
t3.filter(function (e) { return e.dir === 'sell'; }).forEach(function (e) {
  if (!(r14[e.index] !== null && r14[e.index - 1] !== null && r14[e.index] > 70 && r14[e.index - 1] <= 70)) fails.push('T3 sell@' + e.index + ' not an RSI14>70 crossing');
});
if (t3.filter(function (e) { return e.dir === 'buy'; }).length !== 2) fails.push('T3 buys must be preserved (2)');
for (var q = 1; q < t3.length; q++) if (t3[q].index < t3[q - 1].index) fails.push('T3 events must be index-sorted');

// T4: 两个开关同开 → buy@299 滤掉 + sell 替换，仅剩 buy@420
var t4 = build({ regimeFilter: true, quickExit: true })(candles, events);
if (t4.some(function (e) { return e.index === 299; })) fails.push('T4 buy@299 must be dropped');
if (t4.filter(function (e) { return e.dir === 'buy'; }).length !== 1) fails.push('T4 buys must be 1 (only @420)');
if (!(t4.filter(function (e) { return e.dir === 'buy'; })[0] || {}).index === 420) fails.push('T4 remaining buy must be @420');

if (fails.length) {
  console.log('FAILED:\n  ' + fails.join('\n  '));
  process.exit(1);
}
console.log('EXIT-MODS VERIFIED: T1 passthrough / T2 regime filter (drop @299, keep @350/@420, regime@299=' + rs[299].toFixed(1) + ' @420=' + rs[420].toFixed(1) + ') / T3 quick-exit swap + sort / T4 combined');
