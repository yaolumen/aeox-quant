#!/usr/bin/env node
// ============================================================
// AEOX Quant 本地研究工具（regime-filter）—— Regime 入场过滤实验，仅本机运行
// 用法: node lab/regime-filter.mjs [--pages 3] [--stop 5] [--tf 1h]
//
// 问题：买入时要求 Regime > 阈值（深熊不开仓）能否跨窗口提高期望/回撤？
// 假设来源：exit-swap 实验中 XRP 全线亏损（深熊 -59%）——"该不该交易"比"何时退出"更根本。
// 对照：无过滤 vs Regime>-40 vs Regime>0 vs Regime>+40；出场均为自带；止损 5%。
// 引擎：与 qs-lab.mjs SYNC-AREA 同款复制；funding 降级中性 50。
// ============================================================

const HOSTS = ['https://data-api.binance.vision', 'https://api.binance.com'];
const FEE_PCT = 0.1;
const COINS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT'];

const argv = process.argv.slice(2);
function arg(name, def) {
  const i = argv.indexOf('--' + name);
  return i >= 0 && argv[i + 1] !== undefined ? +argv[i + 1] : def;
}
const PAGES = arg('pages', 3);
const STOP = arg('stop', 5);
const TF = (argv.indexOf('--tf') >= 0 && argv[argv.indexOf('--tf') + 1]) || '1h';

// ============ SYNC-AREA 引擎复制（与 qs-lab.mjs 一致） ============

function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
function closes(candles) { return candles.map(function (c) { return c.close; }); }

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

function regimeSeries(candles) {
  var c = closes(candles);
  var e50 = ema(c, 50), e200 = ema(c, 200);
  var out = new Array(candles.length).fill(null);
  for (var i = 0; i < candles.length; i++) {
    if (e50[i] !== null && e200[i] !== null) out[i] = clamp(((e50[i] - e200[i]) / e200[i]) * 3000, -100, 100);
  }
  return out;
}

function lhEvents(candles) {
  var c = closes(candles);
  var r4 = calcRSI(c, 4), s100 = sma(c, 100);
  var events = [];
  var prevIn = null, prevOut = null;
  for (var i = 0; i < candles.length; i++) {
    if (r4[i] === null || s100[i] === null) { prevIn = null; prevOut = null; continue; }
    var inZone = r4[i] < 10 && c[i] > s100[i];
    var outZone = r4[i] > 70;
    if (prevIn !== null) {
      if (!prevIn && inZone) events.push({ index: i, dir: 'buy' });
      else if (!prevOut && outZone) events.push({ index: i, dir: 'sell' });
    }
    prevIn = inZone; prevOut = outZone;
  }
  return events;
}

function qsEvents(candles) {
  var c = closes(candles);
  var rsi = calcRSI(c, 14);
  var mid = sma(c, 20), sd = stdev(c, 20);
  var e20 = ema(c, 20), e50 = ema(c, 50);
  var events = [];
  var prevScore = null;
  for (var i = 0; i < candles.length; i++) {
    if (rsi[i] === null || mid[i] === null || e20[i] === null || e50[i] === null) { prevScore = null; continue; }
    var bandW = 4 * sd[i];
    var pctb = bandW > 0 ? ((c[i] - (mid[i] - 2 * sd[i])) / bandW) * 100 : 50;
    var emaC = clamp(((e20[i] - e50[i]) / e50[i]) * 5000, -100, 100);
    var score = 0.35 * rsi[i] + 0.25 * pctb + 0.15 * emaC + 0.25 * 50; // funding 降级 50
    if (prevScore !== null) {
      if (prevScore >= 20 && score < 20) events.push({ index: i, dir: 'buy' });
      else if (prevScore <= 80 && score > 80) events.push({ index: i, dir: 'sell' });
    }
    prevScore = score;
  }
  return events;
}

function rsiEvents(candles) {
  var rsi = calcRSI(closes(candles), 14);
  var events = [];
  for (var i = 0; i < candles.length; i++) {
    if (rsi[i] === null) continue;
    if (i > 0 && rsi[i - 1] !== null) {
      if (rsi[i - 1] >= 30 && rsi[i] < 30) events.push({ index: i, dir: 'buy' });
      else if (rsi[i - 1] <= 70 && rsi[i] > 70) events.push({ index: i, dir: 'sell' });
    }
  }
  return events;
}

const ENTRY = { lh: lhEvents, qs: qsEvents, rsi: rsiEvents };
const FILTERS = [null, -40, 0, 40];

// ============ backtest（与 exit-swap.mjs 同款） ============

function backtest(candles, events, stopPct) {
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
        pos = { entry: bar.close, stop: stopPct > 0 ? bar.close * (1 - stopPct / 100) : null };
      } else if (ev.dir === 'sell' && pos !== null) {
        closeTrade(bar.close, false);
      }
      evIdx++;
    }
  }
  if (pos !== null) closeTrade(candles[candles.length - 1].close, false);

  var wins = trades.filter(function (t) { return t.ret > 1; });
  var losses = trades.filter(function (t) { return t.ret <= 1; });
  var grossW = wins.reduce(function (a, t) { return a + (t.ret - 1); }, 0);
  var grossL = losses.reduce(function (a, t) { return a + (1 - t.ret); }, 0);
  return {
    closed: trades.length,
    stopped: trades.filter(function (t) { return t.stopped; }).length,
    winRate: trades.length ? wins.length / trades.length * 100 : 0,
    expectancy: trades.length ? trades.reduce(function (a, t) { return a + (t.ret - 1) * 100; }, 0) / trades.length : 0,
    profitFactor: grossL > 0 ? grossW / grossL : (grossW > 0 ? Infinity : 0),
    strategyRet: (eq - 1) * 100,
    maxDD: maxDD * 100
  };
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

