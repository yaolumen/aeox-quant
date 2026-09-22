#!/usr/bin/env node
// ============================================================
// AEOX Quant 本地研究工具（qs-lab）—— 仅本机运行，不部署、不占用任何服务器
// 用法: node lab/qs-lab.mjs [--pages 3] [--stop 5] [--lighthouse] [--tf 1h]
//   --pages      每对拉取的 1000 根页数（3 = ~3000 根）
//   --stop       固定止损 %（0 = 关闭）
//   --lighthouse 跑 Lighthouse v0 研究网格（均值回归 Core + Guard，输出 lighthouse-v0.md）
//   --tf         Lighthouse 周期（默认 1h）
//
// ⚠️ SYNC-AREA：以下引擎函数与 index.html 手工保持一致，改任一处必须同步另一处。
//    差异允许项：backtestLab 额外输出 expectancy / profitFactor / grossW / grossL；
//    INDICATORS.compute 中的 theme() 为颜色存根（回测不关心颜色）。
// ============================================================

const HOSTS = ['https://data-api.binance.vision', 'https://api.binance.com'];
const FAPI = 'https://fapi.binance.com';
const FEE_PCT = 0.1;
const COINS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT'];
const TFS = ['1h', '4h', '1d'];

const argv = process.argv.slice(2);
function arg(name, def) {
  const i = argv.indexOf('--' + name);
  return i >= 0 && argv[i + 1] !== undefined ? +argv[i + 1] : def;
}
let PAGES = arg('pages', 3);
const STOP = arg('stop', 5);
const LIGHTHOUSE = argv.indexOf('--lighthouse') >= 0;
const MINN = arg('minN', 0); // --minN 30：覆盖默认交易数门槛（train≥N / test≥N/2），低频周期用

// ============ SYNC-AREA 引擎（与 index.html 一致） ============

function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

function closes(candles) { return candles.map(function (c) { return c.close; }); }

function round2(v) { return Math.round(v * 100) / 100; }

