// 类型定义
import { computeProfitLoss, deriveHoldingsFromTrades } from './localTrades';
import {
  parseBbaeXlsxArrayBuffer,
  parseMoomooXlsxArrayBuffer,
  parseTradeImportLegacyCsv
} from './tradeImport';

type TradeSignal = 'buy' | 'hold' | 'sell';

/** 单笔买入（股数 / 合约张数 + 单价成本），列表展示为加权平均成本 */
interface CostLot {
  shares: number;
  /** 正股：每股成本；期权：每份合约成本 */
  costPerShare: number;
}

interface Stock {
  symbol: string;
  name: string;
  shares: number;
  /** 未填写表示无目标价，展示与导出可为空 */
  targetPrice?: number;
  /** 加权平均成本（由 costLots 汇总或与单笔 legacy 一致）；正股每股 / 期权每份 */
  avgCost?: number;
  /** 多次买入明细；存在时 shares、avgCost 由同步函数维护 */
  costLots?: CostLot[];
  /** 买入 / 持有 / 卖出 */
  signal?: TradeSignal;
  currentPrice: number;
  position: number;
  weight: number;
  type?: 'stock' | 'option'; // 股票或期权
  optionStrike?: number;      // 期权执行价
  optionExpiry?: string;       // 期权到期日
  optionType?: 'C' | 'P';      // 期权类型 C=看涨 P=看跌
  /** Symbol Search 返回的 type，如 ETP、Common Stock（表格「类型」列） */
  instrumentType?: string;
  /** 手动拖到某一品类后，归入该主标的代码；不设则按 Finnhub/代码自动分组 */
  groupWith?: string;
}

// 导出数据结构（含交易快照便于完整恢复）
interface ExportData {
  version: string;
  exportDate: string;
  cash: number;
  stocks: Stock[];
  trades?: TradeRecord[];
}

// 股票数据接口 (来自后端 API)
interface StockData {
  symbol: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
}

interface AppState {
  stocks: Stock[];
  totalValue: number;
  /** 正股持仓市值 */
  stockMarketValue: number;
  /** 期权持仓市值 */
  optionMarketValue: number;
  /** 已填成本行盈亏合计；无任一行填成本时为 null */
  totalPnl: number | null;
  cash: number;
  loading: boolean;
  error: string;
  /** 交易历史记录 */
  trades: TradeRecord[];
  /** 当前用户盈亏统计 */
  pnlStats: PnlStats | null;
  /** 盈亏统计时间范围 */
  pnlStartDate: string;
  pnlEndDate: string;
}

// 交易记录类型
interface TradeRecord {
  id: string;
  symbol: string;
  name: string;
  type: 'buy' | 'sell';
  shares: number;
  price: number;
  total_amount: number;
  commission: number;
  trade_date: string;
  created_at: string;
}

// 盈亏统计类型
interface PnlStats {
  totalBuyAmount: number;
  totalSellAmount: number;
  realizedPL: number;
  commission: number;
  netPL: number;
}

// 应用状态
const state: AppState = {
  stocks: [],
  totalValue: 0,
  stockMarketValue: 0,
  optionMarketValue: 0,
  totalPnl: null,
  cash: 0,
  loading: false,
  error: '',
  trades: [],
  pnlStats: null,
  pnlStartDate: '',
  pnlEndDate: ''
};

/** 交易面板状态 */
let tradePanelOpen = false;
let tradeFormSymbol = '';
let tradeFormName = '';
/** 交易表单：true 时代码可编辑（新增交易） */
let tradeFormFreeEntry = false;
let tradeFormType: 'buy' | 'sell' = 'buy';
let tradeHistoryModalOpen = false;
let tradeHistoryFilter = {
  symbol: '',
  type: '' as '' | 'buy' | 'sell',
  startDate: '',
  endDate: ''
};
let tradeHistoryPage = 1;
/** 交易记录弹窗每页条数（可选 10 / 20 / 50 / 100） */
let tradeHistoryPageSize = 10;
const TRADE_HISTORY_PAGE_SIZE_OPTIONS = [10, 20, 50, 100] as const;

/** 编辑交易弹窗状态 */
let editTradeModalOpen = false;
let editingTrade: TradeRecord | null = null;

/** 导入交易弹窗状态 */
let importTradeModalOpen = false;
let importPreviewData: TradeRecord[] = [];
let importError: string | null = null;

/** 表格标的分组排序：代码=标的字母序，仓位=品类占组合%（dir：1 升序，-1 降序） */
type TableSortKey = 'symbol' | 'weight';
let tableSortKey: TableSortKey = 'weight';
let tableSortDir: 1 | -1 = -1;

/** 持仓表列（用于显示/隐藏） */
type HoldingsColumnKey =
  | 'type'
  | 'symbol'
  | 'shares'
  | 'cost'
  | 'price'
  | 'pnl'
  | 'pnlPct'
  | 'position'
  | 'weight'
  | 'target'
  | 'optinfo'
  | 'signal'
  | 'actions';

const HOLDINGS_COLUMN_META: ReadonlyArray<{ key: HoldingsColumnKey; label: string }> = [
  { key: 'type', label: '类型' },
  { key: 'symbol', label: '代码' },
  { key: 'shares', label: '股数' },
  { key: 'cost', label: '成本' },
  { key: 'price', label: '现价' },
  { key: 'pnl', label: '盈亏' },
  { key: 'pnlPct', label: '盈亏比例' },
  { key: 'position', label: '持仓' },
  { key: 'weight', label: '仓位 / 占比' },
  { key: 'target', label: '1y目标价' },
  { key: 'optinfo', label: '期权信息' },
  { key: 'signal', label: '打分' },
  { key: 'actions', label: '操作' }
];

const HOLDINGS_COL_SUFFIX: Record<HoldingsColumnKey, string> = {
  type: 'type',
  symbol: 'symbol',
  shares: 'shares',
  cost: 'cost',
  price: 'price',
  pnl: 'pnl',
  pnlPct: 'pnl-pct',
  position: 'pos',
  weight: 'weight',
  target: 'target',
  optinfo: 'optinfo',
  signal: 'signal',
  actions: 'actions'
};

function holdingsCellClass(key: HoldingsColumnKey): string {
  return `col-h-${HOLDINGS_COL_SUFFIX[key]}`;
}

function loadColumnVisibility(): Record<HoldingsColumnKey, boolean> {
  const defaults = (): Record<HoldingsColumnKey, boolean> => {
    const o = {} as Record<HoldingsColumnKey, boolean>;
    for (const { key } of HOLDINGS_COLUMN_META) o[key] = true;
    return o;
  };
  try {
    const raw = localStorage.getItem('portfolioHoldingsColumnVisibility');
    if (!raw) return defaults();
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const d = defaults();
    for (const k of Object.keys(d) as HoldingsColumnKey[]) {
      if (typeof parsed[k] === 'boolean') d[k] = parsed[k];
    }
    return d;
  } catch {
    return defaults();
  }
}

let columnVisibility: Record<HoldingsColumnKey, boolean> = loadColumnVisibility();

function persistColumnVisibility(): void {
  localStorage.setItem('portfolioHoldingsColumnVisibility', JSON.stringify(columnVisibility));
}

/** 勾选关闭时仅遮盖单元格数据，列与表头仍保留 */
const HOLDINGS_DATA_MASK_HTML = '<span class="col-data-masked">—</span>';

function maskOr(key: HoldingsColumnKey, visibleHtml: string): string {
  return columnVisibility[key] ? visibleHtml : HOLDINGS_DATA_MASK_HTML;
}

function setHoldingsColumnVisible(key: string, visible: boolean): void {
  const k = key as HoldingsColumnKey;
  if (!HOLDINGS_COLUMN_META.some(m => m.key === k)) return;
  columnVisibility[k] = visible;
  persistColumnVisibility();
  render();
}

const LS_DASHBOARD_SUMMARY_VISIBLE = 'portfolioDashboardSummaryVisible';

function loadDashboardSummaryVisible(): boolean {
  try {
    const raw = localStorage.getItem(LS_DASHBOARD_SUMMARY_VISIBLE);
    if (raw === null) return true;
    return raw === '1' || raw === 'true';
  } catch {
    return true;
  }
}

let dashboardSummaryVisible: boolean = loadDashboardSummaryVisible();

function persistDashboardSummaryVisible(): void {
  localStorage.setItem(LS_DASHBOARD_SUMMARY_VISIBLE, dashboardSummaryVisible ? '1' : '0');
}

function setDashboardSummaryVisible(visible: boolean): void {
  dashboardSummaryVisible = visible;
  persistDashboardSummaryVisible();
  render();
}

function renderHoldingsColumnTogglePanel(): string {
  const boxes = HOLDINGS_COLUMN_META.map(
    ({ key, label }) => `
    <label class="holdings-col-toggle-label">
      <input type="checkbox" ${columnVisibility[key] ? 'checked' : ''}
             onchange="setHoldingsColumnVisible('${key}', this.checked)" />
      <span>${escapeHtml(label)}</span>
    </label>`
  ).join('');
  return `
    <div class="holdings-column-panel">
      <div class="holdings-column-panel-title">列数据（勾选显示该列数据）</div>
      <div class="holdings-column-panel-body">${boxes}</div>
    </div>`;
}

// Alpha Vantage API
const ALPHA_VANTAGE_API = 'https://www.alphavantage.co/query';
const ALPHA_VANTAGE_API_KEY = 'DU6YOC69XS1OR37G';

/** 无单独名称库时仅展示代码（名称以持仓/接口中的字段为准） */
function getStockDisplayName(ticker: string): string {
  return ticker.trim().toUpperCase();
}

const FINNHUB_EQ_LS_KEY = 'portfolioFinnhubUnderlyingEq';

/** 浏览器本地持仓（JSON） */
const LS_PORTFOLIO_KEY = 'stockPortfolio';

/** 浏览器本地交易记录（JSON 数组） */
const LS_TRADES_KEY = 'stockTrades';

/** Finnhub /symbol/canonical-underlying 推断结果缓存（含「映射为自身」以避免重复请求） */
function loadFinnhubUnderlyingEqCache(): Record<string, string> {
  try {
    const raw = localStorage.getItem(FINNHUB_EQ_LS_KEY);
    if (!raw) return {};
    const o = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(o)) {
      if (typeof k !== 'string' || typeof v !== 'string') continue;
      out[k.trim().toUpperCase()] = v.trim().toUpperCase();
    }
    return out;
  } catch {
    return {};
  }
}

let finnhubUnderlyingEquivalent: Record<string, string> = loadFinnhubUnderlyingEqCache();

function persistFinnhubUnderlyingEqCache(): void {
  localStorage.setItem(FINNHUB_EQ_LS_KEY, JSON.stringify(finnhubUnderlyingEquivalent));
}

/** 收集持仓中出现的原始标的代码（正股一条、期权解析出的标的一条） */
function collectRawTickersForGrouping(): string[] {
  const set = new Set<string>();
  for (const s of state.stocks) {
    const sym = s.symbol.trim().toUpperCase();
    if (s.type === 'option' || isOptionSymbol(sym)) {
      const full = sym.match(/^([A-Z]+)\d{6}[CP]\d+(?:\.\d+)?$/i);
      if (full) set.add(full[1]);
    } else {
      set.add(sym);
    }
  }
  return [...set];
}

/** 请求后端用 Finnhub ETF 持仓推断主标的，并写入缓存（慢路径，带节流） */
async function refreshFinnhubCanonicalEquivalents(): Promise<void> {
  const tickers = collectRawTickersForGrouping();
  let changed = false;
  for (const t of tickers) {
    if (finnhubUnderlyingEquivalent[t] !== undefined) continue;

    try {
      const r = await fetch(`/api/symbol/canonical-underlying/${encodeURIComponent(t)}`);
      if (!r.ok) continue;
      const data = (await r.json()) as { canonical?: string };
      const can = (data.canonical ?? t).toUpperCase();
      const prev = finnhubUnderlyingEquivalent[t];
      finnhubUnderlyingEquivalent[t] = can;
      if (prev !== can) changed = true;
    } catch {
      /* ignore */
    }
    await new Promise<void>(resolve => setTimeout(resolve, 320));
  }
  if (changed) {
    persistFinnhubUnderlyingEqCache();
    calculateTotals();
    render();
  }
}

/** Finnhub ETF 推断链（仅自动分组，不含手动拖拽） */
function resolveCanonicalUnderlying(ticker: string): string {
  let u = ticker.trim().toUpperCase();
  const seen = new Set<string>();
  for (let i = 0; i < 12; i++) {
    if (seen.has(u)) break;
    seen.add(u);
    const inferred = finnhubUnderlyingEquivalent[u];
    if (!inferred || inferred === u) break;
    u = inferred;
  }
  return u;
}

/** 与后端 parseOptionSymbol 一致：标的 + YYMMDD + C/P + 行权价 */
function isOptionSymbol(symbol: string): boolean {
  return /^[A-Z]+\d{6}[CP]\d+(?:\.\d+)?$/i.test(symbol.trim());
}

/** 从标准期权码解析展示字段（与表格期权列一致） */
function parseOptionFieldsFromSymbol(symbol: string): Pick<Stock, 'optionStrike' | 'optionExpiry' | 'optionType'> | undefined {
  const sym = symbol.trim().toUpperCase();
  const m = sym.match(/^([A-Z]+)(\d{2})(\d{2})(\d{2})([CP])(\d+(?:\.\d+)?)$/);
  if (!m) return undefined;
  const [, , yy, mm, dd, cp, strikeStr] = m;
  return {
    optionStrike: parseFloat(strikeStr),
    optionExpiry: `20${yy}-${mm}-${dd}`,
    optionType: cp.toUpperCase() === 'P' ? 'P' : 'C'
  };
}

/** 从本地持仓快照生成首笔买入（仅当尚无交易记录时执行一次） */
function migratePortfolioStocksToTradesIfNeeded(): void {
  if (state.trades.length > 0) return;
  if (state.stocks.length === 0) return;
  const toAdd: TradeRecord[] = [];
  for (const s of state.stocks) {
    if (s.shares <= 0) continue;
    const price =
      s.avgCost !== undefined && Number.isFinite(Number(s.avgCost)) && Number(s.avgCost) > 0
        ? Number(s.avgCost)
        : s.currentPrice > 0
          ? s.currentPrice
          : 0;
    if (price <= 0) continue;
    const shares = s.shares;
    const optMult = isOptionSymbol(s.symbol) ? 100 : 1;
    toAdd.push({
      id: crypto.randomUUID(),
      symbol: s.symbol,
      name: s.name || s.symbol,
      type: 'buy',
      shares,
      price,
      total_amount: shares * price * optMult,
      commission: 0,
      trade_date: new Date().toISOString(),
      created_at: new Date().toISOString()
    });
  }
  if (toAdd.length === 0) return;
  state.trades.push(...toAdd);
  sortTradesByDateDesc(state.trades);
  try {
    localStorage.setItem(LS_TRADES_KEY, JSON.stringify(state.trades));
  } catch (e) {
    console.error('迁移写入交易记录失败:', e);
  }
}

/** 用交易记录 FIFO 汇总持仓；无交易时清空持仓表 */
function syncStocksFromTrades(): void {
  if (state.trades.length === 0) {
    calculateTotals();
    return;
  }
  const prevBySym = new Map(state.stocks.map((s) => [s.symbol, s]));
  const derived = deriveHoldingsFromTrades(state.trades);
  state.stocks = derived.map((d) => {
    const prev = prevBySym.get(d.symbol);
    const isOpt = isOptionSymbol(d.symbol);
    const optFields = isOpt ? parseOptionFieldsFromSymbol(d.symbol) : undefined;
    return {
      symbol: d.symbol,
      name: d.name,
      shares: d.shares,
      avgCost: d.avgCost,
      costLots: d.costLots.map((lot) => ({ shares: lot.shares, costPerShare: lot.costPerShare })),
      currentPrice: prev?.currentPrice ?? 0,
      position: 0,
      weight: 0,
      signal: prev?.signal ?? 'hold',
      targetPrice: prev?.targetPrice,
      groupWith: prev?.groupWith,
      type: isOpt ? 'option' : 'stock',
      instrumentType: prev?.instrumentType,
      optionStrike: prev?.optionStrike ?? optFields?.optionStrike,
      optionExpiry: prev?.optionExpiry ?? optFields?.optionExpiry,
      optionType: prev?.optionType ?? optFields?.optionType
    };
  });
  calculateTotals();
}

/** 从合约/代码得到原始标的 ticker（未合并） */
function extractRawTickerForStock(stock: Stock): string {
  const sym = stock.symbol.trim().toUpperCase();
  if (stock.type === 'option' || isOptionSymbol(sym)) {
    const full = sym.match(/^([A-Z]+)\d{6}[CP]\d+(?:\.\d+)?$/i);
    if (full) return full[1];
    const prefix = sym.match(/^([A-Z]+)/);
    return prefix ? prefix[1] : sym;
  }
  return sym;
}

/** 自动推断的品类主代码（Finnhub + 原始代码） */
function autoGroupKeyForStock(stock: Stock): string {
  return resolveCanonicalUnderlying(extractRawTickerForStock(stock));
}

/** 实际用于表格分组的标的：手动 groupWith 优先 */
function getEffectiveGroupKey(stock: Stock): string {
  const g = stock.groupWith?.trim();
  if (g) return g.toUpperCase();
  return autoGroupKeyForStock(stock);
}

/** 品类分组用（与 getEffectiveGroupKey 一致） */
function getUnderlyingForStock(stock: Stock): string {
  return getEffectiveGroupKey(stock);
}

let dragSourceSymbol: string | null = null;

function mergeStockIntoGroup(draggedSymbol: string, anchorGroupKey: string): void {
  const key = anchorGroupKey.trim().toUpperCase();
  if (!key) return;
  if (draggedSymbol.toUpperCase() === key) return;
  const s = state.stocks.find(x => x.symbol === draggedSymbol);
  if (!s) return;
  s.groupWith = key;
  calculateTotals();
  saveToStorage();
  render();
}

function clearGroupOverride(symbol: string): void {
  const s = state.stocks.find(x => x.symbol === symbol);
  if (!s) return;
  s.groupWith = undefined;
  calculateTotals();
  saveToStorage();
  render();
}

function symbolDragStart(e: DragEvent, symbol: string): void {
  dragSourceSymbol = symbol;
  e.dataTransfer?.setData('text/plain', symbol);
  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
}

function symbolDragOver(e: DragEvent): void {
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
}

