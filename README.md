# AEOX Quant（原 QuantSignal Lab）— 加密货币指标展示面板

纯静态单文件网页：浏览器直连 Binance 公开 API，展示指标信号 + 诚实回测（含止损、手续费）。**当前为研究成果展示站（showcase mode，2026-09-18 定案）**：仪表盘/方法论/实验报告全公开，暂不出售任何商品；付费 Pine 套件跨平台对齐验证完成后后期开放购买，届时经 go.aeox.uk 公告（分两步走的 Phase 1）。

**品牌**：AEOX 家族主品牌前置（导航 `AEOX Quant`、hero eyebrow、title/OG/JSON-LD 均已切换），QuantSignal Lab 降为副线保留（hero 标注 "formerly"、JSON-LD alternateName 承接 SEO 连续性）。

## 文件结构

```
aeox-quant/
├── index.html        全部内容（HTML/CSS/JS 单文件，无构建、无依赖安装）
├── og-cover.html     OG 封面渲染稿（1200×630，headless 截图导出 og-cover.png 用）
├── og-cover.png      OG 分享封面图（1200×630）
├── robots.txt        搜索引擎抓取规则 + sitemap 指针
├── sitemap.xml       站点地图
├── pine-suite/       付费 Pine 套件交付物（5 个 .pine + 套件 README，Phase 2 开售时随订单发给买家，不部署；2026-09-18 Lighthouse/Confluence/Flow 已加持仓状态机——标记=引擎口径配对，待在 TradingView 重新粘贴编译验证）
├── lab/qs-lab.mjs    本地研究工具（仅本机跑，不部署、不占 Node 名额）
├── lab/exit-swap.mjs 入场/出场指标分离实验（lab/exit-swap.md 综合报告）
├── lab/regime-filter.mjs  Regime 入场过滤实验（lab/regime-filter.md）
├── lab/lh-forward.mjs  前向测试工具：5 币 × 2 窗口汇总（实时数据，页面同引擎提取）
├── lab/trade-log.mjs   单币逐笔交易日志（TradingView 人工核对用，--symbol/--bars/--stop）
├── lab/forward.md      前向测试台账（每月跑一次只追加；2026-09-18 首期已复现 lab 基线）
├── lab/qs-verify.js    回归①：i18n 键全解析 + EN/ZH 对齐（当前基线 144 使用/146 定义）
├── lab/strip-test.js   回归②：止损后空仓+STOP 状态（图表箭头与引擎同源）
├── lab/exitmods-test.js 回归③：退出开关 applyExitMods 四场景（T1 透传/T2 Regime 滤/T3 快出/T4 组合）
├── lab/equity-test.js 回归④：eqSeries 权益曲线数值合成三场景（平段/浮盈/止损）
├── lab/baseline.md   基线报告（当前四件套 × 5 币 × 3 周期 × 3000 根）
└── README.md         本文档
```

> ⚠️ `lab/qs-lab.mjs` 的 SYNC-AREA 与 index.html 引擎手工同步，改任一处须同步另一处。用法：`node lab/qs-lab.mjs [--pages 3] [--stop 5] [--lighthouse] [--tf 1h]`（`--lighthouse` 跑 Lighthouse v0 研究网格，输出 `lab/lighthouse-v0-{tf}.md` + 全网格 CSV）。

目标域名：**quant.aeox.uk**（已在 index.html 中替换完成）

## 本地预览

双击 `index.html` 用浏览器打开即可，无需任何服务器。需要能访问 Binance API。

## 部署到 Hostinger