function sma(values, period) {
  var out = new Array(values.length).fill(null);
  var sum = 0;
  for (var i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

function ema(values, period) {
  var out = new Array(values.length).fill(null);
  var k = 2 / (period + 1);
  var prev = 0;
  for (var i = 0; i < values.length; i++) {
    if (i < period - 1) { prev += values[i]; continue; }
    if (i === period - 1) { prev = (prev + values[i]) / period; out[i] = prev; continue; }
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

function emaSkipNull(values, period) {
  var out = new Array(values.length).fill(null);
  var k = 2 / (period + 1);
  var prev = 0, count = 0;
  for (var i = 0; i < values.length; i++) {
    if (values[i] === null) continue;
    count++;
    if (count < period) { prev += values[i]; continue; }
    if (count === period) { prev = (prev + values[i]) / period; out[i] = prev; continue; }
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

function stdev(values, period) {
  var out = new Array(values.length).fill(null);
  for (var i = period - 1; i < values.length; i++) {
    var mean = 0;
    for (var j = i - period + 1; j <= i; j++) mean += values[j];
    mean /= period;
    var v = 0;
    for (var j2 = i - period + 1; j2 <= i; j2++) v += (values[j2] - mean) * (values[j2] - mean);
    out[i] = Math.sqrt(v / period);
  }
  return out;
}

function calcRSI(values, period) {
  var out = new Array(values.length).fill(null);
  var avgG = 0, avgL = 0;
  for (var i = 1; i < values.length; i++) {
    var ch = values[i] - values[i - 1];
    var g = ch > 0 ? ch : 0;
    var l = ch < 0 ? -ch : 0;
    if (i <= period) {
      avgG += g / period;
      avgL += l / period;
      if (i === period) out[i] = avgL === 0 ? 100 : 100 - 100 / (1 + avgG / avgL);
    } else {
      avgG = (avgG * (period - 1) + g) / period;
      avgL = (avgL * (period - 1) + l) / period;
      out[i] = avgL === 0 ? 100 : 100 - 100 / (1 + avgG / avgL);
    }
  }
  return out;
}

function fundingComponent(candles, funding) {
  var out = new Array(candles.length).fill(50);
  if (!funding || funding.length < 30) return out;
  var mean = 0;
  for (var j = 0; j < funding.length; j++) mean += funding[j].rate;
  mean /= funding.length;
  var vSum = 0;
  for (var j2 = 0; j2 < funding.length; j2++) vSum += (funding[j2].rate - mean) * (funding[j2].rate - mean);
  var sd = Math.sqrt(vSum / funding.length);
  if (sd <= 0) return out;
  var fi = 0;
  for (var i = 0; i < candles.length; i++) {
    while (fi < funding.length - 1 && funding[fi + 1].time <= candles[i].time) fi++;
    if (funding[fi].time > candles[i].time) continue;
    out[i] = clamp(50 + ((funding[fi].rate - mean) / sd) * 15, 0, 100);
  }
  return out;
}

function riskStopSeries(candles) {
  var out = new Array(candles.length).fill(0);
  for (var i = 14; i < candles.length; i++) {
    var trSum = 0;
    for (var j = i - 13; j <= i; j++) {
      var pc = candles[j - 1].close;
      trSum += Math.max(candles[j].high - candles[j].low, Math.abs(candles[j].high - pc), Math.abs(candles[j].low - pc));
    }
    out[i] = clamp((trSum / 14) / candles[i].close * 100 * 2, 2, 12);
  }
  return out;
}

function longStates(candles, events) {
  var out = new Array(candles.length).fill(false);
  var evIdx = 0, pos = false;
  for (var i = 0; i < candles.length; i++) {
    while (evIdx < events.length && events[evIdx].index === i) {
      var ev = events[evIdx];
      if (ev.dir === 'buy') pos = true;
      else if (ev.dir === 'sell') pos = false;
      evIdx++;
    }
    out[i] = pos;
  }
  return out;
}

function combinedEvents(candles, statesList) {
  var events = [];
  if (!statesList.length) return events;
  var prevAll = false;
  for (var i = 0; i < candles.length; i++) {
    var all = true;
    for (var k = 0; k < statesList.length; k++) {
      if (!statesList[k][i]) { all = false; break; }
    }
    if (all && !prevAll) events.push({ time: candles[i].time, index: i, dir: 'buy' });
    else if (!all && prevAll) events.push({ time: candles[i].time, index: i, dir: 'sell' });
    prevAll = all;
  }
  return events;
}

function theme() {
  return { up: '#0f0', down: '#f00', primary: '#00f', accent2: '#f80', text: '#888' };
}

const INDICATORS = {
  lh: {
    name: 'Lighthouse', noBacktest: false,
    compute: function (candles) {
      var c = closes(candles);
      var r4 = calcRSI(c, 4), s100 = sma(c, 100);
      var events = [];
      var prevIn = null, prevOut = null;
      for (var i = 0; i < candles.length; i++) {
        if (r4[i] === null || s100[i] === null) { prevIn = null; prevOut = null; continue; }
        var inZone = r4[i] < 10 && c[i] > s100[i];
        var outZone = r4[i] > 70;
        if (prevIn !== null) {
          if (!prevIn && inZone) events.push({ time: candles[i].time, index: i, dir: 'buy' });
          else if (!prevOut && outZone) events.push({ time: candles[i].time, index: i, dir: 'sell' });
        }
        prevIn = inZone; prevOut = outZone;
      }
      return { pane: [], overlay: [], events: events };
    }
  },
  qs: {
    name: 'QS Confluence v1', noBacktest: false,
    compute: function (candles, ctx) {
      var t = theme();
      var c = closes(candles);
      var rsi = calcRSI(c, 14);
      var mid = sma(c, 20), sd = stdev(c, 20);
      var e20 = ema(c, 20), e50 = ema(c, 50);
      var fund = fundingComponent(candles, ctx && ctx.funding);
      var line = [], events = [];
      var prevScore = null;
      for (var i = 0; i < candles.length; i++) {
        if (rsi[i] === null || mid[i] === null || e20[i] === null || e50[i] === null) { prevScore = null; continue; }
        var bandW = 4 * sd[i];
        var pctb = bandW > 0 ? ((c[i] - (mid[i] - 2 * sd[i])) / bandW) * 100 : 50;
        var emaC = clamp(((e20[i] - e50[i]) / e50[i]) * 5000, -100, 100);
        var score = 0.35 * rsi[i] + 0.25 * pctb + 0.15 * emaC + 0.25 * fund[i];
        line.push({ time: candles[i].time, value: round2(clamp(score, 0, 100)) });
        if (prevScore !== null) {
          if (prevScore >= 20 && score < 20) events.push({ time: candles[i].time, index: i, dir: 'buy' });
          else if (prevScore <= 80 && score > 80) events.push({ time: candles[i].time, index: i, dir: 'sell' });
        }
        prevScore = score;
      }
      return { pane: [], overlay: [], events: events };
    }
  },
  rsi: {
    name: 'RSI (14)', noBacktest: false,
    compute: function (candles) {
      var rsi = calcRSI(closes(candles), 14);
      var events = [];
      for (var i = 0; i < candles.length; i++) {
        if (rsi[i] === null) continue;
        if (i > 0 && rsi[i - 1] !== null) {
          if (rsi[i - 1] >= 30 && rsi[i] < 30) events.push({ time: candles[i].time, index: i, dir: 'buy' });
          else if (rsi[i - 1] <= 70 && rsi[i] > 70) events.push({ time: candles[i].time, index: i, dir: 'sell' });
        }
      }
      return { pane: [], overlay: [], events: events };
    }
  },
  bb: {
    name: 'Bollinger (20, 2σ)', noBacktest: false,
    compute: function (candles) {
      var c = closes(candles);
      var mid = sma(c, 20), sd = stdev(c, 20);
      var events = [];
      for (var i = 0; i < candles.length; i++) {
        if (mid[i] === null) continue;
        var up = mid[i] + 2 * sd[i], lo = mid[i] - 2 * sd[i];
        if (i > 0 && mid[i - 1] !== null) {
          if (c[i - 1] >= (mid[i - 1] - 2 * sd[i - 1]) && c[i] < lo) events.push({ time: candles[i].time, index: i, dir: 'buy' });
          else if (c[i - 1] <= (mid[i - 1] + 2 * sd[i - 1]) && c[i] > up) events.push({ time: candles[i].time, index: i, dir: 'sell' });
        }
      }
      return { pane: [], overlay: [], events: events };
    }
  },
  regime: {
    name: 'QS Regime', noBacktest: false,
    compute: function (candles) {
      var c = closes(candles);
      var e50 = ema(c, 50), e200 = ema(c, 200);
      var events = [];
      var prev = null;
      for (var i = 0; i < candles.length; i++) {
        if (e50[i] === null || e200[i] === null) { prev = null; continue; }
        var v = clamp(((e50[i] - e200[i]) / e200[i]) * 3000, -100, 100);
        if (prev !== null) {
          if (prev <= 40 && v > 40) events.push({ time: candles[i].time, index: i, dir: 'buy' });
          else if (prev >= -40 && v < -40) events.push({ time: candles[i].time, index: i, dir: 'sell' });
        }
        prev = v;
      }
      return { pane: [], overlay: [], events: events };
    }
  },
  flow: {
    name: 'QS Flow', noBacktest: false,
    compute: function (candles) {
      var ratio = candles.map(function (k) { return k.volume > 0 ? k.tb / k.volume : 0.5; });
      var smooth = ema(ratio, 14);
      var vols = candles.map(function (k) { return k.volume; });
      var vAvg = sma(vols, 20), vSd = stdev(vols, 20);
      var events = [];
      var prev = null;
      for (var i = 0; i < candles.length; i++) {
        if (smooth[i] === null || vAvg[i] === null || vSd[i] === null) { prev = null; continue; }
        var v = clamp((smooth[i] - 0.5) * 400, -100, 100);
        var vz = vSd[i] > 0 ? (vols[i] - vAvg[i]) / vSd[i] : 0;
        if (prev !== null) {
          if (prev <= 20 && v > 20 && vz > 0.5) events.push({ time: candles[i].time, index: i, dir: 'buy' });
          else if (prev >= -20 && v < -20) events.push({ time: candles[i].time, index: i, dir: 'sell' });
        }
        prev = v;
      }
      return { pane: [], overlay: [], events: events };
    }
  },
  risk: {
    name: 'QS Risk', noBacktest: true,
    compute: function (candles) {
      return { pane: [], overlay: [], events: [] };
    }
  }
};

// ============ SYNC-AREA END ============

// backtestLab = index.html backtest + 期望值/盈亏因子扩展（lab 专用，不回同步）
function backtestLab(candles, events, stopPct) {
  var fee = FEE_PCT / 100;
  var trades = [], pos = null;
  var eq = 1, peak = 1, maxDD = 0;
  var evIdx = 0;

  function closeTrade(exitPrice, stopped) {
    var r = (exitPrice * (1 - fee)) / (pos.entry * (1 + fee));
    eq *= r;
    if (eq > peak) peak = eq;
    var dd = (peak - eq) / peak;
    if (dd > maxDD) maxDD = dd;
    trades.push({ ret: r, stopped: stopped });
    pos = null;
  }

  for (var i = 0; i < candles.length; i++) {
    var bar = candles[i];
    if (pos !== null && pos.stop !== null && bar.low <= pos.stop) {
      closeTrade(pos.stop, true);
    }
    while (evIdx < events.length && events[evIdx].index === i) {
      var ev = events[evIdx];
      if (ev.dir === 'buy' && pos === null) {
        var sp = typeof stopPct === 'number' ? stopPct : (stopPct[i] || 0);
        pos = { entry: bar.close, stop: sp > 0 ? bar.close * (1 - sp / 100) : null };
      } else if (ev.dir === 'sell' && pos !== null) {
        closeTrade(bar.close, false);
      }
      evIdx++;
    }
  }

  var wins = trades.filter(function (t) { return t.ret > 1; });
  var losses = trades.filter(function (t) { return t.ret <= 1; });
  var grossW = wins.reduce(function (a, t) { return a + (t.ret - 1); }, 0);
  var grossL = losses.reduce(function (a, t) { return a + (1 - t.ret); }, 0);
  var expSum = trades.reduce(function (a, t) { return a + (t.ret - 1) * 100; }, 0);
  return {
    signals: events.length,
    closed: trades.length,
    open: pos !== null,
    stopped: trades.filter(function (t) { return t.stopped; }).length,
    winRate: trades.length ? wins.length / trades.length * 100 : 0,
    expectancy: trades.length ? expSum / trades.length : 0,
    profitFactor: grossL > 0 ? grossW / grossL : (grossW > 0 ? Infinity : 0),
    grossW: grossW, grossL: grossL,
    strategyRet: (eq - 1) * 100,
    holdRet: (candles[candles.length - 1].close / candles[0].close - 1) * 100,
    maxDD: maxDD * 100
  };
}

function holdStats(candles) {
  var peak = -Infinity, maxDD = 0;
  for (var i = 0; i < candles.length; i++) {
    if (candles[i].close > peak) peak = candles[i].close;
    var dd = (peak - candles[i].close) / peak;
    if (dd > maxDD) maxDD = dd;
  }
  return { holdRet: (candles[candles.length - 1].close / candles[0].close - 1) * 100, maxDD: maxDD * 100 };
}

// ============ 数据层 ============

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }

async function fetchKlinesPaged(symbol, interval) {
  var out = [], endTime = null;
  for (var p = 0; p < PAGES; p++) {
    var got = null;
    for (var h = 0; h < HOSTS.length && !got; h++) {
      try {
        var url = HOSTS[h] + '/api/v3/klines?symbol=' + symbol + '&interval=' + interval + '&limit=1000';
        if (endTime) url += '&endTime=' + endTime;
        var res = await fetch(url);
        if (!res.ok) continue;
        var rows = await res.json();
        if (Array.isArray(rows) && rows.length) got = rows;
      } catch (e) { /* try next host */ }
    }
    if (!got) break;
    out = got.concat(out);
    endTime = got[0][0] - 1;
    if (got.length < 1000) break;
    await sleep(150);
  }
  return out;
}

const fundingCache = {};
async function loadFunding(symbol) {
  if (fundingCache[symbol] !== undefined) return fundingCache[symbol];
  try {
    var res = await fetch(FAPI + '/fapi/v1/fundingRate?symbol=' + symbol + '&limit=1000');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    var rows = await res.json();
    var out = rows.map(function (r) { return { time: Math.floor(r.fundingTime / 1000), rate: +r.fundingRate }; });
    out.sort(function (a, b) { return a.time - b.time; });
    fundingCache[symbol] = out;
  } catch (e) {
    fundingCache[symbol] = null;
  }
  return fundingCache[symbol];
}

function buildCandles(raw) {
  var candles = [];
  for (var i = 0; i < raw.length; i++) {
    var k = raw[i];
    candles.push({ time: Math.floor(k[0] / 1000), open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5], tb: +k[9] });
  }
  return candles;
}

// ============ 回测配置 ============

const CONFIGS = [
  { name: 'hold (ref)', kind: 'hold' },
  { name: 'lighthouse', keys: ['lh'] },
  { name: 'qs', keys: ['qs'] },
  { name: 'regime', keys: ['regime'] },
  { name: 'flow', keys: ['flow'] },
  { name: 'rsi', keys: ['rsi'] },
  { name: 'bb', keys: ['bb'] },
  { name: 'qs+regime', keys: ['qs', 'regime'] },
  { name: 'qs+flow', keys: ['qs', 'flow'] },
  { name: 'qs+regime+flow', keys: ['qs', 'regime', 'flow'] },
  { name: 'qs+regime+flow+risk', keys: ['qs', 'regime', 'flow', 'risk'] }
];

function stackEvents(candles, ctx, keys) {
  var sig = keys.filter(function (k) { return !INDICATORS[k].noBacktest; });
  var states = sig.map(function (k) {
    return longStates(candles, INDICATORS[k].compute(candles, ctx).events);
  });
  return combinedEvents(candles, states);
}

function runConfig(cfg, candles, ctx) {
  if (cfg.kind === 'hold') {
    var h = holdStats(candles);
    return { hold: true, closed: 0, holdRet: h.holdRet, maxDD: h.maxDD, strategyRet: h.holdRet };
  }
  var events = cfg.keys.length === 1
    ? INDICATORS[cfg.keys[0]].compute(candles, ctx).events
    : stackEvents(candles, ctx, cfg.keys);
  var stopPct = cfg.keys.indexOf('risk') >= 0 ? riskStopSeries(candles) : STOP;
  return backtestLab(candles, events, stopPct);
}

// ============ Lighthouse v0 研究网格（lab 专用，不进 index.html） ============
// 架构：均值回归 Core（RSI 短周期超卖入场）+ Trend Guard（SMA/Regime veto）+ 出场工程（TP/SL/时间出场）
// 纪律：前 70% 训练 / 后 30% 测试；0.1%/边；盘中止损悲观优先；TP/信号/时间出场按收盘价

function lhRegime(candles) {
  var c = closes(candles);
  var e50 = ema(c, 50), e200 = ema(c, 200);
  var out = new Array(candles.length).fill(null);
  for (var i = 0; i < candles.length; i++) {
    if (e50[i] !== null && e200[i] !== null) out[i] = clamp(((e50[i] - e200[i]) / e200[i]) * 3000, -100, 100);
  }
  return out;
}

function lhInd(candles) {
  var c = closes(candles);
  var ind = { c: c, rsi: {}, sma: {}, regime: lhRegime(candles) };
  [2, 3, 4, 14].forEach(function (p) { ind.rsi[p] = calcRSI(c, p); });
  [100, 200].forEach(function (p) { ind.sma[p] = sma(c, p); });
  return ind;
}

function guardPass(ind, i, guard) {
  if (guard === 'none') return true;
  if (guard === 'sma100') return ind.sma[100][i] !== null && ind.c[i] > ind.sma[100][i];
  if (guard === 'sma200') return ind.sma[200][i] !== null && ind.c[i] > ind.sma[200][i];
  if (guard === 'r20') return ind.regime[i] !== null && ind.regime[i] > 20;
  if (guard === 'r40') return ind.regime[i] !== null && ind.regime[i] > 40;
  return false;
}

// 布尔进出回测：与主引擎同规则（long-only、close 进出、盘中止损悲观优先），外加 TP/时间出场
function boolBacktest(candles, entries, exits, tp, sl, maxBars) {
  var fee = FEE_PCT / 100;
  var trades = [], pos = null, eq = 1, peak = 1, maxDD = 0, stopped = 0;
  function closeAt(price, isStop) {
    var r = (price * (1 - fee)) / (pos.entry * (1 + fee));
    eq *= r;
    if (eq > peak) peak = eq;
    var dd = (peak - eq) / peak;
    if (dd > maxDD) maxDD = dd;
    if (isStop) stopped++;
    trades.push(r);
    pos = null;
  }
  for (var i = 0; i < candles.length; i++) {
    var bar = candles[i];
    if (pos !== null) {
      if (bar.low <= pos.stop) closeAt(pos.stop, true);
      else if (tp > 0 && bar.close >= pos.tp) closeAt(bar.close, false);
      else if (exits[i]) closeAt(bar.close, false);
      else if (maxBars > 0 && i - pos.i >= maxBars) closeAt(bar.close, false);
    }
    if (pos === null && entries[i]) {
      pos = { entry: bar.close, i: i, stop: bar.close * (1 - sl / 100), tp: tp > 0 ? bar.close * (1 + tp / 100) : null };
    }
  }
  if (pos !== null) closeAt(candles[candles.length - 1].close, false);
  var wins = 0, gW = 0, gL = 0, expSum = 0;
  for (var t = 0; t < trades.length; t++) {
    if (trades[t] > 1) { wins++; gW += trades[t] - 1; } else { gL += 1 - trades[t]; }
    expSum += (trades[t] - 1) * 100;
  }
  return {
    closed: trades.length, stopped: stopped,
    winRate: trades.length ? wins / trades.length * 100 : 0,
    expectancy: trades.length ? expSum / trades.length : 0,
    profitFactor: gL > 0 ? gW / gL : (gW > 0 ? Infinity : 0),
    grossW: gW, grossL: gL,
    strategyRet: (eq - 1) * 100, maxDD: maxDD * 100
  };
}

function mavg(rs, f) {
  var ok = rs.filter(function (r) { return r.closed > 0; });
  if (!ok.length) return null;
  var s = 0;
  for (var i = 0; i < ok.length; i++) s += f(ok[i]);
  return s / ok.length;
}
function msum(rs, f) {
  var s = 0;
  for (var i = 0; i < rs.length; i++) s += f(rs[i]);
  return s;
}

async function lighthouseMain() {
  var fs = await import('node:fs');
  var tf = '1h';
  var tfi = argv.indexOf('--tf');
  if (tfi >= 0 && argv[tfi + 1]) tf = argv[tfi + 1];
  if (argv.indexOf('--pages') < 0) PAGES = 6;

  var GUARDS = ['none', 'sma100', 'sma200', 'r20', 'r40'];
  var CORELENS = [2, 3, 4];
  var CORETHS = [5, 10, 15];
  var EXITS = [60, 70];
  var TPS = [0, 2, 3];
  var SLS = [2, 3, 5];
  var MAXBARS = [0, 24, 48];

  // 数据：拉一次，切 70/30，预算指标
  var data = [];
  for (var si = 0; si < COINS.length; si++) {
    var sym = COINS[si];
    var raw = await fetchKlinesPaged(sym, tf);
    if (!raw.length) { console.log('SKIP ' + sym + '（无数据）'); continue; }
    var candles = buildCandles(raw);
    var split = Math.floor(candles.length * 0.7);
    var d = { symbol: sym, train: { candles: candles.slice(0, split) }, test: { candles: candles.slice(split) } };
    d.train.ind = lhInd(d.train.candles);
    d.test.ind = lhInd(d.test.candles);
    data.push(d);
    console.log('loaded ' + sym + ' ' + candles.length + ' bars (train ' + d.train.candles.length + ' / test ' + d.test.candles.length + ')');
  }
  if (!data.length) throw new Error('无数据');

  // 预生成 entries / exits 布尔数组
  data.forEach(function (d) {
    ['train', 'test'].forEach(function (seg) {
      var ind = d[seg].ind, n = d[seg].candles.length;
      d[seg].ent = {}; d[seg].exi = {};
      GUARDS.forEach(function (g) {
        CORELENS.forEach(function (cl) {
          CORETHS.forEach(function (ct) {
            var ent = new Array(n).fill(false);
            var r = ind.rsi[cl];
            for (var i = 0; i < n; i++) {
              if (r[i] !== null && r[i] < ct && guardPass(ind, i, g)) ent[i] = true;
            }
            d[seg].ent[cl + '|' + ct + '|' + g] = ent;
          });
        });
      });
      CORELENS.forEach(function (cl) {
        EXITS.forEach(function (xt) {
          var exi = new Array(n).fill(false);
          var r2 = ind.rsi[cl];
          for (var j = 0; j < n; j++) { if (r2[j] !== null && r2[j] > xt) exi[j] = true; }
          d[seg].exi[cl + '|' + xt] = exi;
        });
      });
    });
  });

  // 基准：hold 与 RSI-14 30/70（同引擎同成本）
  var bench = { hold: { train: [], test: [] }, rsi14: { train: [], test: [] } };
  data.forEach(function (d) {
    ['train', 'test'].forEach(function (seg) {
      var cd = d[seg].candles, n = cd.length, r14 = d[seg].ind.rsi[14];
      var peak = -Infinity, dd = 0;
      for (var i = 0; i < n; i++) {
        if (cd[i].close > peak) peak = cd[i].close;
        var x = (peak - cd[i].close) / peak;
        if (x > dd) dd = x;
      }
      bench.hold[seg].push({ ret: (cd[n - 1].close / cd[0].close - 1) * 100, dd: dd * 100 });
      var ent = new Array(n).fill(false), exi = new Array(n).fill(false);
      for (var j = 1; j < n; j++) {
        if (r14[j - 1] === null || r14[j] === null) continue;
        if (r14[j - 1] >= 30 && r14[j] < 30) ent[j] = true;
        if (r14[j - 1] <= 70 && r14[j] > 70) exi[j] = true;
      }
      bench.rsi14[seg].push(boolBacktest(cd, ent, exi, 0, 5, 0));
    });
  });

  // 网格
  var rows = [];
  GUARDS.forEach(function (g) {
    CORELENS.forEach(function (cl) {
      CORETHS.forEach(function (ct) {
        EXITS.forEach(function (xt) {
          TPS.forEach(function (tp) {
            SLS.forEach(function (sl) {
              MAXBARS.forEach(function (mb) {
                var tr = [], te = [];
                data.forEach(function (d) {
                  tr.push(boolBacktest(d.train.candles, d.train.ent[cl + '|' + ct + '|' + g], d.train.exi[cl + '|' + xt], tp, sl, mb));
                  te.push(boolBacktest(d.test.candles, d.test.ent[cl + '|' + ct + '|' + g], d.test.exi[cl + '|' + xt], tp, sl, mb));
                });
                var gW = msum(tr, function (r) { return r.grossW; }), gL = msum(tr, function (r) { return r.grossL; });
                var gW2 = msum(te, function (r) { return r.grossW; }), gL2 = msum(te, function (r) { return r.grossL; });
                rows.push({
                  g: g, cl: cl, ct: ct, xt: xt, tp: tp, sl: sl, mb: mb,
                  trainN: msum(tr, function (r) { return r.closed; }),
                  trainExp: mavg(tr, function (r) { return r.expectancy; }),
                  trainWin: mavg(tr, function (r) { return r.winRate; }),
                  trainPF: gL > 0 ? gW / gL : (gW > 0 ? Infinity : 0),
                  testN: msum(te, function (r) { return r.closed; }),
                  testExp: mavg(te, function (r) { return r.expectancy; }),
                  testWin: mavg(te, function (r) { return r.winRate; }),
                  testPF: gL2 > 0 ? gW2 / gL2 : (gW2 > 0 ? Infinity : 0),
                  testDD: mavg(te, function (r) { return -r.maxDD; }),
                  robust: te.filter(function (r) { return r.closed > 0 && r.expectancy > 0; }).length
                });
              });
            });
          });
        });
      });
    });
  });

  // 输出
  var head = '| guard | coreLen | coreTh | exitTh | tp% | sl% | maxBars | 训练期望% | 训练PF | 训练胜率% | 训练笔数 | 测试期望% | 测试PF | 测试胜率% | 测试笔数 | 测试DD% | 稳健币数 |';
  var sep = '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|';
  function rowLine(r) {
    return '| ' + [r.g, r.cl, r.ct, r.xt, r.tp, r.sl, r.mb].join(' | ')
      + ' | ' + fmt(r.trainExp, 2) + ' | ' + (r.trainPF === Infinity ? '∞' : r.trainPF.toFixed(2)) + ' | ' + fmt(r.trainWin, 1) + ' | ' + r.trainN
      + ' | ' + fmt(r.testExp, 2) + ' | ' + (r.testPF === Infinity ? '∞' : r.testPF.toFixed(2)) + ' | ' + fmt(r.testWin, 1) + ' | ' + r.testN + ' | ' + fmt(r.testDD, 1) + ' | ' + r.robust + '/' + data.length + ' |';
  }
  var byTrain = rows.filter(function (r) { return r.trainN >= (MINN > 0 ? MINN : 100); }).sort(function (a, b) { return b.trainExp - a.trainExp; });
  var byTest = rows.filter(function (r) { return r.testN >= (MINN > 0 ? Math.floor(MINN / 2) : 50); }).sort(function (a, b) { return b.testExp - a.testExp; });
  var guardDiag = rows.filter(function (r) { return r.cl === 2 && r.ct === 10 && r.xt === 70 && r.tp === 2 && r.sl === 3 && r.mb === 24; });

  var rTr = bench.rsi14.train, rTe = bench.rsi14.test;
  var rgW = msum(rTr, function (r) { return r.grossW; }), rgL = msum(rTr, function (r) { return r.grossL; });
  var rgW2 = msum(rTe, function (r) { return r.grossW; }), rgL2 = msum(rTe, function (r) { return r.grossL; });
  var hTr = avg(bench.hold.train.map(function (b) { return b.ret; })), hTe = avg(bench.hold.test.map(function (b) { return b.ret; }));
  var hTrDD = avg(bench.hold.train.map(function (b) { return -b.dd; })), hTeDD = avg(bench.hold.test.map(function (b) { return -b.dd; }));

  var L = [];
  L.push('# Lighthouse v0 研究报告 — ' + new Date().toISOString().slice(0, 10));
  L.push('');
  L.push('- 架构：均值回归 Core（RSI(coreLen) < coreTh）+ Guard（' + GUARDS.join(' / ') + '）+ 出场（RSI > exitTh / TP / SL / maxBars）');
  L.push('- 数据：' + data.map(function (d) { return d.symbol; }).join(', ') + ' × ' + tf + '，每对 ~' + PAGES * 1000 + ' 根；前 70% 训练 / 后 30% 测试；' + FEE_PCT + '%/边；止损盘中触发（悲观优先），TP/信号/时间出场按收盘价');
  L.push('- 测试段长度：' + (data.length ? data[0].test.candles.length + ' 根' : '—') + '；测试段需重新 Warmup（EMA200 吃掉前 ~200 根）');
  L.push('');
  L.push('## 基准（同引擎同成本）');
  L.push('');
  L.push('| 基准 | 训练收益% | 训练DD% | 测试收益% | 测试DD% | 训练期望%/笔 | 训练PF | 训练胜率% | 训练笔数 | 测试期望%/笔 | 测试PF | 测试胜率% | 测试笔数 |');
  L.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  L.push('| hold | ' + fmt(hTr, 1) + ' | ' + fmt(hTrDD, 1) + ' | ' + fmt(hTe, 1) + ' | ' + fmt(hTeDD, 1) + ' | — | — | — | — | — | — | — | — |');
  L.push('| RSI-14 30/70 (SL5%) | — | — | — | — | ' + fmt(mavg(rTr, function (r) { return r.expectancy; }), 2) + ' | ' + (rgL > 0 ? (rgW / rgL).toFixed(2) : '—') + ' | ' + fmt(mavg(rTr, function (r) { return r.winRate; }), 1) + ' | ' + msum(rTr, function (r) { return r.closed; }) + ' | ' + fmt(mavg(rTe, function (r) { return r.expectancy; }), 2) + ' | ' + (rgL2 > 0 ? (rgW2 / rgL2).toFixed(2) : '—') + ' | ' + fmt(mavg(rTe, function (r) { return r.winRate; }), 1) + ' | ' + msum(rTe, function (r) { return r.closed; }) + ' |');
  L.push('');
  L.push('## Top 25 —— 按训练期望排序（诚实选参口径，训练笔数 ≥100）');
  L.push('');
  L.push(head); L.push(sep);
  byTrain.slice(0, 25).forEach(function (r) { L.push(rowLine(r)); });
  L.push('');
  L.push('## Top 25 —— 按测试期望排序（偷看口径，仅评估衰减幅度，禁止用于选参）');
  L.push('');
  L.push(head); L.push(sep);
  byTest.slice(0, 25).forEach(function (r) { L.push(rowLine(r)); });
  L.push('');
  L.push('## Guard 效应（cl=2, ct=10, xt=70, tp=2%, sl=3%, mb=24）');
  L.push('');
  L.push(head); L.push(sep);
  guardDiag.forEach(function (r) { L.push(rowLine(r)); });
  L.push('');
  L.push('- 全网格 ' + rows.length + ' 配置已写入 lab/lighthouse-grid-' + tf + '.csv');
  L.push('- 注意：测试段仅 ~2.5 个月（' + tf + '）且处于同一市场环境；Top 表存在多重比较偏差，最终选参需看参数高原与稳健币数');

  fs.writeFileSync('lab/lighthouse-v0-' + tf + '.md', L.join('\n'), 'utf8');
  var csv = ['guard,coreLen,coreTh,exitTh,tp,sl,maxBars,trainN,trainExp,trainPF,trainWin,testN,testExp,testPF,testWin,testDD,robust'];
  rows.forEach(function (r) {
    csv.push([r.g, r.cl, r.ct, r.xt, r.tp, r.sl, r.mb, r.trainN,
      r.trainExp === null ? '' : r.trainExp.toFixed(3), r.trainPF === Infinity ? '' : r.trainPF.toFixed(3), r.trainWin === null ? '' : r.trainWin.toFixed(1),
      r.testN, r.testExp === null ? '' : r.testExp.toFixed(3), r.testPF === Infinity ? '' : r.testPF.toFixed(3), r.testWin === null ? '' : r.testWin.toFixed(1),
      r.testDD === null ? '' : r.testDD.toFixed(1), r.robust].join(','));
  });
  fs.writeFileSync('lab/lighthouse-grid-' + tf + '.csv', csv.join('\n'), 'utf8');

  console.log('\n基准 hold: train ' + fmt(hTr, 1) + '% / test ' + fmt(hTe, 1) + '%');
  console.log('基准 RSI-14: train exp ' + fmt(mavg(rTr, function (r) { return r.expectancy; }), 2) + '% PF ' + (rgL > 0 ? (rgW / rgL).toFixed(2) : '—') + ' / test exp ' + fmt(mavg(rTe, function (r) { return r.expectancy; }), 2) + '% PF ' + (rgL2 > 0 ? (rgW2 / rgL2).toFixed(2) : '—'));
  console.log('\n== Top 10 by TRAIN ==');
  byTrain.slice(0, 10).forEach(function (r) { console.log(rowLine(r)); });
  console.log('\n== Top 10 by TEST (peek only) ==');
  byTest.slice(0, 10).forEach(function (r) { console.log(rowLine(r)); });
  console.log('\nwrote lab/lighthouse-v0-' + tf + '.md + lab/lighthouse-grid-' + tf + '.csv');
}

// ============ 主流程 ============

function avg(arr) { return arr.length ? arr.reduce(function (a, b) { return a + b; }, 0) / arr.length : null; }
function fmt(v, d, suffix) {
  if (v === null || v === undefined || isNaN(v)) return '—';
  return (d === 1 && v > 0 ? '+' : '') + v.toFixed(d) + (suffix || '');
}

async function main() {
  var lines = [];
  lines.push('# QS-Lab 基线报告 — ' + new Date().toISOString().slice(0, 10));
  lines.push('');
  lines.push('- 数据：' + COINS.length + ' 币 × ' + TFS.join('/') + ' × ' + PAGES + ' 页（~' + PAGES * 1000 + ' 根/对），Binance 公开 API');
  lines.push('- 引擎：与 quant.aeox.uk 同款（long-only、bar close 进出、盘中止损、' + FEE_PCT + '%/边手续费），固定止损 ' + (STOP > 0 ? STOP + '%' : '关闭'));
  lines.push('- 注意：本环境 fapi 被墙，Confluence 资金费率因子降级为中性 50（≈三因子版）');
  lines.push('');

  for (var ti = 0; ti < TFS.length; ti++) {
    var tf = TFS[ti];
    lines.push('## ' + tf.toUpperCase() + '（' + PAGES * 1000 + ' 根 ≈ ' + (tf === '1h' ? Math.round(PAGES * 1000 / 24) + ' 天' : tf === '4h' ? Math.round(PAGES * 1000 / 6) + ' 天' : Math.round(PAGES * 1000 / 365 * 10) / 10 + ' 年') + '）');
    lines.push('');
    lines.push('| 配置 | 总笔数 | 有交易币 | 胜率% | 期望%/笔 | PF | 最大回撤% | 净收益% | 超额vs持有% |');
    lines.push('|---|---|---|---|---|---|---|---|---|');

    var detail = [];
    for (var ci = 0; ci < CONFIGS.length; ci++) {
      var cfg = CONFIGS[ci];
      var rows = [];
      for (var si = 0; si < COINS.length; si++) {
        var sym = COINS[si];
        var raw = await fetchKlinesPaged(sym, tf);
        if (!raw.length) { rows.push(null); continue; }
        var candles = buildCandles(raw);
        var funding = await loadFunding(sym);
        var r = runConfig(cfg, candles, { symbol: sym, funding: funding });
        r.symbol = sym; r.bars = candles.length;
        rows.push(r);
        detail.push({ tf: tf, cfg: cfg.name, symbol: sym, r: r });
      }
      var ok = rows.filter(Boolean);
      if (cfg.kind === 'hold') {
        lines.push('| ' + cfg.name + ' | — | — | — | — | — | ' + fmt(avg(ok.map(function (r) { return r.maxDD; })), 1) + ' | ' + fmt(avg(ok.map(function (r) { return r.strategyRet; })), 1) + ' | — |');
        continue;
      }
      var traded = ok.filter(function (r) { return r.closed > 0; });
      var gW = traded.reduce(function (a, r) { return a + r.grossW; }, 0);
      var gL = traded.reduce(function (a, r) { return a + r.grossL; }, 0);
      lines.push('| ' + cfg.name + ' | ' + ok.reduce(function (a, r) { return a + r.closed; }, 0)
        + ' | ' + traded.length + '/' + ok.length
        + ' | ' + fmt(avg(traded.map(function (r) { return r.winRate; })), 1)
        + ' | ' + fmt(avg(traded.map(function (r) { return r.expectancy; })), 2)
        + ' | ' + (gL > 0 ? (gW / gL).toFixed(2) : (gW > 0 ? '∞' : '—'))
        + ' | ' + fmt(avg(ok.map(function (r) { return -r.maxDD; })), 1)
        + ' | ' + fmt(avg(ok.map(function (r) { return r.strategyRet; })), 1)
        + ' | ' + fmt(avg(ok.map(function (r) { return r.strategyRet - r.holdRet; })), 1) + ' |');
    }
    lines.push('');
    // 每币明细
    lines.push('<details><summary>' + tf.toUpperCase() + ' 每币明细</summary>');
    lines.push('');
    lines.push('| 配置 | 币 | 根数 | 信号 | 笔数 | 止损 | 胜率% | 期望% | PF | 回撤% | 净收益% | 持有% |');
    lines.push('|---|---|---|---|---|---|---|---|---|---|---|---|');
    detail.forEach(function (d) {
      var r = d.r;
      if (d.cfg === 'hold (ref)') {
        lines.push('| hold | ' + r.symbol + ' | ' + r.bars + ' | — | — | — | — | — | — | ' + fmt(-r.maxDD, 1) + ' | ' + fmt(r.strategyRet, 1) + ' | ' + fmt(r.holdRet, 1) + ' |');
        return;
      }
      lines.push('| ' + d.cfg + ' | ' + r.symbol + ' | ' + r.bars + ' | ' + r.signals + ' | ' + r.closed + (r.open ? '+1' : '') + ' | ' + r.stopped
        + ' | ' + (r.closed ? r.winRate.toFixed(1) : '—')
        + ' | ' + (r.closed ? r.expectancy.toFixed(2) : '—')
        + ' | ' + (r.closed ? (r.profitFactor === Infinity ? '∞' : r.profitFactor.toFixed(2)) : '—')
        + ' | ' + fmt(-r.maxDD, 1) + ' | ' + fmt(r.strategyRet, 1) + ' | ' + fmt(r.holdRet, 1) + ' |');
    });
    lines.push('');
    lines.push('</details>');
    lines.push('');
    console.log(tf.toUpperCase() + ' done');
  }

  var out = lines.join('\n');
  var fs = await import('node:fs');
  fs.writeFileSync('lab/baseline.md', out, 'utf8');
  console.log('\n' + out);
}

if (LIGHTHOUSE) {
  lighthouseMain().catch(function (e) { console.error('LAB FAILED:', e); process.exit(1); });
} else {
  main().catch(function (e) { console.error('LAB FAILED:', e); process.exit(1); });
}