function symbolDragEnd(): void {
  dragSourceSymbol = null;
}

function symbolDropOnRow(e: DragEvent, targetSymbol: string): void {
  e.preventDefault();
  e.stopPropagation();
  const src = (e.dataTransfer?.getData('text/plain') || dragSourceSymbol || '').trim();
  if (!src || src === targetSymbol) return;
  const target = state.stocks.find(s => s.symbol === targetSymbol);
  if (!target) return;
  mergeStockIntoGroup(src, getEffectiveGroupKey(target));
}

function positionMultiplier(stock: Stock): number {
  return stock.type === 'option' || isOptionSymbol(stock.symbol) ? 100 : 1;
}

/** 盈亏 = (现价 - 成本) × 股数 × 合约乘数；未填成本返回 null */
function computeLinePnL(stock: Stock): number | null {
  const c = stock.avgCost;
  if (c === undefined || c === null || Number.isNaN(Number(c))) return null;
  return (stock.currentPrice - Number(c)) * stock.shares * positionMultiplier(stock);
}

/** 盈亏比例 = (现价 − 成本) ÷ 成本 × 100%；无有效成本返回 null */
function computeLinePnLPercent(stock: Stock): number | null {
  const c = stock.avgCost;
  if (c === undefined || c === null || Number.isNaN(Number(c)) || Number(c) <= 0) return null;
  return ((stock.currentPrice - Number(c)) / Number(c)) * 100;
}

function formatPnLCell(pnl: number | null): string {
  if (pnl === null || Number.isNaN(pnl)) {
    return '<span style="color:#94a3b8;">—</span>';
  }
  const color = pnl >= 0 ? '#059669' : '#dc2626';
  const sign = pnl >= 0 ? '+' : '';
  return `<span style="color:${color}; font-weight:600;">${sign}$${formatNumber(pnl)}</span>`;
}

function formatPnLPercentCell(pct: number | null): string {
  if (pct === null || Number.isNaN(pct)) {
    return '<span style="color:#94a3b8;">—</span>';
  }
  const color = pct >= 0 ? '#059669' : '#dc2626';
  const sign = pct >= 0 ? '+' : '';
  return `<span style="color:${color}; font-weight:600;">${sign}${formatNumber(pct, 2)}%</span>`;
}

/** 顶部总盈亏卡片（白字卡片上用浅色区分正负） */
function formatTotalPnlSummaryHtml(pnl: number): string {
  const color = pnl >= 0 ? '#ecfdf5' : '#fecaca';
  const sign = pnl >= 0 ? '+' : '';
  return `<span style="color:${color}; font-weight:700;">${sign}$${formatNumber(pnl)}</span>`;
}

function formatTargetInputValue(tp: number | undefined): string {
  if (tp === undefined || tp === null || Number.isNaN(Number(tp))) return '';
  return formatNumber(Number(tp), 2);
}

function formatCostInputValue(c: number | undefined): string {
  if (c === undefined || c === null || Number.isNaN(Number(c))) return '';
  return formatNumber(Number(c), 2);
}

/** 根据 costLots 写回 shares、avgCost；无有效明细则清空 */
function syncStockCostFromLots(stock: Stock): void {
  const raw = stock.costLots ?? [];
  const lots = raw.filter(l => l.shares > 0 && Number.isFinite(l.costPerShare));
  if (lots.length === 0) {
    stock.costLots = undefined;
    stock.shares = 0;
    stock.avgCost = undefined;
    return;
  }
  let sumShares = 0;
  let sumCost = 0;
  for (const l of lots) {
    sumShares += l.shares;
    sumCost += l.shares * l.costPerShare;
  }
  stock.costLots = lots.map(l => ({
    shares: Math.round(l.shares * 100) / 100,
    costPerShare: Math.round(l.costPerShare * 10000) / 10000
  }));
  stock.shares = Math.round(sumShares * 100) / 100;
  stock.avgCost =
    sumShares > 0 ? Math.round((sumCost / sumShares) * 10000) / 10000 : undefined;
}

function formatCostLotsModalRows(lots: CostLot[]): string {
  return lots
    .map(
      (lot, i) => `
    <tr data-lot-index="${i}">
      <td style="padding: 8px;">
        <input type="number" class="lot-shares-input" value="${lot.shares}" step="0.01" min="0"
               style="width: 110px; padding: 8px; border: 1px solid #e5e7eb; border-radius: 8px;" />
      </td>
      <td style="padding: 8px;">
        <input type="number" class="lot-cost-input" value="${lot.costPerShare}" step="0.0001" min="0"
               style="width: 110px; padding: 8px; border: 1px solid #e5e7eb; border-radius: 8px;" />
      </td>
      <td style="padding: 8px;">
        <button type="button" class="lot-remove-btn btn btn-secondary" style="padding: 6px 10px; font-size: 0.8rem;">删除</button>
      </td>
    </tr>`
    )
    .join('');
}

function openCostLotsEditor(symbol: string): void {
  void symbol;
  renderError('成本由买入交易按 FIFO 自动计算，请编辑对应买入记录。');
}

function removeStock(symbol: string): void {
  void symbol;
  renderError('持仓由交易汇总，请使用「卖出」或调整交易记录。');
}