function buildCandles(raw) {
  var candles = [];
  for (var i = 0; i < raw.length; i++) {
    var k = raw[i];
    candles.push({ time: Math.floor(k[0] / 1000), open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5], tb: +k[9] });
  }
  return candles;
}

// ============ 实验 ============

function fmt(v, d) { return v === Infinity ? '∞' : (Math.round(v * Math.pow(10, d)) / Math.pow(10, d)).toFixed(d); }

async function main() {
  const data = {};
  for (const sym of COINS) {
    const raw = await fetchKlinesPaged(sym, TF);
    data[sym] = raw.length ? buildCandles(raw) : null;
  }

  const lines = [];
  lines.push('# Regime 入场过滤实验 — ' + new Date().toISOString().slice(0, 10));
  lines.push('');
  lines.push('- 问题：买入时要求 Regime > 阈值（深熊不开仓）能否跨窗口提高期望/回撤？');
  lines.push('- 数据：' + COINS.length + ' 币 × ' + TF + ' × ~' + PAGES * 1000 + ' 根；止损 ' + STOP + '%（盘中悲观）；' + FEE_PCT + '%/边；末 bar 强平计入');
  lines.push('- funding 降级中性 50；出场均为指标自带；buy 事件按当根 Regime 值过滤，sell 保留');
  lines.push('');
  lines.push('| 入场 | 过滤 | 总笔 | 覆盖币 | 胜率% | 期望%/笔 | 净收益% | 回撤% |');
  lines.push('|---|---|---|---|---|---|---|---|');

  for (const en of Object.keys(ENTRY)) {
    for (const th of FILTERS) {
      const rows = [];
      for (const sym of COINS) {
        const candles = data[sym];
        if (!candles) continue;
        let events = ENTRY[en](candles);
        if (th !== null) {
          const reg = regimeSeries(candles);
          events = events.filter(function (e) { return e.dir !== 'buy' || reg[e.index] === null || reg[e.index] > th; });
        }
        const r = backtest(candles, events, STOP);
        r.symbol = sym;
        rows.push(r);
      }
      const n = rows.reduce(function (a, r) { return a + r.closed; }, 0);
      const traded = rows.filter(function (r) { return r.closed > 0; });
      const wSum = traded.reduce(function (a, r) { return a + r.winRate * r.closed; }, 0);
      const eSum = traded.reduce(function (a, r) { return a + r.expectancy * r.closed; }, 0);
      lines.push('| ' + en + ' | ' + (th === null ? '无' : 'Regime>' + th)
        + ' | ' + n + ' | ' + traded.length + '/' + rows.length
        + ' | ' + fmt(n ? wSum / n : 0, 1)
        + ' | ' + fmt(n ? eSum / n : 0, 2)
        + ' | ' + fmt(traded.reduce(function (a, r) { return a + r.strategyRet; }, 0) / (traded.length || 1), 1)
        + ' | ' + fmt(traded.reduce(function (a, r) { return a + r.maxDD; }, 0) / (traded.length || 1), 1)
        + ' |');
    }
  }

  lines.push('');
  lines.push('## 每币明细（胜率%/笔数/期望%/回撤%）');
  lines.push('');
  for (const en of Object.keys(ENTRY)) {
    lines.push('### ' + en);
    lines.push('');
    lines.push('| 过滤 | ' + COINS.join(' | ') + ' |');
    lines.push('|---|' + COINS.map(function () { return '---|'; }).join(''));
    for (const th of FILTERS) {
      const cells = COINS.map(function (sym) {
        const candles = data[sym];
        if (!candles) return '—';
        let events = ENTRY[en](candles);
        if (th !== null) {
          const reg = regimeSeries(candles);
          events = events.filter(function (e) { return e.dir !== 'buy' || reg[e.index] === null || reg[e.index] > th; });
        }
        const r = backtest(candles, events, STOP);
        if (!r.closed) return '—';
        const thin = r.closed < 20 ? '⚠' : '';
        return fmt(r.winRate, 0) + thin + '%/' + r.closed + '/' + fmt(r.expectancy, 2) + '/' + fmt(r.maxDD, 0);
      });
      lines.push('| ' + (th === null ? '无' : '>' + th) + ' | ' + cells.join(' | ') + ' |');
    }
    lines.push('');
  }

  lines.push('## Hold 参照');
  lines.push('');
  lines.push('| 币 | hold 收益% | 回撤% |');
  lines.push('|---|---|---|');
  for (const sym of COINS) {
    const candles = data[sym];
    if (!candles) continue;
    const h0 = candles[0].close, h1 = candles[candles.length - 1].close;
    let peak = -Infinity, maxDD = 0;
    for (const k of candles) {
      if (k.close > peak) peak = k.close;
      const dd = (peak - k.close) / peak;
      if (dd > maxDD) maxDD = dd;
    }
    lines.push('| ' + sym + ' | ' + fmt((h1 / h0 - 1) * 100, 1) + ' | ' + fmt(maxDD * 100, 1) + ' |');
  }

  const out = lines.join('\n');
  const fs = await import('node:fs');
  fs.writeFileSync('lab/regime-filter.md', out, 'utf8');
  console.log(out);
}

main().catch(function (e) { console.error(e); process.exit(1); });
