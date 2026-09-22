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

var backtest = new Function('FEE_PCT', 'return ' + extractFn(html, 'backtest'))(0.1);

function close(v) { return { time: 1700000000 + v * 3600, open: 0, high: 0, low: 0, close: 0 }; }

// 场景 1：价格恒定 100，bar10 买 bar20 卖 → 纯手续费损耗
var candles1 = [];
for (var i = 0; i < 30; i++) {
  var b = close(i); b.open = b.high = b.low = b.close = 100;
  candles1.push(b);
}
var s1 = backtest(candles1, [
  { time: candles1[10].time, index: 10, dir: 'buy' },
  { time: candles1[20].time, index: 20, dir: 'sell' }
], 0);

var fails = [];
if (s1.eqSeries.length !== 30) fails.push('eqSeries length should be 30, got ' + s1.eqSeries.length);
// 空仓段权益恒 1
for (var a = 0; a < 10; a++) if (Math.abs(s1.eqSeries[a].eq - 1) > 1e-9) fails.push('flat eq@' + a + ' should be 1');
// 持仓段：1 × (100×0.999)/(100×1.001)
var holdEq = 0.999 / 1.001;
for (var h = 10; h < 20; h++) if (Math.abs(s1.eqSeries[h].eq - holdEq) > 1e-9) fails.push('holding eq@' + h + ' should be ' + holdEq + ', got ' + s1.eqSeries[h].eq);
// 平仓后保持
if (Math.abs(s1.eqSeries[29].eq - holdEq) > 1e-9) fails.push('post-exit eq should stay ' + holdEq);
// 末点与 strategyRet 一致
if (Math.abs(s1.eqSeries[29].eq * 100 - (100 + s1.strategyRet)) > 1e-6) fails.push('eqSeries[last] inconsistent with strategyRet');
// basePrice
if (s1.basePrice !== 100) fails.push('basePrice should be 100');

// 场景 2：bar10 买 @100，bar15 close=110（浮盈），bar20 卖 @121
var candles2 = [];
for (var i2 = 0; i2 < 30; i2++) {
  var b2 = close(i2);
  var px = i2 < 10 ? 100 : (i2 < 20 ? 100 + (i2 - 9) : 121);
  b2.open = b2.high = b2.low = b2.close = px;
  candles2.push(b2);
}
var s2 = backtest(candles2, [
  { time: candles2[10].time, index: 10, dir: 'buy' },
  { time: candles2[20].time, index: 20, dir: 'sell' }
], 0);

// bar15：entry=110（bar10 close=100+1=101？）—— 价格段：i2=10 → px=101，i2=15 → 106，i2=20 → 121
// entry = candles2[10].close = 101；bar15 close = 106
var expect15 = (106 * 0.999) / (101 * 1.001);
if (Math.abs(s2.eqSeries[15].eq - expect15) > 1e-9) fails.push('floating eq@15 should be ' + expect15 + ', got ' + s2.eqSeries[15].eq);
// 末点 vs strategyRet
if (Math.abs(s2.eqSeries[29].eq * 100 - (100 + s2.strategyRet)) > 1e-6) fails.push('s2 eqSeries[last] inconsistent with strategyRet');

// 场景 3：止损（数组止损 + 数字止损同源）—— eq 末点一致
var candles3 = [];
for (var i3 = 0; i3 < 30; i3++) {
  var b3 = close(i3);
  var px3 = i3 < 10 ? 100 : (i3 === 15 ? 90 : (i3 < 15 ? 100 - (i3 - 10) : 90));
  b3.open = 100; b3.close = px3; b3.high = Math.max(100, px3); b3.low = px3; // low 触发止损
  candles3.push(b3);
}
var s3 = backtest(candles3, [{ time: candles3[10].time, index: 10, dir: 'buy' }], 5);
if (!s3.stopped) fails.push('s3 should be stopped');
if (Math.abs(s3.eqSeries[29].eq * 100 - (100 + s3.strategyRet)) > 1e-6) fails.push('s3 eqSeries[last] inconsistent with strategyRet');

if (fails.length) {
  console.log('FAILED:\n  ' + fails.join('\n  '));
  process.exit(1);
}
console.log('EQUITY-SERIES VERIFIED: flat=1 / holding fees ' + holdEq.toFixed(6) + ' / floating P&L @15=' + expect15.toFixed(6) + ' / endpoint==strategyRet (3 scenarios incl. stop)');