/** 按标的分组排序：先正股后期权，再按代码 */
function compareStocksForTable(a: Stock, b: Stock): number {
  const ua = getUnderlyingForStock(a);
  const ub = getUnderlyingForStock(b);
  if (ua !== ub) return ua.localeCompare(ub);
  const oa = a.type === 'option' || isOptionSymbol(a.symbol) ? 1 : 0;
  const ob = b.type === 'option' || isOptionSymbol(b.symbol) ? 1 : 0;
  if (oa !== ob) return oa - ob;
  return a.symbol.localeCompare(b.symbol);
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeHtmlAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

// 工具函数：格式化数字
function formatNumber(num: number, decimals: number = 2): string {
  return num.toFixed(decimals);
}

/** `<input type="datetime-local" step="60">` 用的本地时间字符串（精确到分钟） */
function formatDatetimeLocalMinute(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** CSV 旧版单列「类型」：期权 / 股票 / Finnhub 证券类型 */
function parseLegacyCsvTypeColumn(combined: string): { isOption: boolean; instrumentType?: string } {
  const raw = combined.trim();
  if (raw === '期权') return { isOption: true };
  if (!raw || raw === '股票') return { isOption: false, instrumentType: undefined };
  return { isOption: false, instrumentType: raw };
}

/** CSV 新版「类型」列（与页面类型列一致：期权 或 证券类型 或 股票） */
function instrumentTypeFromDisplayTypeCol(isOption: boolean, typeCol: string): string | undefined {
  if (isOption) return undefined;
  const t = typeCol.trim();
  if (!t || t === '股票') return undefined;
  return t;
}

// 工具函数：格式化百分比
function formatPercent(num: number): string {
  return `${formatNumber(num, 2)}%`;
}

// 工具函数：渲染错误信息
function renderError(message: string): void {
  const errorDiv = document.createElement('div');
  errorDiv.className = 'error';
  errorDiv.textContent = message;
  
  const existingError = document.querySelector('.error');
  if (existingError) {
    existingError.remove();
  }
  
  const card = document.querySelector('.card');
  if (card) {
    card.appendChild(errorDiv);
    
    setTimeout(() => {
      errorDiv.remove();
    }, 5000);
  }
}

// 工具函数：显示成功消息
function renderSuccess(message: string): void {
  const successDiv = document.createElement('div');
  successDiv.className = 'success';
  successDiv.textContent = message;
  
  const existingSuccess = document.querySelector('.success');
  if (existingSuccess) {
    existingSuccess.remove();
  }
  
  const card = document.querySelector('.card');
  if (card) {
    card.appendChild(successDiv);
    
    setTimeout(() => {
      successDiv.remove();
    }, 3000);
  }
}

// ========== 交易 UI 函数 ==========

// 打开交易表单（从持仓行打开：代码/名称只读）
function openTradeForm(symbol: string, name: string, type: 'buy' | 'sell'): void {
  tradeFormFreeEntry = false;
  tradeFormSymbol = symbol.trim().toUpperCase();
  tradeFormName = name;
  tradeFormType = type;
  tradePanelOpen = true;
  render();
}

/** 新增交易：可编辑代码；若顶部搜索框有内容会预填代码；保存时名称与代码一致 */
function openNewTradeForm(type: 'buy' | 'sell'): void {
  const inp = document.getElementById('symbol') as HTMLInputElement | null;
  const raw = (inp?.value ?? '').trim().toUpperCase();
  tradeFormFreeEntry = true;
  tradeFormSymbol = raw;
  tradeFormName = '';
  tradeFormType = type;
  tradePanelOpen = true;
  render();
}

// 关闭交易表单
function closeTradeForm(): void {
  tradePanelOpen = false;
  tradeFormFreeEntry = false;
  render();
}

// 打开编辑交易弹窗
function openEditTradeModal(trade: TradeRecord): void {
  editingTrade = trade;
  editTradeModalOpen = true;
  render();
}

// 关闭编辑交易弹窗
function closeEditTradeModal(): void {
  editTradeModalOpen = false;
  editingTrade = null;
  render();
}

// 提交编辑交易
function submitEditTrade(): void {
  if (!editingTrade) return;
  
  const sharesEl = document.getElementById('edit-trade-shares') as HTMLInputElement | null;
  const priceEl = document.getElementById('edit-trade-price') as HTMLInputElement | null;
  const commissionEl = document.getElementById('edit-trade-commission') as HTMLInputElement | null;
  const dateEl = document.getElementById('edit-trade-date') as HTMLInputElement | null;
  
  const shares = parseFloat(sharesEl?.value || '0');
  const price = parseFloat(priceEl?.value || '0');
  const commission = parseFloat(commissionEl?.value || '0');
  const rawDt = (dateEl?.value ?? '').trim();
  let tradeAtIso: string | undefined;
  if (rawDt) {
    const tradeAt = new Date(rawDt);
    if (Number.isNaN(tradeAt.getTime())) {
      renderError('交易时间无效');
      return;
    }
    if (tradeAt.getTime() > Date.now()) {
      renderError('交易时间不能晚于当前时刻');
      return;
    }
    tradeAtIso = tradeAt.toISOString();
  }

  if (shares <= 0 || price <= 0) {
    renderError('股数和价格必须大于 0');
    return;
  }

  const success = updateTradeRecord(editingTrade.id, {
    shares,
    price,
    commission,
    trade_date: tradeAtIso
  });
  
  if (success) {
    loadPnlStatsOnStartup();
    renderSuccess('交易记录已更新');
    closeEditTradeModal();
    render();
  } else {
    renderError('更新失败：未找到该笔交易');
  }
}

// 提交交易
function submitTrade(): void {
  const sharesEl = document.getElementById('trade-shares') as HTMLInputElement | null;
  const priceEl = document.getElementById('trade-price') as HTMLInputElement | null;
  const commissionEl = document.getElementById('trade-commission') as HTMLInputElement | null;
  const dateEl = document.getElementById('trade-date') as HTMLInputElement | null;
  
  const shares = parseFloat(sharesEl?.value || '0');
  const price = parseFloat(priceEl?.value || '0');
  const commission = parseFloat(commissionEl?.value || '0');
  const rawDt = (dateEl?.value ?? '').trim();
  let tradeAt: Date;
  if (!rawDt) {
    tradeAt = new Date();
  } else {
    tradeAt = new Date(rawDt);
    if (Number.isNaN(tradeAt.getTime())) {
      renderError('交易时间无效');
      return;
    }
    if (tradeAt.getTime() > Date.now()) {
      renderError('交易时间不能晚于当前时刻');
      return;
    }
  }

  let sym = tradeFormSymbol.trim().toUpperCase();
  let trName: string;
  if (tradeFormFreeEntry) {
    const symIn = document.getElementById('trade-symbol-input') as HTMLInputElement | null;
    sym = (symIn?.value ?? '').trim().toUpperCase();
    trName = '';
  } else {
    trName = tradeFormName.trim();
  }

  if (!sym) {
    renderError('请填写标的代码');
    return;
  }
  if (!trName) trName = sym;
  
  if (shares <= 0 || price <= 0) {
    renderError('股数和价格必须大于 0');
    return;
  }
  
  const success = addTradeRecord({
    symbol: sym,
    name: trName,
    type: tradeFormType,
    shares,
    price,
    commission,
    trade_date: tradeAt.toISOString()
  });
  
  if (success) {
    loadPnlStatsOnStartup();
    renderSuccess(`${tradeFormType === 'buy' ? '买入' : '卖出'}成功：${shares} 股 ${sym} @ $${price}`);
    closeTradeForm();
    render();
  }
}

// 切换交易类型
function setTradeType(type: 'buy' | 'sell'): void {
  tradeFormType = type;
  render();
}

// 删除交易记录
function handleDeleteTrade(tradeId: string, symbol: string): void {
  if (!confirm(`确定删除这笔 ${symbol} 的交易记录吗？`)) return;
  
  if (deleteTradeRecord(tradeId)) {
    loadPnlStatsOnStartup();
    renderSuccess('交易记录已删除');
    render();
  }
}

// 刷新单个股票/期权价格
async function refreshSingleStock(symbol: string): Promise<void> {
  const stock = state.stocks.find(s => s.symbol === symbol);
  if (!stock) return;

  // 找到刷新按钮并显示加载状态（按钮紧跟在 price span 之后）
  const priceSpan = document.getElementById(`price-${symbol}`);
  const btn = priceSpan?.nextElementSibling as HTMLButtonElement | null;
  if (btn) {
    btn.textContent = '⏳';
    btn.disabled = true;
  }

  try {
    let price = 0;
    let change = 0;

    if (stock.type === 'option' || isOptionSymbol(symbol)) {
      // 期权走 /api/option/:symbol（旧数据可能缺少 type）
      const response = await fetch(`/api/option/${encodeURIComponent(symbol)}`);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json();
      price = (data.price as number) ?? 0;
      change = (data.change as number) ?? 0;
    } else {
      const data = await fetchStockDataFromAPI(symbol);
      price = data.price;
      change = data.change;
    }

    state.stocks = state.stocks.map(s => {
      if (s.symbol === symbol) {
        return {
          ...s,
          currentPrice: price,
          position: s.shares * price * positionMultiplier(s)
        };
      }
      return s;
    });

    calculateTotals();
    saveToStorage();
    render();

  } catch (error) {
    console.error(`刷新 ${symbol} 数据失败:`, error);
    renderError(`刷新 ${symbol} 失败`);
    render();
  }
}

// 函数：从后端 API 获取股票数据 (Finnhub)
async function fetchStockDataFromAPI(symbol: string): Promise<StockData> {
  try {
    const response = await fetch(`/api/stock/${encodeURIComponent(symbol)}`);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    const data: StockData = await response.json();
    return data;
  } catch (error) {
    console.error('获取股票数据失败:', error);
    throw error;
  }
}

// 单条持仓拉取行情（股票走 Finnhub，期权走 Polygon）
async function fetchQuoteForStock(stock: Stock): Promise<StockData> {
  const isOption = stock.type === 'option' || isOptionSymbol(stock.symbol);
  if (isOption) {
    const response = await fetch(`/api/option/${encodeURIComponent(stock.symbol)}`);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const data = (await response.json()) as StockData;
    return data;
  }
  return fetchStockDataFromAPI(stock.symbol);
}

// 函数：批量获取股票/期权数据
async function fetchBatchStockData(stocks: Stock[]): Promise<StockData[]> {
  const results: StockData[] = [];

  for (const stock of stocks) {
    try {
      const data = await fetchQuoteForStock(stock);
      results.push(data);
      // 添加延迟以遵守 API rate limit
      await new Promise(resolve => setTimeout(resolve, 1000));
    } catch (error) {
      console.error(`获取 ${stock.symbol} 数据失败:`, error);
      results.push({
        symbol: stock.symbol.toUpperCase(),
        name: getStockDisplayName(stock.symbol),
        price: 0,
        change: 0,
        changePercent: 0
      });
    }
  }

  return results;
}

// 函数：计算总计
function calculateTotals(): void {
  let stockMv = 0;
  let optionMv = 0;
  let pnlSum = 0;
  let pnlRowCount = 0;

  for (const stock of state.stocks) {
    const line = stock.shares * stock.currentPrice * positionMultiplier(stock);
    if (stock.type === 'option' || isOptionSymbol(stock.symbol)) {
      optionMv += line;
    } else {
      stockMv += line;
    }
    const pnl = computeLinePnL(stock);
    if (pnl !== null && !Number.isNaN(pnl)) {
      pnlSum += pnl;
      pnlRowCount += 1;
    }
  }

  const stocksValue = stockMv + optionMv;
  const totalAssets = stocksValue + state.cash;
  state.stockMarketValue = stockMv;
  state.optionMarketValue = optionMv;
  state.totalValue = stocksValue;
  state.totalPnl = pnlRowCount > 0 ? pnlSum : null;

  const groupSum = new Map<string, number>();
  for (const stock of state.stocks) {
    const u = getUnderlyingForStock(stock);
    const line = stock.shares * stock.currentPrice * positionMultiplier(stock);
    groupSum.set(u, (groupSum.get(u) ?? 0) + line);
  }

  state.stocks = state.stocks.map(stock => {
    const position = stock.shares * stock.currentPrice * positionMultiplier(stock);
    const u = getUnderlyingForStock(stock);
    const groupPosition = groupSum.get(u) ?? position;
    const weight = totalAssets > 0 ? (groupPosition / totalAssets) * 100 : 0;
    return {
      ...stock,
      position,
      weight
    };
  });
}

function buildPortfolioPayload(): {
  stocks: Array<{
    symbol: string;
    name: string;
    shares: number;
    targetPrice?: number;
    avgCost?: number;
    signal?: TradeSignal;
    groupWith?: string;
    currentPrice: number;
    type?: 'stock' | 'option';
    optionStrike?: number;
    optionExpiry?: string;
    optionType?: 'C' | 'P';
    instrumentType?: string;
    costLots?: CostLot[];
  }>;
  cash: number;
} {
  return {
    stocks: state.stocks.map(s => ({
      symbol: s.symbol,
      name: s.name,
      shares: s.shares,
      targetPrice: s.targetPrice,
      avgCost: s.avgCost,
      signal: s.signal,
      groupWith: s.groupWith,
      currentPrice: s.currentPrice,
      type: s.type,
      optionStrike: s.optionStrike,
      optionExpiry: s.optionExpiry,
      optionType: s.optionType,
      instrumentType: s.instrumentType,
      costLots: s.costLots
    })),
    cash: state.cash
  };
}

let persistDebounceId: ReturnType<typeof setTimeout> | null = null;
const PERSIST_DEBOUNCE_MS = 400;

function sortTradesByDateDesc(trades: TradeRecord[]): void {
  trades.sort((a, b) => new Date(b.trade_date).getTime() - new Date(a.trade_date).getTime());
}

function flushPersistToLocal(): void {
  if (persistDebounceId !== null) {
    clearTimeout(persistDebounceId);
    persistDebounceId = null;
  }
  try {
    localStorage.setItem(LS_PORTFOLIO_KEY, JSON.stringify(buildPortfolioPayload()));
    localStorage.setItem(LS_TRADES_KEY, JSON.stringify(state.trades));
  } catch (e) {
    console.error('写入本地存储失败:', e);
  }
}

/** 防抖写入本地存储（持仓 + 交易记录） */
function saveToStorage(): void {
  if (persistDebounceId !== null) clearTimeout(persistDebounceId);
  persistDebounceId = setTimeout(() => {
    persistDebounceId = null;
    flushPersistToLocal();
  }, PERSIST_DEBOUNCE_MS);
}

function applyPortfolioFromParsed(parsed: { stocks: unknown; cash?: unknown }): void {
  if (!Array.isArray(parsed.stocks)) return;
  state.stocks = parsed.stocks.map((s: Record<string, unknown>) => {
    const sym = String(s.symbol ?? '').toUpperCase();
    const inferredOption = isOptionSymbol(sym);
    return {
      ...(s as unknown as Stock),
      symbol: sym,
      type: (s.type as Stock['type']) ?? (inferredOption ? 'option' : 'stock'),
      position: 0,
      weight: 0
    };
  });
  const c = parsed.cash;
  state.cash = typeof c === 'number' && Number.isFinite(c) ? c : 0;
  calculateTotals();
}

function loadPersistedPortfolio(): void {
  try {
    const raw = localStorage.getItem(LS_PORTFOLIO_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as { stocks?: unknown; cash?: unknown };
    const stocksArr = Array.isArray(parsed.stocks) ? parsed.stocks : [];
    const cashNum = typeof parsed.cash === 'number' && Number.isFinite(parsed.cash) ? parsed.cash : 0;
    if (stocksArr.length === 0 && cashNum === 0) return;
    applyPortfolioFromParsed({ stocks: stocksArr, cash: cashNum });
  } catch (e) {
    console.error('读取本地持仓失败:', e);
  }
}

function parseTradesFromLocalStorage(raw: string | null): TradeRecord[] {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw) as unknown;
    if (!Array.isArray(arr)) return [];
    const out: TradeRecord[] = [];
    for (const item of arr) {
      if (!item || typeof item !== 'object') continue;
      const o = item as Record<string, unknown>;
      const id = String(o.id ?? '');
      const symbol = String(o.symbol ?? '').trim().toUpperCase();
      if (!symbol) continue;
      const shares = Number(o.shares);
      const price = Number(o.price);
      if (!Number.isFinite(shares) || !Number.isFinite(price) || shares <= 0 || price <= 0) continue;
      const totalRaw = Number(o.total_amount);
      const commissionRaw = Number(o.commission);
      out.push({
        id: id || crypto.randomUUID(),
        symbol,
        name: String(o.name ?? ''),
        type: o.type === 'sell' ? 'sell' : 'buy',
        shares,
        price,
        total_amount:
          Number.isFinite(totalRaw) && totalRaw > 0
            ? totalRaw
            : shares * price * (isOptionSymbol(symbol) ? 100 : 1),
        commission: Number.isFinite(commissionRaw) ? commissionRaw : 0,
        trade_date: String(o.trade_date ?? new Date().toISOString()),
        created_at: String(o.created_at ?? new Date().toISOString())
      });
    }
    sortTradesByDateDesc(out);
    return out;
  } catch {
    return [];
  }
}

function loadPersistedTrades(): void {
  state.trades = parseTradesFromLocalStorage(localStorage.getItem(LS_TRADES_KEY));
}

// ========== 交易记录（本地存储） ==========

/** 单笔交易对现金的净变动：买入付出本金+手续费；卖出收回本金−手续费 */
function cashDeltaForTrade(trade: Pick<TradeRecord, 'type' | 'total_amount' | 'commission'>): number {
  const fee = Number(trade.commission) || 0;
  const notional = trade.total_amount;
  if (trade.type === 'buy') return -(notional + fee);
  return notional - fee;
}

function addTradeRecord(trade: {
  symbol: string;
  name: string;
  type: 'buy' | 'sell';
  shares: number;
  price: number;
  commission?: number;
  trade_date?: string;
}): boolean {
  const shares = trade.shares;
  const price = trade.price;
  if (shares <= 0 || price <= 0) return false;
  const optMult = isOptionSymbol(trade.symbol) ? 100 : 1;
  const total_amount = shares * price * optMult;
  const row: TradeRecord = {
    id: crypto.randomUUID(),
    symbol: trade.symbol.trim().toUpperCase(),
    name: trade.name,
    type: trade.type,
    shares,
    price,
    total_amount,
    commission: trade.commission ?? 0,
    trade_date: trade.trade_date ?? new Date().toISOString(),
    created_at: new Date().toISOString()
  };
  state.cash += cashDeltaForTrade(row);
  state.trades.push(row);
  sortTradesByDateDesc(state.trades);
  flushPersistToLocal();
  syncStocksFromTrades();
  return true;
}

function deleteTradeRecord(tradeId: string): boolean {
  const removed = state.trades.find((t) => t.id === tradeId);
  if (!removed) return false;
  state.cash -= cashDeltaForTrade(removed);
  state.trades = state.trades.filter((t) => t.id !== tradeId);
  flushPersistToLocal();
  if (state.trades.length === 0) {
    state.stocks = [];
    calculateTotals();
  } else {
    syncStocksFromTrades();
  }
  return true;
}

function updateTradeRecord(
  tradeId: string,
  updates: { shares?: number; price?: number; commission?: number; trade_date?: string }
): boolean {
  const t = state.trades.find((x) => x.id === tradeId);
  if (!t) return false;
  const oldSnap: Pick<TradeRecord, 'type' | 'total_amount' | 'commission'> = {
    type: t.type,
    total_amount: t.total_amount,
    commission: t.commission
  };
  if (updates.shares !== undefined) {
    if (updates.shares <= 0) return false;
    t.shares = updates.shares;
  }
  if (updates.price !== undefined) {
    if (updates.price <= 0) return false;
    t.price = updates.price;
  }
  if (updates.commission !== undefined) {
    if (updates.commission < 0) return false;
    t.commission = updates.commission;
  }
  if (updates.trade_date !== undefined) {
    t.trade_date = updates.trade_date;
  }
  t.total_amount = t.shares * t.price * (isOptionSymbol(t.symbol) ? 100 : 1);
  state.cash += cashDeltaForTrade(t) - cashDeltaForTrade(oldSnap);
  sortTradesByDateDesc(state.trades);
  flushPersistToLocal();
  syncStocksFromTrades();
  return true;
}

// 导出交易记录为 CSV
function exportTradesToCSV(): void {
  if (state.trades.length === 0) {
    renderError('没有交易记录可导出');
    return;
  }
  
  const headers = ['时间', '类型', '代码', '名称', '股数', '价格', '金额', '手续费'];
  const rows = state.trades.map(trade => [
    new Date(trade.trade_date).toLocaleString('zh-CN'),
    trade.type === 'buy' ? '买入' : '卖出',
    trade.symbol,
    trade.name,
    trade.shares.toString(),
    trade.price.toString(),
    trade.total_amount.toString(),
    trade.commission.toString()
  ]);
  
  const csvContent = [headers, ...rows]
    .map(row => row.map(cell => `"${cell}"`).join(','))
    .join('\n');
  
  const BOM = '\uFEFF'; // UTF-8 BOM
  const blob = new Blob([BOM + csvContent], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `交易记录_${new Date().toISOString().split('T')[0]}.csv`;
  link.click();
  URL.revokeObjectURL(url);
  
  renderSuccess('交易记录已导出');
}

// 导出交易记录为 JSON
function exportTradesToJSON(): void {
  if (state.trades.length === 0) {
    renderError('没有交易记录可导出');
    return;
  }
  
  const exportData = state.trades.map(trade => ({
    symbol: trade.symbol,
    name: trade.name,
    type: trade.type === 'buy' ? '买入' : '卖出',
    shares: trade.shares,
    price: trade.price,
    commission: trade.commission,
    trade_date: trade.trade_date
  }));
  
  const jsonContent = JSON.stringify(exportData, null, 2);
  const blob = new Blob([jsonContent], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `交易记录_${new Date().toISOString().split('T')[0]}.json`;
  link.click();
  URL.revokeObjectURL(url);
  
  renderSuccess('交易记录已导出');
}

// 打开导入弹窗
function openImportTradeModal(): void {
  importTradeModalOpen = true;
  importPreviewData = [];
  importError = null;
  render();
}

// 关闭导入弹窗
function closeImportTradeModal(): void {
  importTradeModalOpen = false;
  importPreviewData = [];
  importError = null;
  render();
}

function readXlsxArrayBuffer(
  file: File,
  input: HTMLInputElement,
  parser: (buf: ArrayBuffer) => Promise<TradeRecord[]>,
  emptyMessage: string
): void {
  const reader = new FileReader();
  reader.onload = (e) => {
    void (async () => {
      try {
        const buf = e.target?.result;
        if (!(buf instanceof ArrayBuffer)) {
          importError = '无法读取表格文件';
          importPreviewData = [];
          input.value = '';
          render();
          return;
        }
        importPreviewData = await parser(buf);
        importError = importPreviewData.length === 0 ? emptyMessage : null;
      } catch (err) {
        importError = `解析 Excel 失败: ${(err as Error).message}`;
        importPreviewData = [];
      }
      input.value = '';
      render();
    })();
  };
  reader.readAsArrayBuffer(file);
}

/** Moomoo：历史 / 现金账户 xlsx */
function handleMoomooTradeImport(event: Event): void {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  readXlsxArrayBuffer(file, input, async (buf) =>
    (await parseMoomooXlsxArrayBuffer(buf)) as TradeRecord[]
  , '未解析到有效记录：请确认 xlsx 为 Moomoo 历史导出，且表头含方向、代码、交易状态、成交金额等（仅导入「全部成交」）');
}

/** BBAE：股票 / 期权订单 xlsx */
function handleBbaeTradeImport(event: Event): void {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  readXlsxArrayBuffer(file, input, async (buf) =>
    (await parseBbaeXlsxArrayBuffer(buf)) as TradeRecord[]
  , '未解析到有效记录：请确认 xlsx 为 BBAE 订单导出（工作表含「股票代码」或「期权代码」，订单状态为「已成」）');
}

/** 本应用导出的交易 CSV / JSON */
function handleTradeBackupImport(event: Event): void {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  const reader = new FileReader();
  reader.onload = (e) => {
    const content = e.target?.result as string;
    try {
      if (ext === 'csv') {
        importPreviewData = parseTradeImportLegacyCsv(content) as TradeRecord[];
      } else if (ext === 'json') {
        importPreviewData = parseJSON(content);
      } else {
        importError = '请上传本应用导出的 .csv 或 .json';
        importPreviewData = [];
        input.value = '';
        render();
        return;
      }
      importError =
        importPreviewData.length === 0
          ? '文件中无有效交易记录（需为本应用「导出交易」的 CSV/JSON）'
          : null;
    } catch (err) {
      importError = `解析失败: ${(err as Error).message}`;
      importPreviewData = [];
    }
    input.value = '';
    render();
  };
  reader.readAsText(file);
}

// 解析 JSON
function parseJSON(content: string): TradeRecord[] {
  const data = JSON.parse(content);
  const arr = Array.isArray(data) ? data : data.trades || [];
  
  return arr.map((item: Record<string, unknown>, index: number) => {
    const type = (item.type as string);
    const shares = parseFloat(String(item.shares || 0));
    const price = parseFloat(String(item.price || 0));
    const symbolU = String(item.symbol || item.code || '').toUpperCase();
    let totalAmt = parseFloat(String(item.total_amount || item.amount || ''));
    if (!Number.isFinite(totalAmt) || totalAmt <= 0) {
      totalAmt = shares * price * (isOptionSymbol(symbolU) ? 100 : 1);
    }

    return {
      id: `import-${index}-${Date.now()}`,
      symbol: symbolU,
      name: String(item.name || item.stockName || ''),
      type: (type === '买入' || type === 'buy' || type === 'BUY') ? 'buy' as const : 'sell' as const,
      shares,
      price,
      total_amount: totalAmt,
      commission: parseFloat(String(item.commission || item.fee || 0)),
      trade_date: item.trade_date ? new Date(item.trade_date as string).toISOString() : new Date().toISOString(),
      created_at: new Date().toISOString()
    };
  }).filter((t: TradeRecord) => t.symbol && t.shares > 0 && t.price > 0);
}

// 确认导入
function confirmImportTrades(): void {
  if (importPreviewData.length === 0) {
    renderError('没有可导入的交易记录');
    return;
  }

  let failCount = 0;
  for (const trade of importPreviewData) {
    const shares = trade.shares;
    const price = trade.price;
    if (shares <= 0 || price <= 0 || !trade.symbol) {
      failCount++;
      continue;
    }
    const optMult = isOptionSymbol(trade.symbol) ? 100 : 1;
    const total =
      trade.total_amount > 0 ? trade.total_amount : shares * price * optMult;
    const row: TradeRecord = {
      id: crypto.randomUUID(),
      symbol: trade.symbol.trim().toUpperCase(),
      name: trade.name,
      type: trade.type,
      shares,
      price,
      total_amount: total,
      commission: trade.commission ?? 0,
      trade_date: trade.trade_date,
      created_at: new Date().toISOString()
    };
    state.cash += cashDeltaForTrade(row);
    state.trades.push(row);
  }
  sortTradesByDateDesc(state.trades);
  flushPersistToLocal();
  syncStocksFromTrades();
  loadPnlStatsOnStartup();

  const successCount = importPreviewData.length - failCount;
  closeImportTradeModal();
  render();

  if (failCount === 0) {
    renderSuccess(`成功导入 ${successCount} 笔交易记录`);
  } else {
    renderError(`导入完成：成功 ${successCount} 笔，失败 ${failCount} 笔`);
  }
}

function loadPnlStatsOnStartup(): void {
  state.pnlStats = computeProfitLoss(state.trades, {
    startDate: state.pnlStartDate || undefined,
    endDate: state.pnlEndDate || undefined
  });
}

function setPnlQueryStartDate(value: string): void {
  state.pnlStartDate = value;
}

function setPnlQueryEndDate(value: string): void {
  state.pnlEndDate = value;
}

/** 清空盈亏查询时间段，按全部交易日重算 */
function resetPnlQuery(): void {
  state.pnlStartDate = '';
  state.pnlEndDate = '';
  loadPnlStatsOnStartup();
  render();
}

// 刷新盈亏统计
function refreshPnlStats(): void {
  const sEl = document.getElementById('pnl-start-date') as HTMLInputElement | null;
  const eEl = document.getElementById('pnl-end-date') as HTMLInputElement | null;
  if (sEl) state.pnlStartDate = sEl.value;
  if (eEl) state.pnlEndDate = eEl.value;
  loadPnlStatsOnStartup();
  render();
}

function exportToJSON(): void {
  const exportData: ExportData = {
    version: '1.1',
    exportDate: new Date().toISOString(),
    cash: state.cash,
    trades: state.trades,
    stocks: state.stocks.map(s => ({
      symbol: s.symbol,
      name: s.name,
      shares: s.shares,
      targetPrice: s.targetPrice,
      avgCost: s.avgCost,
      signal: s.signal,
      currentPrice: s.currentPrice,
      position: s.position,
      weight: s.weight,
      type: s.type,
      optionStrike: s.optionStrike,
      optionExpiry: s.optionExpiry,
      optionType: s.optionType,
      groupWith: s.groupWith,
      instrumentType: s.instrumentType,
      costLots: s.costLots
    }))
  };
  
  const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `portfolio_${new Date().toISOString().slice(0,10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
  renderSuccess('数据已导出为 JSON 文件');
}

// 导出数据为 CSV 文件
function exportToCSV(): void {
  const headers = [
    '代码',
    '名称',
    '品种',
    '类型',
    '股数',
    '成本',
    '现价',
    '盈亏',
    '盈亏比例',
    '持仓',
    '品类占组合%',
    '1y目标价',
    '期权执行价',
    '期权到期日',
    '期权类型',
    '评级',
    '合并至品类'
  ];
  const totalA = state.totalValue + state.cash;
  const cashW = totalA > 0 ? (state.cash / totalA) * 100 : 0;
  const rows = state.stocks.map(s => {
    const pnl = computeLinePnL(s);
    const pnlPct = computeLinePnLPercent(s);
    const category = s.type === 'option' ? '期权' : '股票';
    const displayType = s.type === 'option' ? '期权' : (s.instrumentType ?? '股票');
    return [
      s.symbol,
      s.name,
      category,
      displayType,
      s.shares,
      s.avgCost ?? '',
      s.currentPrice,
      pnl === null ? '' : pnl,
      pnlPct === null ? '' : formatNumber(pnlPct, 2),
      s.position,
      s.weight,
      s.targetPrice ?? '',
      s.optionStrike ?? '',
      s.optionExpiry ?? '',
      s.optionType ?? '',
      s.signal === 'buy' ? '买入' : s.signal === 'sell' ? '卖出' : '持有',
      s.groupWith ?? ''
    ];
  });

  /** 17 列：持仓列存现金金额，品类占比列为现金占总资产比例 */
  const cashCsvRow: (string | number)[] = [
    'CASH',
    '现金',
    '现金',
    '现金',
    '',
    '',
    '',
    '',
    '',
    state.cash,
    formatNumber(cashW, 2),
    '',
    '',
    '',
    '',
    '',
    ''
  ];

  const csvContent = [
    headers.join(','),
    ...rows.map(r => r.map(cell => `"${cell}"`).join(',')),
    cashCsvRow.map(cell => `"${cell}"`).join(',')
  ].join('\n');
  
  const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `portfolio_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  renderSuccess('数据已导出为 CSV 文件');
}

// 从备份 JSON 恢复交易记录
function normalizeImportedTrades(arr: unknown[]): TradeRecord[] {
  const out: TradeRecord[] = [];
  for (const item of arr) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const id = String(o.id ?? crypto.randomUUID());
    const symbol = String(o.symbol ?? '').trim().toUpperCase();
    if (!symbol) continue;
    const shares = Number(o.shares);
    const price = Number(o.price);
    if (!Number.isFinite(shares) || !Number.isFinite(price) || shares <= 0 || price <= 0) continue;
    const typ = o.type === 'sell' || o.type === '卖出' ? 'sell' : 'buy';
    const commission = Number.isFinite(Number(o.commission)) ? Number(o.commission) : 0;
    const totalRaw = Number(o.total_amount);
    out.push({
      id,
      symbol,
      name: String(o.name ?? symbol),
      type: typ,
      shares,
      price,
      total_amount:
        Number.isFinite(totalRaw) && totalRaw > 0
          ? totalRaw
          : shares * price * (isOptionSymbol(symbol) ? 100 : 1),
      commission,
      trade_date: String(o.trade_date ?? new Date().toISOString()),
      created_at: String(o.created_at ?? new Date().toISOString())
    });
  }
  return out;
}

// 从 JSON 文件导入
function importFromJSON(event: Event): void {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const content = e.target?.result as string;
      const data = JSON.parse(content) as ExportData & { trades?: unknown[] };
      
      if (Array.isArray(data.trades) && data.trades.length > 0) {
        state.trades = normalizeImportedTrades(data.trades as unknown[]);
        state.cash = typeof data.cash === 'number' && Number.isFinite(data.cash) ? data.cash : 0;
        sortTradesByDateDesc(state.trades);
        try {
          localStorage.setItem(LS_TRADES_KEY, JSON.stringify(state.trades));
        } catch (err) {
          console.error(err);
        }
        syncStocksFromTrades();
        saveToStorage();
        loadPnlStatsOnStartup();
        render();
        void refreshFinnhubCanonicalEquivalents();
        if (state.stocks.length > 0) {
          setTimeout(() => updateStockPrices(), 500);
        }
        renderSuccess(`已导入 ${state.trades.length} 笔交易，持仓已同步`);
        return;
      }

      if (data.stocks && Array.isArray(data.stocks)) {
        state.stocks = data.stocks.map(s => {
          const sym = s.symbol.toUpperCase();
          const opt = s.type === 'option' || isOptionSymbol(sym);
          return {
            ...s,
            symbol: sym,
            type: s.type ?? (isOptionSymbol(sym) ? 'option' : 'stock'),
            position: s.shares * s.currentPrice * (opt ? 100 : 1),
            weight: 0
          };
        });
        state.cash = data.cash || 0;
        calculateTotals();
        saveToStorage();
        migratePortfolioStocksToTradesIfNeeded();
        syncStocksFromTrades();
        loadPnlStatsOnStartup();
        render();

        void refreshFinnhubCanonicalEquivalents();

        if (state.stocks.length > 0) {
          setTimeout(() => updateStockPrices(), 500);
        }

        renderSuccess(`成功导入持仓；已按需生成交易草稿并汇总`);
      } else {
        renderError('无效的数据格式');
      }
    } catch {
      renderError('导入失败：文件格式错误');
    }
  };
  reader.readAsText(file);

  input.value = '';
}

