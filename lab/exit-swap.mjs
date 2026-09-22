#!/usr/bin/env node
// ============================================================
// AEOX Quant 本地研究工具（exit-swap）—— 入场/出场指标分离实验，仅本机运行
// 用法: node lab/exit-swap.mjs [--pages 3] [--stop 5] [--tf 1h]
//
// 问题：Lighthouse / Confluence 的自带卖出是否出场过早（BUY 后还有行情）？
//       换用更慢的退出信号（Confluence>80 / Flow<-20 / Regime<-40 / RSI14>70 / 只靠止损）
//       胜率与盈利能力是否提高？
// 引擎：与 qs-lab.mjs SYNC-AREA 同款复制（long-only、bar close 进出、盘中止损、0.1%/边）
// 注意：本环境 fapi 被墙，Confluence 资金费率因子降级中性 50（≈三因子降级模式）
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

// ---- 指标信号（只提取事件，funding 固定 50） ----

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

function regimeEvents(candles) {
  var c = closes(candles);
  var e50 = ema(c, 50), e200 = ema(c, 200);
  var events = [];
  var prev = null;
  for (var i = 0; i < candles.length; i++) {
    if (e50[i] === null || e200[i] === null) { prev = null; continue; }
    var v = clamp(((e50[i] - e200[i]) / e200[i]) * 3000, -100, 100);
    if (prev !== null) {
      if (prev <= 40 && v > 40) events.push({ index: i, dir: 'buy' });
      else if (prev >= -40 && v < -40) events.push({ index: i, dir: 'sell' });
    }
    prev = v;
  }
  return events;
}

function flowEvents(candles) {
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
      if (prev <= 20 && v > 20 && vz > 0.5) events.push({ index: i, dir: 'buy' });
      else if (prev >= -20 && v < -20) events.push({ index: i, dir: 'sell' });
    }
    prev = v;
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

const ENTRY = { lh: lhEvents, qs: qsEvents };
const EXIT = {
  self: null, // 入场指标自带卖出
  qs: qsEvents,
  flow: flowEvents,
  regime: regimeEvents,
  rsi: rsiEvents,
  none: null // 无信号卖出，只靠止损
};

// ============ backtest（qs-lab backtestLab + 持仓时长扩展） ============

