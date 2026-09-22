// 单币逐笔交易日志：用于 TradingView 人工核对（时间均为 UTC）
// 数据源：data-api.binance.vision（币安官方公共镜像，实时历史数据非模拟）
// 引擎：从 ../index.html 原样提取（backtest/calcRSI/sma/ema），与线上完全同口径
// 用法：node lab/trade-log.mjs [--symbol SOLUSDT] [--bars 5000] [--stop 5] [--interval 1h]
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

const arg = (name, dflt) => { const a = process.argv.find(x => x.startsWith('--' + name)); return a ? (a.split('=')[1] || dflt) : dflt; };
const SYMBOL = arg('symbol', 'SOLUSDT');
const BARS = Number(arg('bars', '5000'));
const STOP = Number(arg('stop', '5'));
const INTERVAL = arg('interval', '1h');

const backtest = new Function('FEE_PCT', 'return ' + extractFn(html, 'backtest'))(0.1);
const calcRSI = new Function('return ' + extractFn(html, 'calcRSI'))();
const smaFn = new Function('return ' + extractFn(html, 'sma'))();
const emaFn = new Function('return ' + extractFn(html, 'ema'))();
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

const BASE = 'https://data-api.binance.vision/api/v3/klines';
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function fetchAll(total) {
  const out = [];
  let endTime = null;
  while (out.length < total) {
    const need = Math.min(1000, total - out.length);
    let url = `${BASE}?symbol=${SYMBOL}&interval=${INTERVAL}&limit=${need}`;
    if (endTime) url += `&endTime=${endTime}`;
    const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
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
  return { events, r4 };
}

function regimeSeries(candles) {
  const c = candles.map(k => k.close);
  const e50 = emaFn(c, 50), e200 = emaFn(c, 200);
  return candles.map((_, i) => (e50[i] === null || e200[i] === null) ? null : clamp((e50[i] - e200[i]) / e200[i] * 3000, -100, 100));
}

const fmt = t => {
  const d = new Date(t);
  const p = n => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:00 UTC`;
};

const candles = await fetchAll(BARS);
const { events, r4 } = lhEvents(candles);
const regime = regimeSeries(candles);
const s = backtest(candles, events, STOP);

const closeByTime = new Map(candles.map(k => [k.time, k.close]));
const idxByTime = new Map(candles.map((k, i) => [k.time, i]));
const trades = [];
let cur = null;
for (const ev of s.tradeEvents) {
  if (ev.dir === 'buy') cur = { entryTime: ev.time, entryPrice: closeByTime.get(ev.time) };
  else if (ev.dir === 'sell' && cur) {
    const exitPrice = ev.stopped ? cur.entryPrice * (1 - STOP / 100) : closeByTime.get(ev.time);
    const ret = (exitPrice * 0.999) / (cur.entryPrice * 1.001) * 100 - 100;
    trades.push({ ...cur, exitTime: ev.time, exitPrice, stopped: ev.stopped, ret });
    cur = null;
  }
}

console.log(`${SYMBOL} ${INTERVAL} — 最近 ${BARS} 根（${fmt(candles[0].time)} → ${fmt(candles[candles.length - 1].time)}）`);
console.log(`数据源: data-api.binance.vision（币安官方镜像，与 quant.aeox.uk 同源）\n`);
console.log(`区间 Hold: ${s.holdRet >= 0 ? '+' : ''}${s.holdRet.toFixed(1)}% | Lighthouse 策略净收益: ${s.strategyRet >= 0 ? '+' : ''}${s.strategyRet.toFixed(2)}% (${s.closed} 笔, 胜率 ${s.winRate.toFixed(0)}%, 回撤 ${s.maxDD.toFixed(1)}%, 止损 ${STOP}%)\n`);
console.log('逐笔交易日志（时间均为 UTC；TradingView 按本地时区显示，北京时间 = UTC+8）:');
console.log('─'.repeat(118));
for (let n = 0; n < trades.length; n++) {
  const t = trades[n];
  const i = idxByTime.get(t.entryTime);
  const rg = regime[i];
  console.log(`#${String(n + 1).padStart(2)} 买入 ${fmt(t.entryTime)} @ ${t.entryPrice.toFixed(2)}`);
  console.log(`    卖出 ${fmt(t.exitTime)} @ ${t.exitPrice.toFixed(2)}  [${t.stopped ? 'STOP 止损' : 'SELL 信号'}]  净盈亏 ${t.ret >= 0 ? '+' : ''}${t.ret.toFixed(2)}%`);
  console.log(`    入场时 RSI(4)=${r4[i] === null ? 'n/a' : r4[i].toFixed(1)}  Regime=${rg === null ? 'n/a（预热中）' : rg.toFixed(0) + (rg > -40 ? '（闸门开放 ✓）' : '（闸门封锁 ✗）')}\n`);
}
if (s.open && cur) console.log(`※ 当前持仓中: ${fmt(cur.entryTime)} @ ${cur.entryPrice.toFixed(2)}（未平仓）`);