// 从 CSV 文件导入
function importFromCSV(event: Event): void {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const content = e.target?.result as string;
      const lines = content.split('\n').filter(line => line.trim());
      
      if (lines.length < 2) {
        renderError('CSV 文件内容为空或格式错误');
        return;
      }
      
      // 跳过标题行，解析数据（新版 CSV 含「品种」+「类型」，旧版仅一列「类型」）
      const newStocks: Stock[] = [];
      let cashFromCsv: number | null = null;
      const hasPinZhong = lines[0].includes('品种');
      const hasPnlPctCol = lines[0].includes('盈亏比例');
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        const values: string[] = [];
        let current = '';
        let inQuotes = false;

        for (const char of line) {
          if (char === '"') {
            inQuotes = !inQuotes;
          } else if (char === ',' && !inQuotes) {
            values.push(current.trim());
            current = '';
          } else {
            current += char;
          }
        }
        values.push(current.trim());

        const code = values[0] ?? '';
        if (code.includes('现金') || code.toUpperCase() === 'CASH') {
          let cashIdx = 7;
          if (hasPinZhong) cashIdx = hasPnlPctCol ? 9 : 8;
          else if (hasPnlPctCol) cashIdx = 8;
          const raw = String(values[cashIdx] ?? '').replace(/,/g, '');
          const v = parseFloat(raw);
          if (Number.isFinite(v)) cashFromCsv = v;
          continue;
        }

        const shareIdx = hasPinZhong ? 4 : 3;
        if (!values[0] || values[shareIdx] === undefined || values[shareIdx] === '') {
          continue;
        }

        const pinOff = hasPnlPctCol ? 1 : 0;
        if (hasPinZhong && values.length >= 16 + pinOff) {
          const category = (values[2] || '').trim();
          const typeDisp = (values[3] || '').trim();
          const isOption = category === '期权';
          const instrumentType = instrumentTypeFromDisplayTypeCol(isOption, typeDisp);
          const sigText = (values[14 + pinOff] || '持有').trim();
          const signal: TradeSignal =
            sigText === '买入' ? 'buy' : sigText === '卖出' ? 'sell' : 'hold';
          const tpRaw = values[10 + pinOff]?.trim() ?? '';
          const gwRaw = (values[15 + pinOff] || '').trim();
          newStocks.push({
            symbol: values[0].toUpperCase(),
            name: values[1] || getStockDisplayName(values[0]),
            type: isOption ? 'option' : 'stock',
            instrumentType,
            shares: parseFloat(values[4]) || 0,
            avgCost:
              values[5] !== '' && values[5] !== undefined
                ? (() => {
                    const n = parseFloat(values[5]);
                    return Number.isFinite(n) ? Math.round(n * 100) / 100 : undefined;
                  })()
                : undefined,
            currentPrice: parseFloat(values[6]) || 0,
            position: parseFloat(values[8 + pinOff]) || 0,
            weight: 0,
            targetPrice:
              tpRaw === ''
                ? undefined
                : (() => {
                    const n = parseFloat(tpRaw);
                    return Number.isFinite(n) ? Math.round(n * 100) / 100 : undefined;
                  })(),
            optionStrike: values[11 + pinOff] ? parseFloat(values[11 + pinOff]) : undefined,
            optionExpiry: values[12 + pinOff] || undefined,
            optionType: (values[13 + pinOff] as 'C' | 'P') || undefined,
            signal,
            groupWith: gwRaw === '' ? undefined : gwRaw.toUpperCase()
          });
        } else if (!hasPinZhong && values.length >= 13 + pinOff) {
          const { isOption, instrumentType } = parseLegacyCsvTypeColumn(values[2] || '');
          const sigText = (values[13 + pinOff] || '持有').trim();
          const signal: TradeSignal =
            sigText === '买入' ? 'buy' : sigText === '卖出' ? 'sell' : 'hold';
          const tpRaw = values[9 + pinOff]?.trim() ?? '';
          const gwRaw = values.length >= 15 + pinOff ? (values[14 + pinOff] || '').trim() : '';
          newStocks.push({
            symbol: values[0].toUpperCase(),
            name: values[1] || getStockDisplayName(values[0]),
            type: isOption ? 'option' : 'stock',
            instrumentType,
            shares: parseFloat(values[3]) || 0,
            avgCost:
              values[4] !== '' && values[4] !== undefined
                ? (() => {
                    const n = parseFloat(values[4]);
                    return Number.isFinite(n) ? Math.round(n * 100) / 100 : undefined;
                  })()
                : undefined,
            currentPrice: parseFloat(values[5]) || 0,
            position: parseFloat(values[7 + pinOff]) || 0,
            weight: 0,
            targetPrice:
              tpRaw === ''
                ? undefined
                : (() => {
                    const n = parseFloat(tpRaw);
                    return Number.isFinite(n) ? Math.round(n * 100) / 100 : undefined;
                  })(),
            optionStrike: values[10 + pinOff] ? parseFloat(values[10 + pinOff]) : undefined,
            optionExpiry: values[11 + pinOff] || undefined,
            optionType: (values[12 + pinOff] as 'C' | 'P') || undefined,
            signal,
            groupWith: gwRaw === '' ? undefined : gwRaw.toUpperCase()
          });
        } else if (!hasPinZhong && values.length < 13 + pinOff) {
          const { isOption, instrumentType } = parseLegacyCsvTypeColumn(values[2] || '');
          const tpRaw = values[7]?.trim() ?? '';
          newStocks.push({
            symbol: values[0].toUpperCase(),
            name: values[1] || getStockDisplayName(values[0]),
            type: isOption ? 'option' : 'stock',
            instrumentType,
            shares: parseFloat(values[3]) || 0,
            targetPrice:
              tpRaw === ''
                ? undefined
                : (() => {
                    const n = parseFloat(tpRaw);
                    return Number.isFinite(n) ? Math.round(n * 100) / 100 : undefined;
                  })(),
            currentPrice: parseFloat(values[4]) || 0,
            position: parseFloat(values[5]) || 0,
            weight: 0,
            optionStrike: values[8] ? parseFloat(values[8]) : undefined,
            optionExpiry: values[9] || undefined,
            optionType: (values[10] as 'C' | 'P') || undefined
          });
        }
      }
      
      if (newStocks.length > 0 || cashFromCsv !== null) {
        state.stocks = newStocks;
        if (cashFromCsv !== null) state.cash = cashFromCsv;
        calculateTotals();
        saveToStorage();
        render();

        void refreshFinnhubCanonicalEquivalents();

        if (state.stocks.length > 0) {
          setTimeout(() => updateStockPrices(), 500);
        }

        const cashNote = cashFromCsv !== null ? `，现金 $${formatNumber(cashFromCsv, 2)}` : '';
        renderSuccess(`成功导入 ${state.stocks.length} 条持仓${cashNote}`);
      } else {
        renderError('未找到有效的持仓数据');
      }
    } catch (error) {
      renderError('导入失败：文件格式错误');
    }
  };
  reader.readAsText(file);
  input.value = '';
}

function getGroupPortfolioPercent(
  u: string,
  groupMap: Map<string, Stock[]>,
  totalAssets: number
): number {
  const items = groupMap.get(u)!;
  const groupPos = items.reduce((acc, x) => acc + x.position, 0);
  return totalAssets > 0 ? (groupPos / totalAssets) * 100 : 0;
}

/** 持仓表格 tbody：按标的分组排序，仅输出明细行（无品类汇总栏） */
// 渲染交易面板
function renderTradePanel(): string {
  return `
    <div class="trade-panel-block">
    <!-- 交易操作区域 -->
    <div style="margin-bottom: 20px;">
      <div style="display: flex; gap: 10px; flex-wrap: wrap; align-items: center;">
        <button type="button" class="btn btn-primary" onclick="openNewTradeForm('buy')" style="padding: 8px 16px; font-size: 0.85rem; background: #10b981; border: none; color: white;">
          ＋ 新增买入
        </button>
        <button type="button" class="btn btn-secondary" onclick="openNewTradeForm('sell')" style="padding: 8px 16px; font-size: 0.85rem; border: 1px solid #fecaca; color: #b91c1c; background: #fef2f2;">
          ＋ 新增卖出
        </button>
        <button class="btn btn-secondary" onclick="openTradeHistoryModal()" style="padding: 8px 16px; font-size: 0.85rem;">
          📋 交易记录 (${state.trades.length})
        </button>
        ${state.pnlStats ? `
          <div style="display: flex; gap: 12px; padding: 8px 16px; background: linear-gradient(135deg, #1e293b 0%, #334155 100%); border-radius: 8px; color: white; font-size: 0.85rem;">
            <span>已实现盈亏: <strong style="color: ${state.pnlStats.realizedPL >= 0 ? '#4ade80' : '#f87171'};">$${formatNumber(state.pnlStats.realizedPL)}</strong></span>
            <span>手续费: <strong>$${formatNumber(state.pnlStats.commission)}</strong></span>
            <span>净盈亏: <strong style="color: ${state.pnlStats.netPL >= 0 ? '#4ade80' : '#f87171'};">$${formatNumber(state.pnlStats.netPL)}</strong></span>
          </div>
        ` : ''}
      </div>
    </div>
    
    <!-- 盈亏统计区域 -->
    <div style="margin-bottom: 20px; padding: 16px; background: #f8fafc; border-radius: 8px; border: 1px solid #e2e8f0;">
      <div style="display: flex; gap: 12px; flex-wrap: wrap; align-items: center; margin-bottom: 12px;">
        <span style="font-weight: 600; color: #334155;">查询盈亏:</span>
        <input type="date" id="pnl-start-date" value="${state.pnlStartDate}" onchange="setPnlQueryStartDate(this.value)"
               style="padding: 6px 10px; border: 1px solid #cbd5e1; border-radius: 6px; font-size: 0.85rem;" />
        <span>至</span>
        <input type="date" id="pnl-end-date" value="${state.pnlEndDate}" onchange="setPnlQueryEndDate(this.value)"
               style="padding: 6px 10px; border: 1px solid #cbd5e1; border-radius: 6px; font-size: 0.85rem;" />
        <button class="btn btn-secondary" onclick="refreshPnlStats()" style="padding: 6px 12px; font-size: 0.85rem;">
          查询
        </button>
        <button type="button" class="btn btn-secondary" onclick="resetPnlQuery()" style="padding: 6px 12px; font-size: 0.85rem; color: #64748b;">
          重置
        </button>
      </div>
      ${state.pnlStats ? `
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px;">
          <div style="padding: 12px; background: white; border-radius: 6px; border: 1px solid #e2e8f0;">
            <div style="font-size: 0.75rem; color: #64748b;">买入总额</div>
            <div style="font-size: 1.1rem; font-weight: 600; color: #334155;">$${formatNumber(state.pnlStats.totalBuyAmount)}</div>
          </div>
          <div style="padding: 12px; background: white; border-radius: 6px; border: 1px solid #e2e8f0;">
            <div style="font-size: 0.75rem; color: #64748b;">卖出总额</div>
            <div style="font-size: 1.1rem; font-weight: 600; color: #334155;">$${formatNumber(state.pnlStats.totalSellAmount)}</div>
          </div>
          <div style="padding: 12px; background: white; border-radius: 6px; border: 1px solid #e2e8f0;">
            <div style="font-size: 0.75rem; color: #64748b;">已实现盈亏</div>
            <div style="font-size: 1.1rem; font-weight: 600; color: ${state.pnlStats.realizedPL >= 0 ? '#10b981' : '#ef4444'};">
              ${state.pnlStats.realizedPL >= 0 ? '+' : ''}$${formatNumber(state.pnlStats.realizedPL)}
            </div>
          </div>
          <div style="padding: 12px; background: white; border-radius: 6px; border: 1px solid #e2e8f0;">
            <div style="font-size: 0.75rem; color: #64748b;">手续费</div>
            <div style="font-size: 1.1rem; font-weight: 600; color: #ef4444;">-$${formatNumber(state.pnlStats.commission)}</div>
          </div>
          <div style="padding: 12px; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius: 6px; color: white;">
            <div style="font-size: 0.75rem; opacity: 0.9;">净盈亏</div>
            <div style="font-size: 1.2rem; font-weight: 700;">
              ${state.pnlStats.netPL >= 0 ? '+' : ''}$${formatNumber(state.pnlStats.netPL)}
            </div>
          </div>
        </div>
      ` : `
        <div style="color: #94a3b8; font-size: 0.85rem;">点击「查询」查看盈亏统计</div>
      `}
    </div>
    </div>
  `;
}

// 打开交易记录弹窗
function openTradeHistoryModal(): void {
  tradeHistoryModalOpen = true;
  tradeHistoryPage = 1;
  render();
}

// 关闭交易记录弹窗
function closeTradeHistoryModal(): void {
  tradeHistoryModalOpen = false;
  render();
}

// 筛选（交易记录始终在本地 state.trades，此处仅重绘弹窗）
function loadTradesFiltered(): void {
  render();
}

// 设置筛选条件
function setTradeHistoryFilter(field: 'symbol' | 'type' | 'startDate' | 'endDate', value: string): void {
  if (field === 'type') {
    tradeHistoryFilter.type = value as '' | 'buy' | 'sell';
  } else {
    (tradeHistoryFilter as Record<string, string>)[field] = value;
  }
  tradeHistoryPage = 1;
  if (field === 'symbol') {
    patchTradeHistoryModalTableRoot();
    return;
  }
  loadTradesFiltered();
}

// 重置筛选
function resetTradeHistoryFilter(): void {
  tradeHistoryFilter = { symbol: '', type: '', startDate: '', endDate: '' };
  tradeHistoryPage = 1;
  loadTradesFiltered();
}

// 切换分页
function setTradeHistoryPage(page: number): void {
  tradeHistoryPage = page;
  patchTradeHistoryModalTableRootOrRender();
}

function setTradeHistoryPageSize(size: number): void {
  if (!(TRADE_HISTORY_PAGE_SIZE_OPTIONS as readonly number[]).includes(size)) return;
  tradeHistoryPageSize = size;
  tradeHistoryPage = 1;
  patchTradeHistoryModalTableRootOrRender();
}

function getTradeHistoryFilteredTrades(): TradeRecord[] {
  let filtered = [...state.trades];
  if (tradeHistoryFilter.symbol) {
    filtered = filtered.filter(t =>
      t.symbol.toUpperCase().includes(tradeHistoryFilter.symbol.toUpperCase())
    );
  }
  if (tradeHistoryFilter.type) {
    filtered = filtered.filter(t => t.type === tradeHistoryFilter.type);
  }
  if (tradeHistoryFilter.startDate) {
    filtered = filtered.filter(
      (t) => t.trade_date.slice(0, 10) >= tradeHistoryFilter.startDate
    );
  }
  if (tradeHistoryFilter.endDate) {
    filtered = filtered.filter(
      (t) => t.trade_date.slice(0, 10) <= tradeHistoryFilter.endDate
    );
  }
  return filtered;
}