1. 上传到 `public_html`（或子目录 / 二级域名根目录）：`index.html`、`og-cover.png`、`robots.txt`、`sitemap.xml`（`og-cover.html` 与 `lab/` 不部署）
2. **上线前必须替换的占位符**：
   - ~~`https://www.yourdomain.com/`~~ → 已替换为 `https://quant.aeox.uk/`
   - ~~`https://ko-fi.com/AEOXQUANT`~~ → **已随展示版上线整体移除**（2026-09-18）：所有 Ko-fi 链接/商品承诺改为"coming soon / 即将开放"，页脚与 About 区均无购买入口。后期开放购买时再回填真实商店链接
   - 页脚 AEOX Network 各站链接（aeox.uk / anchor / cli / chat / shui / go）→ 按实际上线情况增删（2026-09-18 已加入 chat.aeox.uk，顺序：AEOX / Anchor / cli / Chat / Shui，规范见 D:\project\footer家族式设计.txt）
   - 站名已改为 `AEOX Quant`（若再改名需同步：title、OG、JSON-LD、导航 brand、hero eyebrow、About、页脚）
3. ~~建议补充：`og-cover.png`、`robots.txt`、`sitemap.xml`~~ → 已补齐（og-cover.png 由 og-cover.html 渲染导出；改封面后用 headless 浏览器重截 1200×630 覆盖）
4. 旗舰叙事已定案：**双旗舰并提** —— Lighthouse（1H 急跌波段扫描器）+ QS Confluence（多因子共振），hero/title/OG/JSON-LD/methodology/FAQ 均双提
5. **上线前验证清单（每次改完 index.html 必跑，全绿才算可部署）**：
   - `node lab/qs-verify.js` → i18n 键全解析 + EN/ZH 对齐（基线 144/146）
   - `node lab/strip-test.js` / `node lab/exitmods-test.js` / `node lab/equity-test.js` → 引擎行为回归三件套
   - 主脚本语法：提取最后一个 `<script>` 块 `node --check`
   - headless 真渲染（必做）：`msedge --headless=new --user-data-dir=<独立目录> --virtual-time-budget=20000 --dump-dom file:///D:/project/aeox-quant/index.html`，检查 `id="status"` 为正常数据行（非 `class="status error"`）且扫描表有数据行 —— **2026-09-19 上线体检靠它抓出 applyModel 变量遮蔽 P0**（`var t = theme()` 遮蔽 i18n `t()`，权益曲线/成交量/面板全挂但合成测试测不到 UI 装配层，已修复并录入知识库）
6. **当前状态（2026-09-19）：展示版全绿可部署** —— 上线体检通过：部署文件齐全、og-cover 1200×630、占位符零残留（ko-fi.com 全清）、SEO 四件套（canonical/OG/Twitter/JSON-LD×2 合法且域名统一）、引擎回归 4/4、外链全为 AEOX 家族域名、headless 真渲染数据加载正常（实时价 + 扫描行 + 状态栏无错）

## 功能清单

