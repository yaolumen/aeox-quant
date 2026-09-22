// 前向测试工具：5 币 × 2 窗口 Lighthouse 汇总（对照 lab 基线）
// 数据源：data-api.binance.vision（币安官方公共镜像，与页面同源，实时历史数据非模拟）
// 引擎：从 ../index.html 原样提取（backtest/calcRSI/sma），与线上完全同口径
// 用法：node lab/lh-forward.mjs [--bars 3000,10000]
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

function extractFn(src, name) {
  const i = src.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('fn not found: ' + name);
  let p = src.indexOf('(', i), depth = 0, j = p;
  for (; j < src.length; j++) {
    if (src[j] === '(') depth++;
    else if (src[j] === ')') { depth--; if (!depth) break; }
  }
  const b = src.indexOf('{', j);
  depth = 0;
  for (let k = b; k < src.length; k++) {
    if (src[k] === '{') depth++;
    else if (src[k] === '}') { depth--; if (!depth) return src.slice(i, k + 1); }
  }
  throw new Error('unbalanced: ' + name);
}

const FEE = 0.1;
const backtest = new Function('FEE_PCT', 'return ' + extractFn(html, 'backtest'))(FEE);
const calcRSI = new Function('return ' + extractFn(html, 'calcRSI'))();
const smaFn = new Function('return ' + extractFn(html, 'sma'))();

const BASE = 'https://data-api.binance.vision/api/v3/klines';
const COINS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT'];

const argBars = process.argv.find(a => a.startsWith('--bars'));
const BARS = argBars ? argBars.split('=')[1].split(',').map(Number) : [3000, 10000];

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function fetchAll(symbol, total) {
  const out = [];
  let endTime = null;
  while (out.length < total) {
    const need = Math.min(1000, total - out.length);
    let url = `${BASE}?symbol=${symbol}&interval=1h&limit=${need}`;
    if (endTime) url += `&endTime=${endTime}`;
    const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error(`${symbol} HTTP ${r.status}`);
    const batch = await r.json();
    if (!batch.length) break;
    out.unshift(...batch);
    endTime = batch[0][0] - 1;
    await sleep(120);
  }
  return out.map(k => ({ time: k[0], open: +k[1], high: +k[2], low: +k[3], close: +k[4] }));
}

function lhEvents(candles) {
  const c = candles.map(k => k.close);
  const r4 = calcRSI(c, 4), s100 = smaFn(c, 100);
  const events = [];
  let prevIn = null, prevOut = null;
  for (let i = 0; i < candles.length; i++) {
    if (r4[i] === null || s100[i] === null) { prevIn = null; prevOut = null; continue; }
    const inZone = r4[i] < 10 && c[i] > s100[i];
    const outZone = r4[i] > 70;
    if (prevIn !== null) {
      if (!prevIn && inZone) events.push({ time: candles[i].time, index: i, dir: 'buy' });
      else if (!prevOut && outZone) events.push({ time: candles[i].time, index: i, dir: 'sell' });
    }
    prevIn = inZone; prevOut = outZone;
  }
  return events;
}

function engineEntries(events) {
  const ents = [];
  let dir = 0;
  for (const e of events) {
    if (e.dir === 'buy' && dir === 0) { dir = 1; ents.push(e.time); }
    else if (e.dir === 'sell') dir = 0;
  }
  return ents;
}

const fmtPct = x => (x >= 0 ? '+' : '') + x.toFixed(2) + '%';
const d = t => new Date(t).toISOString().slice(0, 10);

function runWindow(label, data, bars) {
  console.log(`\n================ ${label}（最近 ${bars} 根 1H ≈ ${(bars / 24).toFixed(0)} 天）================`);
  console.log('币种    | 平仓笔数 | 胜率   | 净收益   | 最大回撤 | Hold    | 入场频率');
  console.log('--------|---------|--------|---------|---------|---------|---------');
  let totClosed = 0, totWin = 0, totDays = 0, worstDD = 0;
  const sum = { strat: 0, hold: 0 };
  for (const sym of COINS) {
    const candles = data[sym].slice(-bars);
    const events = lhEvents(candles);
    const s = backtest(candles, events, 5);
    const ents = engineEntries(events);
    const days = (candles[candles.length - 1].time - candles[0].time) / 86400000;
    totClosed += s.closed; totWin += s.winRate * s.closed; totDays += days;
    worstDD = Math.max(worstDD, s.maxDD);
    sum.strat += s.strategyRet; sum.hold += s.holdRet;
    console.log(
      `${sym.replace('USDT', '').padEnd(7)} | ${String(s.closed).padEnd(7)} | ${s.winRate.toFixed(0)}%   | ${fmtPct(s.strategyRet).padEnd(7)} | ${fmtPct(-s.maxDD).padEnd(7)} | ${fmtPct(s.holdRet).padEnd(7)} | 每 ${(days / Math.max(ents.length, 1)).toFixed(0)} 天/次 (${ents.length} 次)`
    );
    if (ents.length > 2) console.log(`         最近入场: ${ents.slice(-3).map(d).join(', ')}`);
  }
  const avgTrades = totClosed / COINS.length;
  console.log('--------|---------|--------|---------|---------|---------|---------');
  console.log(`合计: ${totClosed} 笔 | 均胜率 ${(totWin / Math.max(totClosed, 1)).toFixed(0)}% | 净收益(均/币) ${fmtPct(sum.strat / COINS.length)} vs Hold(均/币) ${fmtPct(sum.hold / COINS.length)} | 最大单币回撤 ${worstDD.toFixed(1)}% | 均值每币 ${avgTrades.toFixed(1)} 笔 / ${(totDays / COINS.length).toFixed(0)} 天 ≈ 每 ${((totDays / COINS.length) / Math.max(avgTrades, 0.1)).toFixed(0)} 天 1 次`);
}

const data = {};
for (const sym of COINS) {
  data[sym] = await fetchAll(sym, Math.max(...BARS));
  console.error(`fetched ${sym}: ${data[sym].length} bars`);
}
runWindow(`牛尾窗口对照（lab 基准: +1.10%/笔 / 84%）`, data, BARS[0]);
runWindow(`深熊窗口对照（lab 基准: +0.14%/笔 / 65% / net +1.7%）`, data, BARS[1]);