/** 交易记录弹窗内表格 + 分页（供 full render 与股票代码筛选时局部更新共用） */
function buildTradeHistoryModalTableRootInnerHtml(): string {
  const filtered = getTradeHistoryFilteredTrades();
  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / tradeHistoryPageSize));
  if (tradeHistoryPage > totalPages) {
    tradeHistoryPage = totalPages;
  }
  const startIdx = (tradeHistoryPage - 1) * tradeHistoryPageSize;
  const pageItems = filtered.slice(startIdx, startIdx + tradeHistoryPageSize);

  const rows =
    pageItems.length === 0
      ? `
    <tr>
      <td colspan="9" style="padding: 40px; text-align: center; color: #94a3b8;">
        暂无符合条件的交易记录
      </td>
    </tr>
  `
      : pageItems
          .map((trade) => {
            const date = new Date(trade.trade_date).toLocaleDateString('zh-CN');
            const time = new Date(trade.trade_date).toLocaleTimeString('zh-CN', {
              hour: '2-digit',
              minute: '2-digit'
            });
            const isBuy = trade.type === 'buy';

            return `
      <tr style="border-bottom: 1px solid #e2e8f0;">
        <td style="padding: 12px; color: #64748b; font-size: 0.85rem;">${date}<br/><span style="font-size: 0.75rem;">${time}</span></td>
        <td style="padding: 12px;">
          <span style="background: ${isBuy ? '#10b981' : '#ef4444'}; color: white; padding: 2px 10px; border-radius: 4px; font-size: 0.8rem; font-weight: 600;">
            ${isBuy ? '买入' : '卖出'}
          </span>
        </td>
        <td style="padding: 12px; font-weight: 600; color: #667eea;">${trade.symbol}</td>
        <td style="padding: 12px; color: #334155; max-width: 150px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${trade.name}</td>
        <td style="padding: 12px; text-align: right; font-weight: 600;">${formatNumber(trade.shares)} 股</td>
        <td style="padding: 12px; text-align: right;">@ $${formatNumber(trade.price)}</td>
        <td style="padding: 12px; text-align: right; font-weight: 600; color: ${isBuy ? '#334155' : '#10b981'};">
          ${isBuy ? '-' : '+'}$${formatNumber(trade.total_amount)}
        </td>
        <td style="padding: 12px; text-align: right; color: #ef4444; font-size: 0.85rem;">
          ${trade.commission > 0 ? `-$${formatNumber(trade.commission)}` : '-'}
        </td>
        <td style="padding: 12px;">
          <div style="display: flex; gap: 6px;">
            <button onclick="openEditTradeModal(${JSON.stringify(trade).replace(/"/g, '&quot;')})" 
                    style="padding: 4px 10px; background: #e0e7ff; border: 1px solid #c7d2fe; border-radius: 4px; color: #4f46e5; cursor: pointer; font-size: 0.8rem;">
              编辑
            </button>
            <button onclick="handleDeleteTrade('${trade.id}', '${trade.symbol}')" 
                    style="padding: 4px 10px; background: #fee2e2; border: 1px solid #fecaca; border-radius: 4px; color: #ef4444; cursor: pointer; font-size: 0.8rem;">
              删除
            </button>
          </div>
        </td>
      </tr>
    `;
          })
          .join('');

  const pageNumbers = [];
  const maxPageButtons = 5;
  let startPage = Math.max(1, tradeHistoryPage - Math.floor(maxPageButtons / 2));
  let endPage = Math.min(totalPages, startPage + maxPageButtons - 1);
  if (endPage - startPage < maxPageButtons - 1) {
    startPage = Math.max(1, endPage - maxPageButtons + 1);
  }

  for (let i = startPage; i <= endPage; i++) {
    pageNumbers.push(i);
  }

  const pageSizeSelectHtml = TRADE_HISTORY_PAGE_SIZE_OPTIONS.map(
    (n) => `<option value="${n}"${tradeHistoryPageSize === n ? ' selected' : ''}>${n}</option>`
  ).join('');

  const pageNavHtml =
    totalPages > 1
      ? `
      <div style="display: flex; gap: 4px; align-items: center; flex-wrap: wrap;">
        <button onclick="setTradeHistoryPage(${tradeHistoryPage - 1})" ${tradeHistoryPage === 1 ? 'disabled' : ''}
                style="padding: 6px 12px; border: 1px solid #e2e8f0; background: white; border-radius: 4px; cursor: ${tradeHistoryPage === 1 ? 'not-allowed' : 'pointer'}; color: ${tradeHistoryPage === 1 ? '#cbd5e1' : '#334155'};">
          上一页
        </button>
        ${pageNumbers
          .map(
            (p) => `
          <button onclick="setTradeHistoryPage(${p})" 
                  style="padding: 6px 12px; border: 1px solid ${p === tradeHistoryPage ? '#667eea' : '#e2e8f0'}; background: ${p === tradeHistoryPage ? '#667eea' : 'white'}; color: ${p === tradeHistoryPage ? 'white' : '#334155'}; border-radius: 4px; cursor: pointer; font-weight: ${p === tradeHistoryPage ? '600' : '400'};">
            ${p}
          </button>
        `
          )
          .join('')}
        <button onclick="setTradeHistoryPage(${tradeHistoryPage + 1})" ${tradeHistoryPage === totalPages ? 'disabled' : ''}
                style="padding: 6px 12px; border: 1px solid #e2e8f0; background: white; border-radius: 4px; cursor: ${tradeHistoryPage === totalPages ? 'not-allowed' : 'pointer'}; color: ${tradeHistoryPage === totalPages ? '#cbd5e1' : '#334155'};">
          下一页
        </button>
      </div>`
      : '';

  const tableSection = `
        <div style="flex: 1; min-height: 0; overflow-y: auto; padding: 0 24px;">
          <table style="width: 100%; border-collapse: collapse; min-width: 800px;">
            <thead style="position: sticky; top: 0; background: white; z-index: 1;">
              <tr style="border-bottom: 2px solid #e2e8f0;">
                <th style="padding: 12px; text-align: left; font-size: 0.8rem; color: #64748b; font-weight: 600;">时间</th>
                <th style="padding: 12px; text-align: left; font-size: 0.8rem; color: #64748b; font-weight: 600;">类型</th>
                <th style="padding: 12px; text-align: left; font-size: 0.8rem; color: #64748b; font-weight: 600;">代码</th>
                <th style="padding: 12px; text-align: left; font-size: 0.8rem; color: #64748b; font-weight: 600;">名称</th>
                <th style="padding: 12px; text-align: right; font-size: 0.8rem; color: #64748b; font-weight: 600;">股数</th>
                <th style="padding: 12px; text-align: right; font-size: 0.8rem; color: #64748b; font-weight: 600;">价格</th>
                <th style="padding: 12px; text-align: right; font-size: 0.8rem; color: #64748b; font-weight: 600;">金额</th>
                <th style="padding: 12px; text-align: right; font-size: 0.8rem; color: #64748b; font-weight: 600;">手续费</th>
                <th style="padding: 12px; text-align: center; font-size: 0.8rem; color: #64748b; font-weight: 600;">操作</th>
              </tr>
            </thead>
            <tbody>
              ${rows}
            </tbody>
          </table>
        </div>`;

  const footerSection = `
        <div style="flex-shrink: 0; padding: 12px 24px 16px; border-top: 1px solid #e2e8f0; background: #f8fafc;">
          <div style="display: flex; flex-wrap: wrap; gap: 12px; align-items: center; justify-content: space-between;">
            <div style="display: flex; align-items: center; gap: 10px; flex-wrap: wrap;">
              <label style="color: #64748b; font-size: 0.85rem; white-space: nowrap;">每页条数</label>
              <select onchange="setTradeHistoryPageSize(parseInt(this.value, 10))"
                      style="padding: 6px 10px; border: 1px solid #e2e8f0; border-radius: 6px; font-size: 0.85rem; background: white; color: #334155;">
                ${pageSizeSelectHtml}
              </select>
              <span style="color: #64748b; font-size: 0.85rem;">共 ${total} 条</span>
            </div>
            ${pageNavHtml}
          </div>
        </div>`;

  return tableSection + footerSection;
}

function patchTradeHistoryModalTableRoot(): void {
  if (!tradeHistoryModalOpen) return;
  const root = document.getElementById('trade-history-modal-table-root');
  if (!root) {
    render();
    return;
  }
  root.innerHTML = buildTradeHistoryModalTableRootInnerHtml();
}

function patchTradeHistoryModalTableRootOrRender(): void {
  if (!tradeHistoryModalOpen) {
    render();
    return;
  }
  const root = document.getElementById('trade-history-modal-table-root');
  if (!root) {
    render();
    return;
  }
  root.innerHTML = buildTradeHistoryModalTableRootInnerHtml();
}

// 渲染交易历史弹窗
function renderTradeHistoryModal(): string {
  if (!tradeHistoryModalOpen) return '';

  return `
    <div style="position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); z-index: 1000; display: flex; align-items: center; justify-content: center; padding: 20px;">
      <div style="background: white; border-radius: 12px; width: 100%; max-width: 1000px; max-height: 90vh; display: flex; flex-direction: column; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);">
        <!-- 头部 -->
        <div style="display: flex; justify-content: space-between; align-items: center; padding: 20px 24px; border-bottom: 1px solid #e2e8f0;">
          <h2 style="margin: 0; color: #334155; font-size: 1.25rem;">交易记录</h2>
          <div style="display: flex; gap: 8px;">
            <button onclick="openImportTradeModal()" style="padding: 8px 16px; border: 1px solid #e2e8f0; border-radius: 6px; background: white; color: #334155; font-size: 0.85rem; cursor: pointer;">
              导入
            </button>
            <div style="position: relative; display: inline-block;">
              <button onclick="exportTradesToCSV()" style="padding: 8px 16px; border: 1px solid #e2e8f0; border-radius: 6px; background: white; color: #334155; font-size: 0.85rem; cursor: pointer;">
                导出 CSV
              </button>
            </div>
            <button onclick="exportTradesToJSON()" style="padding: 8px 16px; border: 1px solid #e2e8f0; border-radius: 6px; background: white; color: #334155; font-size: 0.85rem; cursor: pointer;">
              导出 JSON
            </button>
          </div>
          <button onclick="closeTradeHistoryModal()" style="background: none; border: none; font-size: 1.5rem; cursor: pointer; color: #94a3b8; padding: 4px;">&times;</button>
        </div>
        
        <!-- 筛选区域 -->
        <div style="padding: 16px 24px; border-bottom: 1px solid #e2e8f0; background: #f8fafc;">
          <div style="display: flex; gap: 12px; flex-wrap: wrap; align-items: flex-end;">
            <div>
              <label style="display: block; margin-bottom: 4px; color: #64748b; font-size: 0.8rem;">股票代码</label>
              <input type="text" id="trade-history-symbol-filter" value="${escapeHtmlAttr(tradeHistoryFilter.symbol)}" oninput="setTradeHistoryFilter('symbol', this.value)" placeholder="如：AAPL"
                     style="padding: 8px 12px; border: 1px solid #e2e8f0; border-radius: 6px; font-size: 0.85rem; width: 120px;" />
            </div>
            <div>
              <label style="display: block; margin-bottom: 4px; color: #64748b; font-size: 0.8rem;">交易类型</label>
              <select onchange="setTradeHistoryFilter('type', this.value)"
                      style="padding: 8px 12px; border: 1px solid #e2e8f0; border-radius: 6px; font-size: 0.85rem; min-width: 100px;">
                <option value="" ${!tradeHistoryFilter.type ? 'selected' : ''}>全部</option>
                <option value="buy" ${tradeHistoryFilter.type === 'buy' ? 'selected' : ''}>买入</option>
                <option value="sell" ${tradeHistoryFilter.type === 'sell' ? 'selected' : ''}>卖出</option>
              </select>
            </div>
            <div>
              <label style="display: block; margin-bottom: 4px; color: #64748b; font-size: 0.8rem;">开始日期</label>
              <input type="date" value="${tradeHistoryFilter.startDate}" onchange="setTradeHistoryFilter('startDate', this.value)"
                     style="padding: 8px 12px; border: 1px solid #e2e8f0; border-radius: 6px; font-size: 0.85rem;" />
            </div>
            <div>
              <label style="display: block; margin-bottom: 4px; color: #64748b; font-size: 0.8rem;">结束日期</label>
              <input type="date" value="${tradeHistoryFilter.endDate}" onchange="setTradeHistoryFilter('endDate', this.value)"
                     style="padding: 8px 12px; border: 1px solid #e2e8f0; border-radius: 6px; font-size: 0.85rem;" />
            </div>
            <div>
              <button onclick="resetTradeHistoryFilter()" style="padding: 8px 16px; border: 1px solid #e2e8f0; border-radius: 6px; background: white; color: #64748b; cursor: pointer; font-size: 0.85rem;">
                重置
              </button>
            </div>
          </div>
        </div>
        
        <!-- 表格区域：中间滚动，底部分页条固定（股票代码筛选时仅替换本节点 innerHTML） -->
        <div id="trade-history-modal-table-root" style="flex: 1; min-height: 0; display: flex; flex-direction: column; overflow: hidden; padding: 0;">
          ${buildTradeHistoryModalTableRootInnerHtml()}
        </div>
      </div>
    </div>
  `;
}

// 渲染导入交易弹窗
function renderImportTradeModal(): string {
  if (!importTradeModalOpen) return '';
  
  const previewRows = importPreviewData.length > 0 ? importPreviewData.slice(0, 5).map(trade => {
    const date = new Date(trade.trade_date).toLocaleDateString('zh-CN');
    const isBuy = trade.type === 'buy';
    return `
      <tr style="border-bottom: 1px solid #e2e8f0;">
        <td style="padding: 8px; font-size: 0.85rem; color: #64748b;">${date}</td>
        <td style="padding: 8px;">
          <span style="background: ${isBuy ? '#10b981' : '#ef4444'}; color: white; padding: 1px 6px; border-radius: 3px; font-size: 0.75rem;">
            ${isBuy ? '买入' : '卖出'}
          </span>
        </td>
        <td style="padding: 8px; font-weight: 600; color: #667eea;">${trade.symbol}</td>
        <td style="padding: 8px; font-size: 0.85rem;">${trade.name}</td>
        <td style="padding: 8px; text-align: right; font-size: 0.85rem;">${formatNumber(trade.shares)}</td>
        <td style="padding: 8px; text-align: right; font-size: 0.85rem;">$${formatNumber(trade.price)}</td>
      </tr>
    `;
  }).join('') : '';
  
  return `
    <div style="position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); z-index: 1200; display: flex; align-items: center; justify-content: center; padding: 20px;">
      <div style="background: white; border-radius: 12px; width: 100%; max-width: 600px; max-height: 90vh; display: flex; flex-direction: column; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);">
        <!-- 头部 -->
        <div style="display: flex; justify-content: space-between; align-items: center; padding: 20px 24px; border-bottom: 1px solid #e2e8f0;">
          <h2 style="margin: 0; color: #334155; font-size: 1.25rem;">导入交易记录</h2>
          <button onclick="closeImportTradeModal()" style="background: none; border: none; font-size: 1.5rem; cursor: pointer; color: #94a3b8; padding: 4px;">&times;</button>
        </div>
        
        <!-- 内容 -->
        <div style="padding: 24px; overflow-y: auto;">
          <!-- 文件选择 -->
          <div style="margin-bottom: 24px; padding-bottom: 20px; border-bottom: 1px solid #e2e8f0;">
            <label style="display: block; margin-bottom: 8px; color: #334155; font-weight: 600;">Moomoo 导入</label>
            <input type="file" accept=".xlsx,.xls" onchange="handleMoomooTradeImport(event)"
                   style="width: 100%; padding: 12px; border: 2px dashed #cbd5e1; border-radius: 8px; background: #f8fafc;" />
            <p style="margin: 8px 0 0 0; color: #64748b; font-size: 0.82rem;">
              上传 Moomoo（富途）导出的<strong>历史 / 现金账户 xlsx</strong>。仅导入「全部成交」：方向、代码、成交价格（或成交价）、成交金额、成交时间、合计费用；有「成交数量」则优先。
              期权代码中行权价若为 ×1000 的长数字（如 …C40000→C40，…C5000→C5），会自动转为与本应用行情一致的紧凑码。
            </p>
          </div>
          <div style="margin-bottom: 24px; padding-bottom: 20px; border-bottom: 1px solid #e2e8f0;">
            <label style="display: block; margin-bottom: 8px; color: #334155; font-weight: 600;">BBAE 导入</label>
            <input type="file" accept=".xlsx,.xls" onchange="handleBbaeTradeImport(event)"
                   style="width: 100%; padding: 12px; border: 2px dashed #cbd5e1; border-radius: 8px; background: #f8fafc;" />
            <p style="margin: 8px 0 0 0; color: #64748b; font-size: 0.82rem;">
              上传 BBAE 订单导出 xlsx（可多表）：<strong>股票</strong>表（已成、股票代码、成交价、成交数量、佣金…）；<strong>期权</strong>表的手续费为<strong>套餐外费用 + 期权监管费</strong>（不扣套餐抵扣）；仅有一列「套餐外费用加期权监管费减去套餐抵扣」时读取该格数值。
            </p>
          </div>
          <div style="margin-bottom: 8px;">
            <label style="display: block; margin-bottom: 8px; color: #334155; font-weight: 500;">本应用导出（可选）</label>
            <input type="file" accept=".csv,.json" onchange="handleTradeBackupImport(event)"
                   style="width: 100%; padding: 12px; border: 2px dashed #e2e8f0; border-radius: 8px; background: #fafafa;" />
            <p style="margin: 8px 0 0 0; color: #94a3b8; font-size: 0.8rem;">使用此前在应用内「导出交易」生成的 CSV 或 JSON。</p>
          </div>
          
          <!-- 错误提示 -->
          ${importError ? `
            <div style="padding: 12px; background: #fef2f2; border: 1px solid #fecaca; border-radius: 6px; color: #ef4444; margin-bottom: 16px;">
              ${importError}
            </div>
          ` : ''}
          
          <!-- 预览 -->
          ${importPreviewData.length > 0 ? `
            <div style="margin-top: 16px;">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
                <span style="color: #334155; font-weight: 500;">预览（前 5 条，共 ${importPreviewData.length} 条）</span>
              </div>
              <table style="width: 100%; border-collapse: collapse; border: 1px solid #e2e8f0; border-radius: 6px; overflow: hidden;">
                <thead>
                  <tr style="background: #f8fafc;">
                    <th style="padding: 8px; text-align: left; font-size: 0.8rem; color: #64748b;">时间</th>
                    <th style="padding: 8px; text-align: left; font-size: 0.8rem; color: #64748b;">类型</th>
                    <th style="padding: 8px; text-align: left; font-size: 0.8rem; color: #64748b;">代码</th>
                    <th style="padding: 8px; text-align: left; font-size: 0.8rem; color: #64748b;">名称</th>
                    <th style="padding: 8px; text-align: right; font-size: 0.8rem; color: #64748b;">数量</th>
                    <th style="padding: 8px; text-align: right; font-size: 0.8rem; color: #64748b;">价格</th>
                  </tr>
                </thead>
                <tbody>
                  ${previewRows}
                </tbody>
              </table>
              ${importPreviewData.length > 5 ? `<p style="margin-top: 8px; color: #64748b; font-size: 0.85rem;">... 还有 ${importPreviewData.length - 5} 条记录</p>` : ''}
            </div>
          ` : ''}
        </div>
        
        <!-- 底部按钮 -->
        <div style="display: flex; gap: 12px; padding: 16px 24px; border-top: 1px solid #e2e8f0;">
          <button onclick="closeImportTradeModal()" style="flex: 1; padding: 12px; border: 1px solid #e2e8f0; border-radius: 6px; background: white; color: #64748b; font-weight: 500; cursor: pointer;">
            取消
          </button>
          <button onclick="confirmImportTrades()" ${importPreviewData.length === 0 ? 'disabled style="opacity: 0.5; cursor: not-allowed;"' : 'style="flex: 1; padding: 12px; border: none; border-radius: 6px; background: #10b981; color: white; font-weight: 600; cursor: pointer;"'} >
            导入 ${importPreviewData.length > 0 ? `(${importPreviewData.length} 条)` : ''}
          </button>
        </div>
      </div>
    </div>
  `;
}