| 模块 | 说明 |
|---|---|
| 币种 | BTC / ETH / SOL / BNB / XRP（Binance USDT 交易对，可扩展） |
| 指标 | **Lighthouse**（旗舰，研究验证版）：短线波段核心，RSI(4)<10 且价格>SMA100 时买入、RSI(4)>70 卖出，针对 1H 调优（3 年 × 5 币 × 2430 配置网格选参，训练/测试双正、4/5 币稳健、OOS 打赢 RSI-14 基准，见 `lab/lighthouse-v0-1h.md`）；**QS Suite 自有四件套（β）**：Confluence v1（RSI 35% + 布林%B 25% + EMA 差 15% + 资金费率逆向因子 25%）、Regime（EMA50/200 环境过滤 ±40 阈值）、Flow（taker 买入占比 + 量能 z-score 确认）、Risk（2×ATR 自适应止损建议，`noBacktest` 不参与回测）；另有经典 RSI、MACD、Bollinger、EMA Cross。默认加载 Lighthouse + 1H 周期 |
| 周期 | 1H / 4H / 1D，每次拉取 1000 根 K 线 |
| 止损 | 3% / 5% / 8% / 关闭，盘中触发按止损价成交 |
| 手续费 | 0.1%/边（Binance 现货 taker），每笔进出都扣 |
| **扫描中心（#scan）** | 合并原"行情友好度 + 回测矩阵"为一张表 + 模式开关：**我的配置** = 当前选中指标栈 × 5 币 × 3 周期 = 15 组合按净收益排序，Top3 高亮，点击行跳图表（打开页面自动跑）；**全指标对比** = 8 个信号指标在当前周期/止损下单跑、5 币平均出排行榜；切换指标/止损/周期自动重扫（K 线有缓存，重扫零请求）；表格上方醒目说明行写清当前配置（组合名 + 止损 + 币种×周期范围）；"我的配置"全表 0 交易时显示引导文案（减指标 / 切 1H / 放宽止损） |
| **多选组合（QS Stack）** | 指标按钮支持多选：**所有选中信号指标同时看多才入场，任一转空即离场**（同向共振）；选中 QS Risk 时止损自动切换 2×ATR 自适应（回测引擎支持逐 bar 止损数组，已修复数组止损不触发的比较 bug）；组合自动进"我的配置"扫描；多选时统计卡下方显示「组合 vs 首个信号指标单跑」对比行（交易数/胜率/回撤/收益） |
| **图表箭头 = 实际进出场** | K 线箭头来自回测引擎的真实成交记录（`tradeEvents`），不再是原始信号：BUY = 实际开仓，SELL = 信号平仓，**STOP = 止损离场**；原始信号总数仍诚实展示在"信号数"统计卡，方法论 br6 解释两者区别（阈值型指标会连续同向触发，引擎只认第一个） |
| **实时状态一览（live strip）** | 控制区下方的 5 币状态条：当前指标栈在当前周期下每币的实时**成交状态**（与图表箭头、统计卡同源——同一回测引擎含止损）：持多（绿点 + BUY N 根前）/ 空仓（灰点 + SELL 或 STOP 止损 N 根前）/ 当前 bar 信号待收盘确认；止损触发后如实显示空仓+STOP，不会停留在信号层的"持多"；K 线缓存 5 分钟 TTL，长开页面也能拿到新 bar |
| **退出工程开关（实验性）** | 止损控制旁两个独立开关，默认关，4 窗口（牛/熊/深熊，1H+4H，~2.2 万根）实验验证（`lab/exit-swap.md` + `lab/regime-filter.md`）：**Regime 过滤 > -40**（历史深熊数据拟合值，非未来保证） = 下行确立时不开新仓（深熊窗口 qs 亏损 -18%→-1%、回撤 -16pp；代价：强牛期望略降、XRP 型阴跌反弹例外）；**快速了结 RSI(14)>70** = 各指标自带卖出统一替换为 RSI14 crossing（胜率稳定翻倍 28%→51-62%，但期望不升——"买胜率不买钱"）。事件后处理层 `applyExitMods` 统一接入图表/扫描/live strip 三处，同源不脱节；method.exits 双语披露取舍 |
| **使用指南** | 实操工作流（#guide 区，4 步）：入场前筛选（含定期重扫）→ 图表验证 + 样本量意识（<30 笔统计单薄）→ 止损/费率匹配 → 按最大回撤定仓位；另含 Stacking 说明与 Pine Script 套件（准备中）一致性说明——套件开放前，仪表盘即参考实现 |
| **操作流畅性（P0）** | ① URL hash 全状态持久化：币种/周期/指标组合/止损/退出开关进 `#symbol=...`，刷新不丢、配置可分享（控制区 Share 按钮复制链接）；② 图表加载反馈：切换时图表区半透明 + 顶部流动进度条（`is-loading`）；③ 控制区 sticky 吸顶，长页面滚动中操作始终可达 |
| **资金曲线（P1）** | 主/副图下方第三张图：**$100 策略 vs 买入持有成长曲线**（逐 bar 权益，持仓浮盈按收盘价含费口径，`eqSeries` 引擎输出）—— 风险工程叙事的视觉证据；三图 range 联动；扫描表列头点击排序（收益/胜率/笔数/回撤/超额，▲▾ 指示） |
| **多币对比视图（P2）** | 扫描中心第三模式 "Compare"：5 币迷你走势图一屏对比（收盘线 + 实际成交箭头，每卡显示净收益/胜率/笔数），点击卡片载入主图表；mini chart 随主题刷新 |
| **引擎规则披露** | 方法论 br7：同根 K 线可先止损（盘中按止损价）再按收盘价重新进场，两个箭头同蜡烛；止损后无冷却期，每根 bar 独立评估 —— 客户看到 STOP+BUY 同根不是 bug，已书面披露 |
| **合规（#legal 区）** | 隐私（静态页/无追踪/localStorage 偏好/浏览器直连币安）· 产品许可与退款（展示版口径：当前无商品在售；套件开放后个人 TradingView 单账户、禁转售、退款条款先于购买发布）· 风险声明（非建议/历史≠未来/非持牌顾问）；页脚免责声明同步强化（含 "not suitable for every investor"） |
| 风险统计 | 胜率、最大回撤、被止损次数、对比 buy & hold |
| SEO | TDK、canonical、Open Graph、Twitter Card、FAQ 结构化数据（JSON-LD）、语义化标签、单一 h1 |
| 主题 | 4 套可切换：Fresh Mint（默认）/ Cloud Sky / Warm Peach / Night（原深色），导航栏色点切换，localStorage 记忆 |
| **i18n 双语** | 导航栏「中文/EN」按钮切换英文（默认，SEO）/ 中文；`I18N` 字典（en/zh 全量 146 键，144 使用）+ `t(key, vars)` 占位替换；静态文案走 `data-i18n` 属性由 `applyI18n()` 统一刷新，动态文案（状态栏、统计卡副文案、扫描/矩阵运行时字符串、组合标签）在生成处直接调 `t()`；`statLabel` 为 `{en, zh}` 对象经 `pickLabel()` 解析；语言记忆 localStorage `qs-lang`，head 预载脚本提前设置 `<html lang>` 防闪烁；切换时自动重渲染统计卡与友好度表；改动后跑 `lab/qs-verify.js` 验证 |
| 家族化 | AEOX 四列大页脚（品牌宣言 / 本站导航 / AEOX 家族网络五站：AEOX/Anchor/cli/**Chat**/Shui / 资源）+ 底部版权互链闭环 + About 双 CTA（主：go.aeox.uk 资源中心，次：付费套件 coming soon 徽章）+ JSON-LD publisher 指向 AEOX 组织；规范见 `D:\project\footer家族式设计.txt`（2026-09-19 已收录 chat.aeox.uk，Network 列升级为五条） |

