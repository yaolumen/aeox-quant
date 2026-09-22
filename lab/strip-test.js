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

// 场景：100→200 上升后在 bar100 出 BUY 信号，bar105 暴跌 6%（触发 5% 止损），之后横盘，无 SELL 信号
var candles = [];
for (var i = 0; i < 200; i++) {
  var p = i < 100 ? 100 + i : (i < 105 ? 200 - (i - 100) * 3 : 185);
  var prev = i < 100 ? 99 + i : (i < 105 ? 203 - (i - 100) * 3 : 188);
  candles.push({ time: 1700000000 + i * 3600, open: prev, high: Math.max(p, prev) * 1.002, low: Math.min(p, prev) * (i === 105 ? 0.93 : 0.998), close: p });
}
var events = [{ time: candles[100].time, index: 100, dir: 'buy' }];
var stats = backtest(candles, events, 5);

var te = stats.tradeEvents;
var last = te[te.length - 1];
console.log('open =', stats.open, '| last dir =', last.dir, '| stopped =', !!last.stopped, '| closed =', stats.closed, '| stopped count =', stats.stopped);
var ok = stats.open === false && last.dir === 'sell' && last.stopped === true && stats.closed === 1 && stats.stopped === 1;
console.log(ok ? 'STOP-DIVERGENCE FIX VERIFIED: 止损后状态=空仓+STOP（与图表箭头同源）' : 'FAILED');
process.exit(ok ? 0 : 1);