// 渲染编辑交易弹窗
function renderEditTradeModal(): string {
  if (!editTradeModalOpen || !editingTrade) return '';
  
  const tradeDtForInput = formatDatetimeLocalMinute(new Date(editingTrade.trade_date));
  const editTradeDtMax = formatDatetimeLocalMinute(new Date());
  const isBuy = editingTrade.type === 'buy';
  
  return `
    <div style="position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); z-index: 1100; display: flex; align-items: center; justify-content: center;">
      <div style="background: white; border-radius: 12px; padding: 24px; width: 90%; max-width: 450px; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
          <h3 style="margin: 0; color: #334155;">
            <span style="background: ${isBuy ? '#10b981' : '#ef4444'}; color: white; padding: 2px 8px; border-radius: 4px; font-size: 0.8rem; margin-right: 8px;">
              ${isBuy ? '买入' : '卖出'}
            </span>
            编辑 ${editingTrade.symbol}
          </h3>
          <button onclick="closeEditTradeModal()" style="background: none; border: none; font-size: 1.5rem; cursor: pointer; color: #94a3b8;">&times;</button>
        </div>
        
        <div style="margin-bottom: 16px;">
          <label style="display: block; margin-bottom: 6px; color: #64748b; font-size: 0.85rem;">股票名称</label>
          <input type="text" value="${editingTrade.name}" readonly
                 style="width: 100%; padding: 10px; border: 1px solid #e2e8f0; border-radius: 6px; background: #f8fafc; color: #334155;" />
        </div>
        
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 16px;">
          <div>
            <label style="display: block; margin-bottom: 6px; color: #64748b; font-size: 0.85rem;">股数 *</label>
            <input type="number" id="edit-trade-shares" value="${editingTrade.shares}" min="0.01" step="0.01"
                   style="width: 100%; padding: 10px; border: 1px solid #e2e8f0; border-radius: 6px;" />
          </div>
          <div>
            <label style="display: block; margin-bottom: 6px; color: #64748b; font-size: 0.85rem;">价格 *</label>
            <input type="number" id="edit-trade-price" value="${editingTrade.price}" min="0.01" step="0.01"
                   style="width: 100%; padding: 10px; border: 1px solid #e2e8f0; border-radius: 6px;" />
          </div>
        </div>
        
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 16px;">
          <div>
            <label style="display: block; margin-bottom: 6px; color: #64748b; font-size: 0.85rem;">手续费</label>
            <input type="number" id="edit-trade-commission" value="${editingTrade.commission}" min="0" step="0.01"
                   style="width: 100%; padding: 10px; border: 1px solid #e2e8f0; border-radius: 6px;" />
          </div>
          <div>
            <label style="display: block; margin-bottom: 6px; color: #64748b; font-size: 0.85rem;">交易时间</label>
            <input type="datetime-local" id="edit-trade-date" value="${tradeDtForInput}" max="${editTradeDtMax}" step="60"
                   style="width: 100%; padding: 10px; border: 1px solid #e2e8f0; border-radius: 6px;" />
          </div>
        </div>
        
        <div id="edit-trade-amount-preview" style="padding: 12px; background: #f8fafc; border-radius: 6px; margin-bottom: 16px; text-align: center;">
          <span style="color: #64748b; font-size: 0.85rem;">金额: </span>
          <span style="font-weight: 600; color: #334155;" id="edit-trade-amount-value">
            ${isBuy ? '-' : '+'}$${formatNumber(editingTrade.shares * editingTrade.price)}
          </span>
        </div>
        
        <div style="display: flex; gap: 10px;">
          <button onclick="closeEditTradeModal()" 
                  style="flex: 1; padding: 12px; border: 1px solid #e2e8f0; border-radius: 6px; background: white; color: #64748b; font-weight: 600; cursor: pointer;">
            取消
          </button>
          <button onclick="submitEditTrade()" 
                  style="flex: 1; padding: 12px; border: none; border-radius: 6px; background: #667eea; color: white; font-weight: 600; font-size: 1rem; cursor: pointer;">
            保存修改
          </button>
        </div>
      </div>
    </div>
  `;
}

// 渲染交易表单
function renderTradeForm(): string {
  const tradeDtNow = formatDatetimeLocalMinute(new Date());
  const isBuy = tradeFormType === 'buy';
  const symEsc = escapeHtml(tradeFormSymbol);
  const nameEsc = escapeHtml(tradeFormName);

  const headTitle = tradeFormFreeEntry
    ? `${isBuy ? '买入' : '卖出'}（新建交易）`
    : `${isBuy ? '买入' : '卖出'} ${symEsc}`;

  const symbolBlock = tradeFormFreeEntry
    ? `
        <div class="input-group trade-form-symbol-search" style="position: relative; flex: 2; min-width: 200px; margin-bottom: 16px;">
          <label for="trade-symbol-input">标的代码 *</label>
          <input type="text" id="trade-symbol-input" value="${symEsc}" placeholder="股票 / 期权代码…"
                 autocomplete="off" ${state.loading ? 'disabled' : ''} />
          <div id="trade-stock-suggestions" class="suggestions-dropdown" style="display: none; z-index: 2000;"></div>
        </div>`
    : `
        <div style="margin-bottom: 16px;">
          <label style="display: block; margin-bottom: 6px; color: #64748b; font-size: 0.85rem;">股票名称</label>
          <input type="text" value="${nameEsc}" readonly
                 style="width: 100%; padding: 10px; border: 1px solid #e2e8f0; border-radius: 6px; background: #f8fafc; color: #334155;" />
        </div>`;

  return `
    <div style="position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.5); z-index: 1000; display: flex; align-items: center; justify-content: center;">
      <div style="background: white; border-radius: 12px; padding: 24px; width: 90%; max-width: 400px; box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1); overflow: visible;">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
          <h3 style="margin: 0; color: #334155;">${headTitle}</h3>
          <button onclick="closeTradeForm()" style="background: none; border: none; font-size: 1.5rem; cursor: pointer; color: #94a3b8;">&times;</button>
        </div>

        ${symbolBlock}
        
        <div style="display: flex; gap: 10px; margin-bottom: 16px;">
          <button onclick="setTradeType('buy')" 
                  style="flex: 1; padding: 10px; border: 2px solid ${isBuy ? '#10b981' : '#e2e8f0'}; border-radius: 6px; background: ${isBuy ? '#ecfdf5' : 'white'}; color: ${isBuy ? '#10b981' : '#64748b'}; font-weight: 600; cursor: pointer;">
            买入
          </button>
          <button onclick="setTradeType('sell')"
                  style="flex: 1; padding: 10px; border: 2px solid ${!isBuy ? '#ef4444' : '#e2e8f0'}; border-radius: 6px; background: ${!isBuy ? '#fef2f2' : 'white'}; color: ${!isBuy ? '#ef4444' : '#64748b'}; font-weight: 600; cursor: pointer;">
            卖出
          </button>
        </div>
        
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 16px;">
          <div>
            <label style="display: block; margin-bottom: 6px; color: #64748b; font-size: 0.85rem;">股数 *</label>
            <input type="number" id="trade-shares" placeholder="0" min="0.01" step="0.01"
                   style="width: 100%; padding: 10px; border: 1px solid #e2e8f0; border-radius: 6px;" />
          </div>
          <div>
            <label style="display: block; margin-bottom: 6px; color: #64748b; font-size: 0.85rem;">价格 *</label>
            <input type="number" id="trade-price" placeholder="0.00" min="0.01" step="0.01"
                   style="width: 100%; padding: 10px; border: 1px solid #e2e8f0; border-radius: 6px;" />
          </div>
        </div>
        
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 16px;">
          <div>
            <label style="display: block; margin-bottom: 6px; color: #64748b; font-size: 0.85rem;">手续费</label>
            <input type="number" id="trade-commission" placeholder="0.00" min="0" step="0.01" value="0"
                   style="width: 100%; padding: 10px; border: 1px solid #e2e8f0; border-radius: 6px;" />
          </div>
          <div>
            <label style="display: block; margin-bottom: 6px; color: #64748b; font-size: 0.85rem;">交易时间</label>
            <input type="datetime-local" id="trade-date" value="${tradeDtNow}" max="${tradeDtNow}" step="60"
                   style="width: 100%; padding: 10px; border: 1px solid #e2e8f0; border-radius: 6px;" />
          </div>
        </div>
        
        <div id="trade-amount-preview" style="padding: 12px; background: #f8fafc; border-radius: 6px; margin-bottom: 16px; text-align: center;">
          <span style="color: #64748b; font-size: 0.85rem;">预计金额: </span>
          <span style="font-weight: 600; color: #334155;">—</span>
        </div>
        
        <button onclick="submitTrade()" 
                style="width: 100%; padding: 12px; border: none; border-radius: 6px; background: ${isBuy ? '#10b981' : '#ef4444'}; color: white; font-weight: 600; font-size: 1rem; cursor: pointer;">
          确认${isBuy ? '买入' : '卖出'}
        </button>
      </div>
    </div>
  `;
}

function renderHoldingsTableBody(): string {
  const totalAssets = state.totalValue + state.cash;
  const sorted = [...state.stocks].sort(compareStocksForTable);
  const groupMap = new Map<string, Stock[]>();
  for (const s of sorted) {
    const u = getUnderlyingForStock(s);
    if (!groupMap.has(u)) groupMap.set(u, []);
    groupMap.get(u)!.push(s);
  }
  let keys = [...groupMap.keys()];
  keys.sort((a, b) => {
    if (tableSortKey === 'symbol') {
      return a.localeCompare(b) * tableSortDir;
    }
    const wa = getGroupPortfolioPercent(a, groupMap, totalAssets);
    const wb = getGroupPortfolioPercent(b, groupMap, totalAssets);
    if (wa !== wb) return (wa - wb) * tableSortDir;
    return a.localeCompare(b) * tableSortDir;
  });

  const rows: string[] = [];
  const cashWeightPct = totalAssets > 0 ? (state.cash / totalAssets) * 100 : 0;

  let groupIndex = 0;
  for (const u of keys) {
    const items = groupMap.get(u)!;
    const isNotFirstGroup = groupIndex > 0;
    groupIndex += 1;

    for (let i = 0; i < items.length; i++) {
      const stock = items[i];
      const sepTop = isNotFirstGroup && i === 0;
      const pnl = computeLinePnL(stock);
      const sig = stock.signal ?? 'hold';
      const trStyles = [
        stock.type === 'option' ? 'background: rgba(102, 126, 234, 0.05);' : '',
        sepTop ? 'border-top: 2px solid #cbd5e1;' : ''
      ]
        .filter(Boolean)
        .join(' ');

      const typeInner =
        stock.type === 'option'
          ? '<span style="background: #667eea; color: white; padding: 2px 8px; border-radius: 4px; font-size: 0.75rem;">期权</span>'
          : stock.instrumentType
            ? `<span style="background: #0ea5e9; color: white; padding: 2px 8px; border-radius: 4px; font-size: 0.75rem;">${escapeHtml(stock.instrumentType)}</span>`
            : '<span style="background: #10b981; color: white; padding: 2px 8px; border-radius: 4px; font-size: 0.75rem;">股票</span>';

      const sharesInner = `<div style="font-weight: 600;">${formatNumber(stock.shares)}</div>${
        stock.costLots && stock.costLots.length > 1
          ? `<div style="font-size: 0.65rem; color: #64748b; margin-top: 2px;">${stock.costLots.length} 笔合计</div>`
          : ''
      }`;

      const costInner = `<div style="font-weight: 600;">${
        stock.avgCost !== undefined && stock.avgCost !== null && !Number.isNaN(Number(stock.avgCost))
          ? `$${formatNumber(stock.avgCost)}`
          : '—'
      }</div>${
        stock.costLots && stock.costLots.length > 1
          ? `<div style="font-size: 0.65rem; color: #94a3b8; margin-top: 2px;">加权平均</div>`
          : ''
      }`;

      const optinfoInner =
        stock.type === 'option' && stock.optionStrike
          ? `${stock.optionType === 'C' ? 'Call' : 'Put'} $${stock.optionStrike}<br/><span style="color: #999;">${stock.optionExpiry || ''}</span>`
          : '-';

      const weightRowspanTd =
        i === 0
          ? `<td rowspan="${items.length}" class="${holdingsCellClass('weight')}" style="font-weight: 600; color: #4338ca; vertical-align: middle; text-align: center;" title="同标的合并持仓市值 ÷ 总资产（含现金）">${maskOr('weight', formatPercent(stock.weight))}</td>`
          : '';

      const symEsc = stock.symbol.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

      rows.push(`
        <tr${trStyles ? ` style="${trStyles}"` : ''}>
          <td class="${holdingsCellClass('type')}">${maskOr('type', typeInner)}</td>
          ${
            columnVisibility.symbol
              ? `<td class="${holdingsCellClass('symbol')}" style="font-weight: 600; color: #667eea; cursor: grab;"
              draggable="true"
              ondragstart="symbolDragStart(event, '${symEsc}')"
              ondragover="symbolDragOver(event)"
              ondrop="symbolDropOnRow(event, '${symEsc}')"
              ondragend="symbolDragEnd()"
              title="拖动代码到另一条持仓，合并为同一标的">
            <span style="display: inline-flex; align-items: center; gap: 4px; flex-wrap: wrap;">
              <span>${stock.symbol}</span>
              ${
                stock.groupWith
                  ? `<button type="button" onclick="clearGroupOverride('${symEsc}')" title="恢复自动分组" style="padding: 0 5px; font-size: 0.65rem; border: 1px solid #e5e7eb; border-radius: 4px; background: #fff; cursor: pointer; color: #64748b;">↺</button>`
                  : ''
              }
            </span>
          </td>`
              : `<td class="${holdingsCellClass('symbol')}" style="color: #94a3b8;">${HOLDINGS_DATA_MASK_HTML}</td>`
          }
          <td class="${holdingsCellClass('shares')}" style="text-align: center; vertical-align: middle;">${maskOr('shares', sharesInner)}</td>
          <td class="${holdingsCellClass('cost')}" style="text-align: center; vertical-align: middle;">${maskOr('cost', costInner)}</td>
          ${
            columnVisibility.price
              ? `<td class="${holdingsCellClass('price')}" style="font-weight: 600;">
            <span id="price-${stock.symbol}">$${formatNumber(stock.currentPrice)}</span>
            <button type="button" onclick="refreshSingleStock('${symEsc}')" 
                    style="margin-left: 4px; padding: 2px 6px; font-size: 0.7rem; background: #f3f4f6; border: 1px solid #d1d5db; border-radius: 4px; cursor: pointer;">
              ↻
            </button>
          </td>`
              : `<td class="${holdingsCellClass('price')}" style="font-weight: 600;">${HOLDINGS_DATA_MASK_HTML}</td>`
          }
          <td class="${holdingsCellClass('pnl')}" style="font-size: 0.9rem;">${maskOr('pnl', formatPnLCell(pnl))}</td>
          <td class="${holdingsCellClass('pnlPct')}" style="font-size: 0.9rem;">${maskOr('pnlPct', formatPnLPercentCell(computeLinePnLPercent(stock)))}</td>
          ${
            columnVisibility.position
              ? `<td class="${holdingsCellClass('position')}" style="font-weight: 600; color: #059669;" id="position-${stock.symbol}">$${formatNumber(stock.position)}</td>`
              : `<td class="${holdingsCellClass('position')}" style="font-weight: 600; color: #059669;">${HOLDINGS_DATA_MASK_HTML}</td>`
          }
          ${weightRowspanTd}
          ${
            columnVisibility.target
              ? `<td class="${holdingsCellClass('target')}">
            <input type="number" value="${formatTargetInputValue(stock.targetPrice)}" placeholder="—"
                   onchange="updateStock('${symEsc}', 'targetPrice', this.value)" 
                   style="width: 88px; padding: 6px; border: 1px solid #e5e7eb; border-radius: 6px; text-align: center;"
                   step="0.01" min="0" />
          </td>`
              : `<td class="${holdingsCellClass('target')}">${HOLDINGS_DATA_MASK_HTML}</td>`
          }
          <td class="${holdingsCellClass('optinfo')}" style="font-size: 0.8rem; color: #666;">${maskOr('optinfo', optinfoInner)}</td>
          ${
            columnVisibility.signal
              ? `<td class="${holdingsCellClass('signal')}">
            <select onchange="updateStock('${symEsc}', 'signal', this.value)"
                    style="padding: 6px 8px; border: 1px solid #e5e7eb; border-radius: 6px; font-size: 0.85rem; max-width: 88px;">
              <option value="buy" ${sig === 'buy' ? 'selected' : ''}>买入</option>
              <option value="hold" ${sig === 'hold' ? 'selected' : ''}>持有</option>
              <option value="sell" ${sig === 'sell' ? 'selected' : ''}>卖出</option>
            </select>
          </td>`
              : `<td class="${holdingsCellClass('signal')}">${HOLDINGS_DATA_MASK_HTML}</td>`
          }
          ${
            columnVisibility.actions
              ? `<td class="holdings-actions-cell ${holdingsCellClass('actions')}">
            <div class="holdings-actions-btns">
              <button type="button" class="btn btn-buy holdings-action-btn" title="记录买入" aria-label="记录买入" 
                      onclick="openTradeForm('${symEsc}', '${escapeHtml(stock.name).replace(/'/g, "\\'")}', 'buy')"
                      style="background: #10b981; color: white; border: none;">买</button>
              <button type="button" class="btn btn-sell holdings-action-btn" title="记录卖出" aria-label="记录卖出"
                      onclick="openTradeForm('${symEsc}', '${escapeHtml(stock.name).replace(/'/g, "\\'")}', 'sell')"
                      style="background: #ef4444; color: white; border: none;">卖</button>
            </div>
          </td>`
              : `<td class="holdings-actions-cell ${holdingsCellClass('actions')}">${HOLDINGS_DATA_MASK_HTML}</td>`
          }
        </tr>
      `);
    }
  }

  rows.push(`
    <tr style="background: rgba(234, 179, 8, 0.12);">
      <td class="${holdingsCellClass('type')}">${maskOr('type', '<span style="background: #eab308; color: white; padding: 2px 8px; border-radius: 4px; font-size: 0.75rem;">现金</span>')}</td>
      <td class="${holdingsCellClass('symbol')}" style="font-weight: 600; color: #a16207;">${maskOr('symbol', 'CASH')}</td>
      <td class="${holdingsCellClass('shares')}" style="color: #94a3b8;">${maskOr('shares', '—')}</td>
      <td class="${holdingsCellClass('cost')}" style="color: #94a3b8;">${maskOr('cost', '—')}</td>
      <td class="${holdingsCellClass('price')}" style="color: #94a3b8;">${maskOr('price', '—')}</td>
      <td class="${holdingsCellClass('pnl')}" style="color: #94a3b8;">${maskOr('pnl', '—')}</td>
      <td class="${holdingsCellClass('pnlPct')}" style="color: #94a3b8;">${maskOr('pnlPct', '—')}</td>
      <td class="${holdingsCellClass('position')}" style="font-weight: 700; color: #0f766e;">${maskOr('position', `$${formatNumber(state.cash)}`)}</td>
      <td class="${holdingsCellClass('weight')}" style="font-weight: 700; color: #4338ca;">${maskOr('weight', formatPercent(cashWeightPct))}</td>
      <td class="${holdingsCellClass('target')}" style="color: #94a3b8;">${maskOr('target', '—')}</td>
      <td class="${holdingsCellClass('optinfo')}" style="color: #94a3b8;">${maskOr('optinfo', '—')}</td>
      <td class="${holdingsCellClass('signal')}" style="color: #94a3b8;">${maskOr('signal', '—')}</td>
      <td class="holdings-actions-cell ${holdingsCellClass('actions')}" style="color: #94a3b8;">${maskOr('actions', '—')}</td>
    </tr>
  `);

  return rows.join('');
}