## 如何添加新指标（registry 模式）

JS 里有一个 `INDICATORS` 注册表，每个指标就是一个对象。加新指标三步：

1. 写一个 `compute(candles, ctx)` 函数（ctx = `{ symbol, funding }`，按需取用），返回三样东西：
   - `pane`：副图/独立面板的画线数据（RSI、MACD 用；叠加型指标留空数组）
   - `overlay`：叠加在 K 线主图上的画线数据（布林带、EMA 用）
   - `events`：信号事件数组，每项 `{ time, index, dir: 'buy'|'sell' }`
2. 把对象挂进 `INDICATORS`，给个 key（如 `myInd`）
3. HTML 里加一个按钮：`<button data-indicator="myInd">我的指标</button>`

**信号事件是唯一契约**：回测引擎只认 `events`，不关心指标内部逻辑。画图、统计、回测矩阵全部自动复用。

## 架构要点

- **数据链路**：浏览器直连 `api.binance.com` 公开接口，失败自动切备用 `data-api.binance.vision`。无 API key、无服务器中转。资金费率走 `fapi.binance.com`（Binance Futures 公开接口，失败自动降级为中性值 50，不破页面）；taker 买入量直接取自 K 线第 9 字段，零额外请求。
- **四层分工设计**：Regime（该不该交易）→ Confluence（何时进）→ Flow（有没有量能背书）→ Risk（止损放哪）；完整联动的 Full Stack 仅付费 Pine 版提供。
- **compute 契约 v2**：`compute(candles, ctx)`，`ctx = { symbol, funding }`——旧指标忽略 ctx，新指标按需取用。
- **一切计算在客户端**：view-source 可审计是核心卖点，别破坏它。
- **付费指标逻辑不要放进这个公开页面**——免费版保持透明，付费版走 TradingView Pine Script（购买后交付）或以后用 Node 额度做服务端计算。
- 免费版 QS Confluence 权重写死公开（RSI 35% + 布林%B 25% + EMA 差 15% + 资金费率逆向 25%）；付费版差异 = 可调权重 + 成交量确认 + 止盈逻辑。