function backtest(candles, events, stopPct) {
  var fee = FEE_PCT / 100;
  var trades = [], pos = null;
  var eq = 1, peak = 1, maxDD = 0;
  var evIdx = 0;

  function closeTrade(exitPrice, stopped, barIdx) {
    var r = (exitPrice * (1 - fee)) / (pos.entry * (1 + fee));
    eq *= r;
    if (eq > peak) peak = eq;
    var dd = (peak - eq) / peak;
    if (dd > maxDD) maxDD = dd;
    trades.push({ ret: r, stopped: stopped, bars: barIdx - pos.entryIdx });
    pos = null;
  }

  for (var i = 0; i < candles.length; i++) {
    var bar = candles[i];
    if (pos !== null && pos.stop !== null && bar.low <= pos.stop) {
      closeTrade(pos.stop, true, i);
    }
    while (evIdx < events.length && events[evIdx].index === i) {
      var ev = events[evIdx];
      if (ev.dir === 'sell' && pos !== null) {
        closeTrade(bar.close, false, i);
      } else if (ev.dir === 'buy' && pos === null) {
        pos = { entry: bar.close, entryIdx: i, stop: stopPct > 0 ? bar.close * (1 - stopPct / 100) : null };
      }
      evIdx++;
    }
  }
  if (pos !== null) closeTrade(candles[candles.length - 1].close, false, candles.length - 1); // 末 bar 强平（统计口径：未平仓也计入，标 open）

  var wins = trades.filter(function (t) { return t.ret > 1; });
  var losses = trades.filter(function (t) { return t.ret <= 1; });
  var grossW = wins.reduce(function (a, t) { return a + (t.ret - 1); }, 0);
  var grossL = losses.reduce(function (a, t) { return a + (1 - t.ret); }, 0);
  return {
    closed: trades.length,
    open: false, // 末 bar 强平口径下恒 false
    stopped: trades.filter(function (t) { return t.stopped; }).length,
    winRate: trades.length ? wins.length / trades.length * 100 : 0,
    expectancy: trades.length ? trades.reduce(function (a, t) { return a + (t.ret - 1) * 100; }, 0) / trades.length : 0,
    profitFactor: grossL > 0 ? grossW / grossL : (grossW > 0 ? Infinity : 0),
    avgBars: trades.length ? trades.reduce(function (a, t) { return a + t.bars; }, 0) / trades.length : 0,
    avgWin: wins.length ? wins.reduce(function (a, t) { return a + (t.ret - 1) * 100; }, 0) / wins.length : 0,
    avgLoss: losses.length ? losses.reduce(function (a, t) { return a + (1 - t.ret) * 100; }, 0) / losses.length : 0,
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

  const combos = [];
  for (const en of Object.keys(ENTRY)) {
    for (const ex of Object.keys(EXIT)) {
      combos.push({ en, ex });
    }
  }

  const lines = [];
  lines.push('# Exit-Swap 实验 — ' + new Date().toISOString().slice(0, 10));
  lines.push('');
  lines.push('- 问题：入场指标自带卖出是否过早？换更慢的退出信号是否提高胜率/盈利？');
  lines.push('- 数据：' + COINS.length + ' 币 × ' + TF + ' × ~' + PAGES * 1000 + ' 根；止损 ' + STOP + '%（盘中悲观）；' + FEE_PCT + '%/边；末 bar 强平计入');
  lines.push('- funding 因子降级中性 50（本环境 fapi 不可达，Confluence = 三因子版）');
  lines.push('- 纪律：单币 <20 笔 = 统计单薄，只看汇总与跨币一致性');
  lines.push('');
  lines.push('| 入场 | 出场 | 总笔 | 覆盖币 | 胜率% | 期望%/笔 | PF | 均持仓bar | 均盈% | 均亏% | 净收益% | 回撤% |');
  lines.push('|---|---|---|---|---|---|---|---|---|---|---|---|');

  const perCoin = [];
  for (const { en, ex } of combos) {
    const rows = [];
    for (const sym of COINS) {
      const candles = data[sym];
      if (!candles) continue;
      const entryEvents = ENTRY[en](candles);
      const buys = entryEvents.filter(function (e) { return e.dir === 'buy'; });
      let sells;
      if (ex === 'self') sells = entryEvents.filter(function (e) { return e.dir === 'sell'; });
      else if (ex === 'none') sells = [];
      else sells = EXIT[ex](candles).filter(function (e) { return e.dir === 'sell'; });
      const events = sells.concat(buys).sort(function (a, b) {
        return a.index - b.index; // 同 bar sell 在前（先出后进，与引擎止损顺序一致）
      });
      const r = backtest(candles, events, STOP);
      r.symbol = sym;
      rows.push(r);
      perCoin.push({ en: en, ex: ex, sym: sym, r: r });
    }
    const n = rows.reduce(function (a, r) { return a + r.closed; }, 0);
    const traded = rows.filter(function (r) { return r.closed > 0; });
    const wSum = traded.reduce(function (a, r) { return a + r.winRate * r.closed; }, 0);
    const eSum = traded.reduce(function (a, r) { return a + r.expectancy * r.closed; }, 0);
    const bSum = traded.reduce(function (a, r) { return a + r.avgBars * r.closed; }, 0);
    const wAvg = traded.length ? traded.reduce(function (a, r) { return a + (r.avgWin > 0 ? r.avgWin : 0); }, 0) / traded.length : 0;
    const lAvg = traded.length ? traded.reduce(function (a, r) { return a + r.avgLoss; }, 0) / traded.length : 0;
    lines.push('| ' + en + (ex === 'self' ? '(自带)' : ' → ' + ex) + ' | ' + (ex === 'self' ? '自带' : ex)
      + ' | ' + n + ' | ' + traded.length + '/' + rows.length
      + ' | ' + fmt(n ? wSum / n : 0, 1)
      + ' | ' + fmt(n ? eSum / n : 0, 2)
      + ' | ' + fmt(traded.length ? traded.reduce(function (a, r) { return a + (isFinite(r.profitFactor) ? r.profitFactor : 0); }, 0) / traded.length : 0, 2) + '*'
      + ' | ' + fmt(n ? bSum / n : 0, 0)
      + ' | ' + fmt(wAvg, 1) + ' | ' + fmt(lAvg, 1)
      + ' | ' + fmt(traded.reduce(function (a, r) { return a + r.strategyRet; }, 0) / (traded.length || 1), 1)
      + ' | ' + fmt(traded.reduce(function (a, r) { return a + r.maxDD; }, 0) / (traded.length || 1), 1)
      + ' |');
  }

  lines.push('');
  lines.push('*PF 为有交易币的简单均值（含 0），仅作粗排；净收益/回撤为币均值。');
  lines.push('');
  lines.push('## 每币明细（胜率% / 笔数 / 期望% / PF）');
  lines.push('');
  lines.push('| 入场→出场 | ' + COINS.join(' | ') + ' |');
  lines.push('|---|' + COINS.map(function () { return '---|'; }).join(''));
  for (const { en, ex } of combos) {
    const cells = COINS.map(function (sym) {
      const hit = perCoin.find(function (p) { return p.en === en && p.ex === ex && p.sym === sym; });
      if (!hit || !hit.r.closed) return '—';
      const r = hit.r;
      const thin = r.closed < 20 ? '⚠' : '';
      return fmt(r.winRate, 0) + thin + '%/' + r.closed + '/' + fmt(r.expectancy, 2) + '/' + fmt(r.profitFactor, 2);
    });
    lines.push('| ' + en + (ex === 'self' ? '(自带)' : '→' + ex) + ' | ' + cells.join(' | ') + ' |');
  }

  lines.push('');
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
  fs.writeFileSync('lab/exit-swap.md', out, 'utf8');
  console.log(out);
}

main().catch(function (e) { console.error(e); process.exit(1); });