// 函数：更新现金
function updateCash(value: number): void {
  state.cash = value;
  calculateTotals();
  saveToStorage();
  render();
}

// 函数：更新股票价格
async function updateStockPrices(): Promise<void> {
  if (state.stocks.length === 0) return;
  
  state.loading = true;
  render();
  
  try {
    const stockDataList = await fetchBatchStockData(state.stocks);
    
    state.stocks = state.stocks.map(stock => {
      const data = stockDataList.find((d: any) => d.symbol === stock.symbol);
      if (data && data.price > 0) {
        return {
          ...stock,
          currentPrice: data.price,
          ...(stock.type === 'option' ? { name: data.name } : {})
        };
      }
      return stock;
    });
    
    calculateTotals();
    renderSuccess('股票价格已更新');
  } catch (error) {
    renderError('更新股票价格失败，请稍后重试');
  } finally {
    state.loading = false;
    render();
  }
}

// 函数：添加股票
async function addStock(): Promise<void> {
  const symbolInput = document.getElementById('symbol') as HTMLInputElement;
  const sharesInput = document.getElementById('shares') as HTMLInputElement;
  const targetPriceInput = document.getElementById('targetPrice') as HTMLInputElement;
  
  const symbol = symbolInput.value.trim().toUpperCase();
  const shares = parseFloat(sharesInput.value) || 0;
  const targetRaw = targetPriceInput.value.trim();
  const targetPrice =
    targetRaw === ''
      ? undefined
      : (() => {
          const n = parseFloat(targetRaw);
          return Number.isFinite(n) ? Math.round(n * 100) / 100 : undefined;
        })();
  
  if (!symbol) {
    renderError('请输入股票代码或期权代码');
    return;
  }
  
  // 检查是否已存在
  if (state.stocks.find(s => s.symbol === symbol)) {
    pendingSearchPick = null;
    renderError('该标的已在持仓列表中');
    return;
  }
  
  state.loading = true;
  render();
  
  try {
    // 判断是否是期权
    const isOption = selectedOptionData.strike !== undefined;
    let stockData: StockData;
    
    if (isOption) {
      // 期权：使用 Polygon.io API 获取期权价格
      try {
        const response = await fetch(`/api/option/${encodeURIComponent(symbol)}`);
        if (response.ok) {
          const optionData = await response.json();
          stockData = {
            symbol: optionData.symbol,
            name: optionData.name,
            price: optionData.price,
            change: optionData.change,
            changePercent: optionData.changePercent
          };
        } else {
          // 如果期权数据获取失败，使用标的股票价格作为参考
          const underlying = symbol.match(/^[A-Z]+/)?.[0] || symbol;
          stockData = await fetchStockDataFromAPI(underlying);
          stockData.name = `${getStockDisplayName(underlying)} 期权`;
        }
      } catch {
        // 获取期权数据失败，使用标的股票价格
        const underlying = symbol.match(/^[A-Z]+/)?.[0] || symbol;
        stockData = await fetchStockDataFromAPI(underlying);
        stockData.name = `${getStockDisplayName(underlying)} 期权`;
      }
    } else {
      stockData = await fetchStockDataFromAPI(symbol);
    }
    
    const underlying = symbol.match(/^[A-Z]+/)?.[0] || symbol;
    const pick =
      pendingSearchPick && pendingSearchPick.symbol === symbol ? pendingSearchPick : null;

    const newStock: Stock = {
      symbol,
      name: isOption
        ? `${getStockDisplayName(underlying)} 期权`
        : (pick?.name ?? stockData.name ?? symbol),
      shares,
      targetPrice,
      avgCost: undefined,
      signal: 'hold',
      currentPrice: stockData.price || 0,
      position: 0,
      weight: 0,
      type: isOption ? 'option' : 'stock',
      optionStrike: selectedOptionData.strike,
      optionExpiry: selectedOptionData.expiry,
      optionType: selectedOptionData.type,
      instrumentType: isOption ? undefined : pick?.instrumentType
    };

    pendingSearchPick = null;

    state.stocks.push(newStock);
    
    // 清空输入框
    symbolInput.value = '';
    sharesInput.value = '';
    targetPriceInput.value = '';
    selectedOptionData = {};
    clearOptionInfoDisplay();
    
    calculateTotals();
    renderSuccess(`已添加 ${symbol}`);
  } catch (error) {
    renderError('添加失败，请检查代码是否正确');
  } finally {
    state.loading = false;
    render();
    void refreshFinnhubCanonicalEquivalents();
  }
}

function setTableSort(key: TableSortKey): void {
  if (tableSortKey === key) {
    tableSortDir = tableSortDir === 1 ? -1 : 1;
  } else {
    tableSortKey = key;
    tableSortDir = 1;
  }
  render();
}

// 函数：更新持仓字段（数值、目标价、成本、评级等）
function updateStock(symbol: string, field: string, value: string | number): void {
  const stock = state.stocks.find(s => s.symbol === symbol);
  if (!stock) return;

  if (field === 'signal') {
    stock.signal = value as TradeSignal;
  } else if (field === 'targetPrice') {
    const t = String(value).trim();
    if (t === '') {
      stock.targetPrice = undefined;
    } else {
      const n = parseFloat(t);
      stock.targetPrice = Number.isFinite(n) ? Math.round(n * 100) / 100 : undefined;
    }
  } else if (field === 'avgCost') {
    const t = String(value).trim();
    if (t === '') {
      stock.avgCost = undefined;
    } else {
      const n = parseFloat(t);
      stock.avgCost = Number.isFinite(n) ? Math.round(n * 100) / 100 : undefined;
    }
  } else if (field === 'shares') {
    stock.shares = typeof value === 'number' ? value : parseFloat(String(value)) || 0;
  } else {
    (stock as unknown as Record<string, string | number>)[field] = value;
  }
  calculateTotals();
  render();
}

// 函数：渲染应用
function render(): void {
  const app = document.getElementById('app');
  if (!app) return;

  app.innerHTML = `
    <div class="container">
      <div class="header" style="text-align: center; margin-bottom: 30px;">
          <h1>美股持仓管理</h1>
          <p>实时查询股票价格，计算持仓与仓位。持仓与交易记录保存在本机浏览器（localStorage）。</p>
      </div>
      
      <div class="card">
        <div class="input-section">
          <div class="input-group" style="position: relative; flex: 2; min-width: 200px;">
            <label for="symbol">搜索代码（可选，预填「新增交易」）</label>
            <input type="text" id="symbol" placeholder="股票 / 期权代码…" autocomplete="off" ${state.loading ? 'disabled' : ''} />
            <div id="stock-suggestions" class="suggestions-dropdown"></div>
          </div>
          <div class="input-actions" style="align-self: flex-end;">
            <button class="btn btn-secondary" onclick="updateStockPrices()" ${state.loading || state.stocks.length === 0 ? 'disabled' : ''}>
              ${state.loading ? '<span class="loading"></span>' : '刷新价格'}
            </button>
          </div>
          <div id="option-info" style="display: none; margin-top: 10px;"></div>
        </div>
        
        <div class="export-toolbar">
          <button class="btn btn-secondary" onclick="exportToJSON()" style="padding: 8px 16px; font-size: 0.85rem;" ${state.stocks.length === 0 && state.cash === 0 ? 'disabled' : ''}>
            导出 JSON
          </button>
          <button class="btn btn-secondary" onclick="exportToCSV()" style="padding: 8px 16px; font-size: 0.85rem;" ${state.stocks.length === 0 && state.cash === 0 ? 'disabled' : ''}>
            导出 CSV
          </button>
          <label class="btn btn-secondary" style="padding: 8px 16px; font-size: 0.85rem; cursor: pointer;">
            导入 JSON
            <input type="file" accept=".json" onchange="importFromJSON(event)" style="display: none;" />
          </label>
          <label class="btn btn-secondary" style="padding: 8px 16px; font-size: 0.85rem; cursor: pointer;">
            导入 CSV
            <input type="file" accept=".csv" onchange="importFromCSV(event)" style="display: none;" />
          </label>
        </div>
        
        ${renderTradePanel()}
          
          ${state.stocks.length === 0 ? `
          <div class="empty-state">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
            <h3>暂无持仓</h3>
            <p>请点击上方「新增买入」记录首笔买入，持仓将按交易自动汇总（FIFO 成本）。</p>
            <p style="font-size: 0.85rem; color: #888; margin-top: 8px;">期权格式示例: AAPL250530C150</p>
          </div>
        ` : `
          <div class="holdings-section-head" style="margin-bottom: 16px;">
            <h3 style="margin: 0;">持仓明细</h3>
            <p class="holdings-hint" style="margin: 8px 0 0 0; font-size: 0.82rem; color: #64748b;">持仓数据来自交易记录；股数与成本随买卖自动更新。可拖动「代码」合并分组。</p>
          </div>
          ${renderHoldingsColumnTogglePanel()}
          <div class="dashboard-summary-toggle-row">
            <label class="holdings-col-toggle-label">
              <input type="checkbox" ${dashboardSummaryVisible ? 'checked' : ''}
                     onchange="setDashboardSummaryVisible(this.checked)" />
              <span>显示顶部看板数据（总资产、市值、盈亏、现金）</span>
            </label>
          </div>
          ${
            dashboardSummaryVisible
              ? `
          <div class="summary" style="margin-bottom: 20px;">
            <div class="summary-card" style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);">
              <h3>总资产</h3>
              <div class="value">$${formatNumber(state.totalValue + state.cash)}</div>
            </div>
            <div class="summary-card" style="background: linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%);">
              <h3>股票市值</h3>
              <div class="value">$${formatNumber(state.stockMarketValue)}</div>
            </div>
            <div class="summary-card" style="background: linear-gradient(135deg, #a855f7 0%, #7c3aed 100%);">
              <h3>期权市值</h3>
              <div class="value">$${formatNumber(state.optionMarketValue)}</div>
            </div>
            <div class="summary-card" style="background: linear-gradient(135deg, #0d9488 0%, #0f766e 100%);">
              <h3>总盈亏</h3>
              <div class="value" style="font-size: 1.75rem;">${
                state.totalPnl === null
                  ? '<span style="opacity:0.85;">—</span>'
                  : formatTotalPnlSummaryHtml(state.totalPnl)
              }</div>
              <div style="font-size: 0.72rem; opacity: 0.92; margin-top: 6px;">${
                state.totalPnl === null
                  ? '填写「成本」后汇总'
                  : state.stocks.some(s => computeLinePnL(s) === null)
                    ? '未含未填成本行'
                    : '已填成本持仓合计'
              }</div>
            </div>
            <div class="summary-card">
              <h3>现金</h3>
              <div class="value" style="display: flex; align-items: center; gap: 4px;">
                <span style="font-size: 0.9rem;">$</span>
                <input type="number" value="${state.cash}" 
                       onchange="updateCash(parseFloat(this.value) || 0)" 
                       style="width: 140px; min-width: 120px; padding: 4px 10px; border: 1px solid rgba(255,255,255,0.3); border-radius: 6px; background: rgba(255,255,255,0.15); color: white; font-size: 1.1rem; font-weight: 600;"
                       step="0.01" min="0" />
              </div>
              <div style="font-size: 0.72rem; opacity: 0.95; margin-top: 6px;">
                占组合 ${formatPercent(state.totalValue + state.cash > 0 ? (state.cash / (state.totalValue + state.cash)) * 100 : 0)}
              </div>
            </div>
          </div>
          `
              : ''
          }
          
          <div class="table-container">
            <table class="holdings-table">
              <colgroup>
                <col class="holdings-col-type" />
                <col class="holdings-col-symbol" />
                <col class="holdings-col-shares" />
                <col class="holdings-col-cost" />
                <col class="holdings-col-price" />
                <col class="holdings-col-pnl" />
                <col class="holdings-col-pnl-pct" />
                <col class="holdings-col-pos" />
                <col class="holdings-col-weight" />
                <col class="holdings-col-target" />
                <col class="holdings-col-optinfo" />
                <col class="holdings-col-signal" />
                <col class="holdings-col-actions" />
              </colgroup>
              <thead>
                <tr>
                  <th class="${holdingsCellClass('type')}">类型</th>
                  <th class="${holdingsCellClass('symbol')}" style="cursor: pointer; user-select: none; white-space: nowrap;" onclick="setTableSort('symbol')" title="按标的代码排序">
                    代码${tableSortKey === 'symbol' ? (tableSortDir === 1 ? ' ▲' : ' ▼') : ''}
                  </th>
                  <th class="${holdingsCellClass('shares')}" title="多笔买入合计股数/张数，见「编辑」">股数</th>
                  <th class="${holdingsCellClass('cost')}" title="多笔买入的加权平均成本">成本</th>
                  <th class="${holdingsCellClass('price')}">现价</th>
                  <th class="${holdingsCellClass('pnl')}">盈亏</th>
                  <th class="${holdingsCellClass('pnlPct')}" title="(现价 − 成本) ÷ 成本">盈亏比例</th>
                  <th class="${holdingsCellClass('position')}">持仓</th>
                  <th class="${holdingsCellClass('weight')}" style="cursor: pointer; user-select: none; white-space: nowrap;" onclick="setTableSort('weight')" title="按同标的合计占总资产比例排序">
                    仓位 / 占比${tableSortKey === 'weight' ? (tableSortDir === 1 ? ' ▲' : ' ▼') : ''}
                  </th>
                  <th class="${holdingsCellClass('target')}">1y目标价</th>
                  <th class="${holdingsCellClass('optinfo')}">期权信息</th>
                  <th class="${holdingsCellClass('signal')}">打分</th>
                  <th class="${holdingsCellClass('actions')}">操作</th>
                </tr>
              </thead>
              <tbody>
                ${renderHoldingsTableBody()}
              </tbody>
            </table>
          </div>
        `}
        
        <!-- 交易历史记录弹窗 -->
        ${renderTradeHistoryModal()}
        
        <!-- 导入交易弹窗 -->
        ${renderImportTradeModal()}
        
        <!-- 编辑交易弹窗 -->
        ${renderEditTradeModal()}
        
        <!-- 交易表单弹窗 -->
        ${tradePanelOpen ? renderTradeForm() : ''}
      </div>
    </div>
  `;
  
  // 自动保存
  saveToStorage();
  
  // 每次渲染后重新设置下拉搜索事件
  setupStockSearchEvents();
  setupTradeFormSymbolSearchEvents();
}

// 初始化应用（本地持久化）
async function init(): Promise<void> {
  localStorage.removeItem('auth_token');
  loadPersistedPortfolio();
  loadPersistedTrades();
  migratePortfolioStocksToTradesIfNeeded();
  syncStocksFromTrades();
  loadPnlStatsOnStartup();
  render();
  void refreshFinnhubCanonicalEquivalents();
}

void init();