## 已知局限（诚实清单）

- 每次请求上限 1000 根 K 线（1D ≈ 2.7 年，4H ≈ 166 天）；更长历史需分页拼接，暂未做
- 只做多（long-only），未做空；无滑点建模；手续费按 taker 固定 0.1% 计
- 回测按 bar close 进出场的简化模型，与真实盘口有差异
- Binance API 有地区限制，部分地区需缓存代理解决（后续用 Node 额度做）

## 变现规划（两步走）

- **Phase 1（当前，已实施）：展示版上线** —— 纯展示 + SEO 预热：仪表盘/方法论/lab 报告全公开，无任何商品在售；go.aeox.uk 作为资源中心入口；不做 waitlist（静态页无后端，且与"无追踪"承诺冲突）。页面所有付费措辞已改为"对齐验证中/即将开放"（双语 + JSON-LD 同步）
- **Phase 2（后期，待对齐验证完成后）**：Ko-fi 开通付费下载，回填商店链接 + legal 区改回现在时 + 路线图阶段三打勾
- 免费网页 = 展示与引流（透明、可验证、含费回测）；免费/付费**同一套逻辑**，所见即所得
- **核心叙事 = 风险工程（已定案）**："信号廉价，纪律性的退出才是产品"——止损截断左尾、盈亏比与胜率的取舍全部诚实展示（1D 低胜率是证据不是缺陷）；hero 副标题 / method.outro / QS Risk 描述已按此改写，QS Risk 定位升为"止损工程"
- **只卖套餐，不拆售**：AEOX Quant Premium Suite（Lighthouse + QS 四件套全家桶）一个打包商品，单价 **$19.99 首发 → $29.99 常规**；付费差异排序（止损工程前置）：ATR 自适应止损 + 止盈逻辑 + 可调权重 + 成交量确认 + TradingView alerts；**追踪止损只出现在路线图，不得作为现有功能宣传**（商品未做）；Ko-fi 商品页描述需与页面同样保持 "educational tool, not financial advice" 口径
- **Pine 套件已打样**（`pine-suite/`，5 个脚本 + 套件 README）：Lighthouse（含 ATR 自适应止损/可选止盈/成交量确认/alerts）· Confluence（权重可调）· Regime · Flow（CLV 代理，TradingView 无 taker 数据）· Risk（2×ATR(14) clamp 2–12%）。parity 口径：Lighthouse/Regime/Risk 逐 bar 一致；Confluence = 页面费率降级模式（费率因子固定 50）；Flow 用代理已文档化。页面 method.qs / guide.pine 文案已按此对齐。Pine 语法需在 TradingView Pine Editor 实测（本地无编译器）
- 免费单指标（经典 RSI/MACD 等基础 Pine 脚本 + 选型指南 PDF）放 go.aeox.uk 做引流饵料（换邮箱）
- 免费公示的成绩表（回测矩阵 + 友好度扫描）就是商品页最硬的素材
- **合规块已就位**（#legal 区，双语，展示版口径）：隐私（无追踪/无账号/浏览器直连币安）· 产品许可与退款（当前无商品在售；开放后个人单账户、禁转售、条款先于购买发布）· 风险（非投资建议/历史不代表未来/非持牌顾问）；页脚免责声明同步强化

## 路线图

1. 指标插件化：`indicators/` 目录 + manifest（本地开发完直接传文件即更新）
2. QS Confluence v1：加成交量、资金费率因子，权重可调
3. 止盈 / 移动止损变体
4. 每日市场扫描报告（需 cron / Node）
