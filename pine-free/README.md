# AEOX Pine Free Line（量化免费教学指标）

> 免费个人使用 · 禁转售禁再分发 · (c) 2026 AEOX · quant.aeox.uk
> 上游战略：`D:\My_Obsidian_Vault\20_New_Books\30_Publish\docs\FREE-PRODUCTS-STRATEGY.md` §6
> 痛点依据：`docs\quant-products\research\pain-points-catalog.md`（P1–P9）

## 文件清单

| shortId | 文件 | 解决痛点 | 说明 |
|---|---|---|---|
| qf06 | `AEOX_Signal_Confirm.pine` | P1 重绘 + P3 alert 时机 | 只画收盘确认信号；可选"幽灵"标记演示盘中信号如何消失；1 个 alertcondition（isconfirmed 守卫） |
| qf07 | `AEOX_MTF_Snapshot.pine` | P4 MTF 疲劳 | 15m/1H/4H/1D 固定四周期 RSI(4)+SMA100 趋势状态表；`expr[1] + lookahead_on` 防重绘惯用法全程注释 |
| qf08 | `AEOX_Multi_Symbol_Radar.pine` | P5 免费版无扫描 | 5 symbol 迷你雷达表（免费版 Pine Screener 平替）；固定 DIP/EXT 规则 |
| qf09 | `AEOX_Fee_Reality.pine` | P2 回测虚高 | 信号频率计数 + 累计费用拖累曲线 + 含费保本胜率；费率 0.1%/side 固定常量 |

批次 1（qf01–qf05 Primer/Lite）按战略文档 §6.1 另行执行，**尚未写入本目录**。

## 免费 vs 付费差异（刻意保留的差距）

| 能力 | 免费线（本目录） | 付费 Premium Suite（`../pine-suite/`） |
|---|---|---|
| 信号 | 固定规则、朴素标记 | 引擎对齐事件、持仓状态机 |
| 止损/止盈 | 无（教育口径） | ATR 自适应止损/止盈工程 |
| 权重 | 无（或写死） | Confluence 可调权重 |
| Alerts | 至多 1 个 | 完整 alerts 全家桶 |
| 定位 | 教学透明，可审计 | 风险工程产品 |

## 护城河规则自查记录（2026-09-19，逐条 grep 验证）

- [x] Pine v5 单文件、无 `import`
- [x] 经典参数可用 input（RSI/SMA 周期、symbol、面板位置）；权重/ATR 止损/止盈/量能开关**不存在**
- [x] 无 `var int dir` 状态机、无 STOP/TP 标记；alertcondition：qf06×1、qf07×0、qf08×0、qf09×0
- [x] 头部注释块齐全（功能 + free educational version + LICENSE + (c) 2026 AEOX）
- [x] 教学注释密集 + 尾部 CTA（quant.aeox.uk / go.aeox.uk）齐全
- [x] 无收益承诺；每文件 "Educational tool, not financial advice."

## 测试（本地无 Pine 编译器，唯一手段）

1. TradingView → Pine Editor → 逐个粘贴编译；
2. qf06：开 ghost 开关，观察实盘 bar 上幽灵标记出现/消失，收盘后确认标记保留；建 alert 验证收盘触发；
3. qf07：15m 图加载，对照各周期真实图验证数值；确认数值在 HTF 收盘前不跳变（防重绘生效）；
4. qf08：默认 5 个 Binance symbol 验证表格渲染；填无效 symbol 验证 "n/a" 降级；
5. qf09：拖动图表观察计数与拖累曲线单调性；对照网页版含费回测口径。