// 暴露全局函数供 HTML 调用
(window as any).addStock = addStock;
(window as any).removeStock = removeStock;
(window as any).updateStock = updateStock;
(window as any).updateStockPrices = updateStockPrices;
(window as any).updateCash = updateCash;
(window as any).refreshSingleStock = refreshSingleStock;
(window as any).setTableSort = setTableSort;
(window as any).symbolDragStart = symbolDragStart;
(window as any).symbolDragOver = symbolDragOver;
(window as any).symbolDragEnd = symbolDragEnd;
(window as any).symbolDropOnRow = symbolDropOnRow;
(window as any).clearGroupOverride = clearGroupOverride;
(window as any).selectStock = selectStock;
(window as any).exportToJSON = exportToJSON;
(window as any).exportToCSV = exportToCSV;
(window as any).importFromJSON = importFromJSON;
(window as any).importFromCSV = importFromCSV;
(window as any).highlightSuggestion = highlightSuggestion;
(window as any).highlightTradeFormSuggestion = highlightTradeFormSuggestion;
(window as any).pickTradeFormSymbol = pickTradeFormSymbol;
(window as any).openCostLotsEditor = openCostLotsEditor;
(window as any).setHoldingsColumnVisible = setHoldingsColumnVisible;
(window as any).setDashboardSummaryVisible = setDashboardSummaryVisible;
(window as any).openTradeForm = openTradeForm;
(window as any).openNewTradeForm = openNewTradeForm;
(window as any).closeTradeForm = closeTradeForm;
(window as any).setTradeType = setTradeType;
(window as any).submitTrade = submitTrade;
(window as any).handleDeleteTrade = handleDeleteTrade;
(window as any).refreshPnlStats = refreshPnlStats;
(window as any).setPnlQueryStartDate = setPnlQueryStartDate;
(window as any).setPnlQueryEndDate = setPnlQueryEndDate;
(window as any).resetPnlQuery = resetPnlQuery;
(window as any).openTradeHistoryModal = openTradeHistoryModal;
(window as any).closeTradeHistoryModal = closeTradeHistoryModal;
(window as any).setTradeHistoryFilter = setTradeHistoryFilter;
(window as any).resetTradeHistoryFilter = resetTradeHistoryFilter;
(window as any).setTradeHistoryPage = setTradeHistoryPage;
(window as any).setTradeHistoryPageSize = setTradeHistoryPageSize;
(window as any).openEditTradeModal = openEditTradeModal;
(window as any).closeEditTradeModal = closeEditTradeModal;
(window as any).submitEditTrade = submitEditTrade;
(window as any).exportTradesToCSV = exportTradesToCSV;
(window as any).exportTradesToJSON = exportTradesToJSON;
(window as any).openImportTradeModal = openImportTradeModal;
(window as any).closeImportTradeModal = closeImportTradeModal;
(window as any).handleMoomooTradeImport = handleMoomooTradeImport;
(window as any).handleBbaeTradeImport = handleBbaeTradeImport;
(window as any).handleTradeBackupImport = handleTradeBackupImport;
(window as any).confirmImportTrades = confirmImportTrades;

// 下拉搜索相关变量
let selectedIndex = -1;
/** 与当前下拉内容一致，供键盘上下键/回车使用（含 Finnhub 合并结果） */
let lastSearchSuggestions: SuggestionItem[] = [];
let searchDebounceId: ReturnType<typeof setTimeout> | null = null;

/** 新建交易弹窗内标的代码搜索（与顶栏搜索同逻辑，独立下拉避免与 #symbol 冲突） */
let tradeFormSearchDebounceId: ReturnType<typeof setTimeout> | null = null;
let lastTradeFormSearchSuggestions: SuggestionItem[] = [];
let tradeFormSuggestionSelectedIndex = -1;
/** 每次输入或选中一项后递增，用于丢弃已失效的异步搜索结果，避免选中后下拉又被打开 */
let tradeFormSymbolSearchSeq = 0;

// 函数：过滤股票
interface SuggestionItem {
  symbol: string;
  name: string;
  /** Symbol Search 返回的 type，如 ETP */
  instrumentType?: string;
  optionStrike?: number;
  optionExpiry?: string;
  optionType?: 'C' | 'P';
}

/** 仅当整段输入为完整期权码时返回一条建议；仅股票代码时返回空，不在此展示期权 */
function filterOptionPattern(query: string): SuggestionItem[] {
  if (!query.trim()) return [];

  const upperQuery = query.toUpperCase().trim();
  const results: SuggestionItem[] = [];

  const optionMatch = upperQuery.match(/^([A-Z]{1,5})(\d{6})([CP])(\d+(?:\.\d+)?)$/);
  if (optionMatch) {
    const [, symbol, expiry, type, strike] = optionMatch;
    const underlyingName = getStockDisplayName(symbol);
    const dateStr = `${expiry.slice(0, 2)}-${expiry.slice(2, 4)}-${expiry.slice(4, 6)}`;
    results.push({
      symbol: `${symbol}${expiry}${type}${strike}`,
      name: `${underlyingName} 期权 ${type === 'C' ? '看涨' : '看跌'} $${strike} ${dateStr}`,
      optionStrike: parseFloat(strike),
      optionExpiry: `20${dateStr}`,
      optionType: type as 'C' | 'P'
    });
  }

  return results;
}

async function fetchRemoteSymbolSearch(query: string): Promise<SuggestionItem[]> {
  const q = query.trim();
  if (q.length < 2) return [];
  try {
    const url = `/api/search?q=${encodeURIComponent(q)}&exchange=US`;
    const r = await fetch(url);
    if (!r.ok) return [];
    const data = (await r.json()) as {
      result?: Array<{ description?: string; symbol?: string; type?: string }>;
    };
    const raw = data.result;
    if (!Array.isArray(raw)) return [];

    const out: SuggestionItem[] = [];
    const seen = new Set<string>();
    for (const row of raw) {
      const sym = (row.symbol || '').trim().toUpperCase();
      if (!sym || seen.has(sym)) continue;
      const rowType = (row.type || '').trim().toUpperCase();
      // 下拉中期权只来自用户手输的完整格式行；search 返回的期权合约/Option 类型不显示
      if (rowType === 'OPTION' || isOptionSymbol(sym) || sym.startsWith('O:')) {
        continue;
      }
      seen.add(sym);
      const name = (row.description || sym).trim();
      const instrumentType = (row.type || '').trim() || undefined;
      out.push({ symbol: sym, name, instrumentType });
      if (out.length >= 12) break;
    }
    return out;
  } catch {
    return [];
  }
}

async function buildSearchSuggestions(query: string): Promise<SuggestionItem[]> {
  const optionExtras = filterOptionPattern(query);
  if (!query.trim()) return [];
  const remote = await fetchRemoteSymbolSearch(query);
  const seen = new Set<string>();
  const merged: SuggestionItem[] = [];

  // 仅使用 /api/search 返回的 description；另附完整期权码解析行（若有）
  for (const r of remote) {
    const k = r.symbol.toUpperCase();
    if (seen.has(k)) continue;
    seen.add(k);
    merged.push(r);
  }

  for (const item of optionExtras) {
    const k = item.symbol.toUpperCase();
    if (seen.has(k)) continue;
    seen.add(k);
    merged.push(item);
  }

  return merged.slice(0, 15);
}

// 函数：显示下拉建议
function showSuggestions(suggestions: SuggestionItem[]): void {
  const dropdown = document.getElementById('stock-suggestions');
  if (!dropdown) return;

  lastSearchSuggestions = suggestions;

  if (suggestions.length === 0) {
    dropdown.innerHTML = '<div class="no-results">输入股票代码或期权代码搜索<br><small style="color:#999">期权格式: AAPL250530C150</small></div>';
    dropdown.style.display = 'block';
    return;
  }

  dropdown.innerHTML = suggestions
    .map((item, index) => {
      const isOpt = item.optionStrike !== undefined;
      const handler = isOpt
        ? `selectStock(${JSON.stringify(item.symbol)}, ${String(item.optionStrike)}, ${JSON.stringify(item.optionExpiry ?? '')}, ${JSON.stringify(item.optionType ?? '')})`
        : `selectStock(${JSON.stringify(item.symbol)}, undefined, undefined, undefined, ${JSON.stringify(item.name)}, ${JSON.stringify(item.instrumentType ?? '')})`;
      return `
    <div class="suggestion-item ${index === selectedIndex ? 'selected' : ''} ${isOpt ? 'option-item' : ''}" 
         onclick="${escapeHtmlAttr(handler)}"
         onmouseenter="highlightSuggestion(${index})">
      <span class="suggestion-symbol">${escapeHtml(item.symbol)}</span>
      <span class="suggestion-name">${escapeHtml(item.name)}</span>
      ${isOpt ? '<span class="option-badge">期权</span>' : ''}
    </div>`;
    })
    .join('');

  dropdown.style.display = 'block';
  selectedIndex = -1;
}

// 函数：隐藏下拉建议
function hideSuggestions(): void {
  const dropdown = document.getElementById('stock-suggestions');
  if (dropdown) {
    dropdown.style.display = 'none';
  }
  selectedIndex = -1;
}

function hideTradeFormSuggestions(): void {
  const dropdown = document.getElementById('trade-stock-suggestions');
  if (dropdown) {
    dropdown.style.display = 'none';
  }
  tradeFormSuggestionSelectedIndex = -1;
}

function showTradeFormSuggestions(suggestions: SuggestionItem[]): void {
  const dropdown = document.getElementById('trade-stock-suggestions');
  if (!dropdown) return;

  lastTradeFormSearchSuggestions = suggestions;

  if (suggestions.length === 0) {
    dropdown.innerHTML =
      '<div class="no-results">输入股票代码或期权代码搜索<br><small style="color:#999">期权格式: AAPL250530C150</small></div>';
    dropdown.style.display = 'block';
    return;
  }

  dropdown.innerHTML = suggestions
    .map((item, index) => {
      const isOpt = item.optionStrike !== undefined;
      const handler = `pickTradeFormSymbol(${JSON.stringify(item.symbol)})`;
      return `
    <div class="suggestion-item ${index === tradeFormSuggestionSelectedIndex ? 'selected' : ''} ${isOpt ? 'option-item' : ''}"
         onclick="${escapeHtmlAttr(handler)}"
         onmouseenter="highlightTradeFormSuggestion(${index})">
      <span class="suggestion-symbol">${escapeHtml(item.symbol)}</span>
      <span class="suggestion-name">${escapeHtml(item.name)}</span>
      ${isOpt ? '<span class="option-badge">期权</span>' : ''}
    </div>`;
    })
    .join('');

  dropdown.style.display = 'block';
  tradeFormSuggestionSelectedIndex = -1;
}

// 函数：高亮建议项
function highlightSuggestion(index: number): void {
  const dropdown = document.getElementById('stock-suggestions');
  if (!dropdown) return;
  const items = dropdown.querySelectorAll('.suggestion-item');
  items.forEach((item, i) => {
    (item as HTMLElement).classList.toggle('selected', i === index);
  });
  selectedIndex = index;
}

function highlightTradeFormSuggestion(index: number): void {
  const dropdown = document.getElementById('trade-stock-suggestions');
  if (!dropdown) return;
  const items = dropdown.querySelectorAll('.suggestion-item');
  items.forEach((item, i) => {
    (item as HTMLElement).classList.toggle('selected', i === index);
  });
  tradeFormSuggestionSelectedIndex = index;
}

// 函数：选择股票
// 存储选中的期权信息
let selectedOptionData: { strike?: number; expiry?: string; type?: 'C' | 'P' } = {};

/** 从下拉选中正股/ETF 时暂存 Symbol Search 的 description 与 type，添加持仓时写入表格 */
let pendingSearchPick: { symbol: string; name: string; instrumentType?: string } | null = null;

function selectStock(
  symbol: string,
  strike?: number,
  expiry?: string,
  optionCp?: string,
  searchDescription?: string,
  searchInstrumentType?: string
): void {
  const input = document.getElementById('symbol') as HTMLInputElement;
  const sym = symbol.trim().toUpperCase();
  if (input) {
    input.value = sym;
  }

  const isOptionPick =
    strike !== undefined &&
    expiry !== undefined &&
    expiry !== '' &&
    optionCp !== undefined &&
    optionCp !== '';

  if (isOptionPick) {
    pendingSearchPick = null;
    selectedOptionData = {
      strike,
      expiry,
      type: optionCp as 'C' | 'P'
    };
    updateOptionInfoDisplay(symbol, strike, expiry, optionCp);
  } else {
    selectedOptionData = {};
    clearOptionInfoDisplay();
    if (searchDescription !== undefined && searchDescription !== '') {
      pendingSearchPick = {
        symbol: sym,
        name: searchDescription,
        instrumentType: searchInstrumentType || undefined
      };
    } else {
      pendingSearchPick = null;
    }
  }

  hideSuggestions();
}

/** 新建交易：从下拉选中标的，仅写入代码；名称在保存时用代码填充 */
function pickTradeFormSymbol(symbol: string): void {
  if (tradeFormSearchDebounceId !== null) {
    clearTimeout(tradeFormSearchDebounceId);
    tradeFormSearchDebounceId = null;
  }
  tradeFormSymbolSearchSeq++;
  lastTradeFormSearchSuggestions = [];
  tradeFormSuggestionSelectedIndex = -1;

  const sym = symbol.trim().toUpperCase();
  tradeFormSymbol = sym;
  tradeFormName = '';
  const symIn = document.getElementById('trade-symbol-input') as HTMLInputElement | null;
  if (symIn) symIn.value = sym;
  hideTradeFormSuggestions();
}

// 更新期权信息显示
function updateOptionInfoDisplay(symbol: string, strike: number, expiry: string, type: string): void {
  const container = document.getElementById('option-info');
  if (container) {
    const underlying = symbol.match(/^[A-Z]+/)?.[0] || symbol;
    const name = getStockDisplayName(underlying);
    container.innerHTML = `
      <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 12px; border-radius: 8px; color: white;">
        <div style="font-weight: 600; margin-bottom: 8px;">期权信息</div>
        <div style="font-size: 0.9rem;">标的: ${name}</div>
        <div style="font-size: 0.9rem;">类型: ${type === 'C' ? '看涨 (Call)' : '看跌 (Put)'}</div>
        <div style="font-size: 0.9rem;">执行价: $${strike}</div>
        <div style="font-size: 0.9rem;">到期日: ${expiry}</div>
      </div>
    `;
    container.style.display = 'block';
  }
}

// 清除期权信息显示
function clearOptionInfoDisplay(): void {
  const container = document.getElementById('option-info');
  if (container) {
    container.style.display = 'none';
    container.innerHTML = '';
  }
}

// 函数：设置下拉搜索事件
function setupStockSearchEvents(): void {
  const input = document.getElementById('symbol') as HTMLInputElement;
  const dropdown = document.getElementById('stock-suggestions');

  if (!input || !dropdown) return;

  const scheduleMerge = (value: string): void => {
    if (searchDebounceId) clearTimeout(searchDebounceId);
    const localPreview = filterOptionPattern(value);
    if (localPreview.length === 0 && value.trim().length >= 2) {
      lastSearchSuggestions = [];
      const dd = document.getElementById('stock-suggestions');
      if (dd) {
        dd.innerHTML = '<div class="no-results" style="color:#666">正在搜索…</div>';
        dd.style.display = 'block';
      }
    } else {
      lastSearchSuggestions = localPreview;
      showSuggestions(localPreview);
    }
    searchDebounceId = setTimeout(() => {
      searchDebounceId = null;
      void (async () => {
        const suggestions = await buildSearchSuggestions(value);
        if ((document.getElementById('symbol') as HTMLInputElement)?.value !== value) return;
        lastSearchSuggestions = suggestions;
        showSuggestions(suggestions);
      })();
    }, 280);
  };

  input.addEventListener('input', e => {
    const value = (e.target as HTMLInputElement).value;
    scheduleMerge(value);
  });

  input.addEventListener('focus', () => {
    const value = input.value;
    if (value) scheduleMerge(value);
  });

  input.addEventListener('keydown', e => {
    const suggestions = lastSearchSuggestions;
    if (suggestions.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      selectedIndex = Math.min(selectedIndex + 1, suggestions.length - 1);
      highlightSuggestion(selectedIndex);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      selectedIndex = Math.max(selectedIndex - 1, 0);
      highlightSuggestion(selectedIndex);
    } else if (e.key === 'Enter' && selectedIndex >= 0) {
      e.preventDefault();
      const item = suggestions[selectedIndex];
      if (item.optionStrike !== undefined) {
        selectStock(item.symbol, item.optionStrike, item.optionExpiry, item.optionType);
      } else {
        selectStock(item.symbol, undefined, undefined, undefined, item.name, item.instrumentType);
      }
    } else if (e.key === 'Escape') {
      hideSuggestions();
    }
  });

  document.addEventListener('click', e => {
    const target = e.target as HTMLElement;
    if (!target.closest('.input-group')) {
      hideSuggestions();
      hideTradeFormSuggestions();
    }
  });
}

function setupTradeFormSymbolSearchEvents(): void {
  const input = document.getElementById('trade-symbol-input') as HTMLInputElement | null;
  const dropdown = document.getElementById('trade-stock-suggestions');
  if (!input || !dropdown) return;

  const scheduleMerge = (value: string): void => {
    if (tradeFormSearchDebounceId) clearTimeout(tradeFormSearchDebounceId);
    tradeFormSymbolSearchSeq++;
    const requestSeq = tradeFormSymbolSearchSeq;
    const localPreview = filterOptionPattern(value);
    if (localPreview.length === 0 && value.trim().length >= 2) {
      lastTradeFormSearchSuggestions = [];
      dropdown.innerHTML = '<div class="no-results" style="color:#666">正在搜索…</div>';
      dropdown.style.display = 'block';
    } else {
      lastTradeFormSearchSuggestions = localPreview;
      showTradeFormSuggestions(localPreview);
    }
    tradeFormSearchDebounceId = setTimeout(() => {
      tradeFormSearchDebounceId = null;
      void (async () => {
        const suggestions = await buildSearchSuggestions(value);
        if (requestSeq !== tradeFormSymbolSearchSeq) return;
        if (input.value !== value) return;
        lastTradeFormSearchSuggestions = suggestions;
        showTradeFormSuggestions(suggestions);
      })();
    }, 280);
  };

  input.addEventListener('input', (e) => {
    const value = (e.target as HTMLInputElement).value;
    scheduleMerge(value);
  });

  input.addEventListener('focus', () => {
    const value = input.value;
    if (value) scheduleMerge(value);
  });

  input.addEventListener('keydown', (e) => {
    const suggestions = lastTradeFormSearchSuggestions;
    if (e.key === 'Escape') {
      hideTradeFormSuggestions();
      return;
    }
    if (suggestions.length === 0) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      tradeFormSuggestionSelectedIndex = Math.min(
        tradeFormSuggestionSelectedIndex + 1,
        suggestions.length - 1
      );
      highlightTradeFormSuggestion(tradeFormSuggestionSelectedIndex);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      tradeFormSuggestionSelectedIndex = Math.max(tradeFormSuggestionSelectedIndex - 1, 0);
      highlightTradeFormSuggestion(tradeFormSuggestionSelectedIndex);
    } else if (e.key === 'Enter' && tradeFormSuggestionSelectedIndex >= 0) {
      e.preventDefault();
      const item = suggestions[tradeFormSuggestionSelectedIndex];
      pickTradeFormSymbol(item.symbol);
    }
  });
}
