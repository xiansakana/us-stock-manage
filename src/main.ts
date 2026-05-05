// 类型定义
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

// 导出数据结构
interface ExportData {
  version: string;
  exportDate: string;
  cash: number;
  stocks: Stock[];
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
  error: ''
};

/** 当前登录用户名；null 表示未登录，仅展示登录/注册页 */
let sessionUsername: string | null = null;
let authPanelTab: 'login' | 'register' = 'login';

/** 表格标的分组排序：代码=标的字母序，仓位=品类占组合%（dir：1 升序，-1 降序） */
type TableSortKey = 'symbol' | 'weight';
let tableSortKey: TableSortKey = 'weight';
let tableSortDir: 1 | -1 = -1;

// Alpha Vantage API
const ALPHA_VANTAGE_API = 'https://www.alphavantage.co/query';
const ALPHA_VANTAGE_API_KEY = 'DU6YOC69XS1OR37G';

/** 无单独名称库时仅展示代码（名称以持仓/接口中的字段为准） */
function getStockDisplayName(ticker: string): string {
  return ticker.trim().toUpperCase();
}

const FINNHUB_EQ_LS_KEY = 'portfolioFinnhubUnderlyingEq';

/** 旧版浏览器本地持仓键；启动时若服务端无数据则迁移一次并删除 */
const LS_PORTFOLIO_KEY = 'stockPortfolio';

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
      const full = sym.match(/^([A-Z]+)\d{6}[CP]\d+$/i);
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
  return /^[A-Z]+\d{6}[CP]\d+$/i.test(symbol.trim());
}

/** 从合约/代码得到原始标的 ticker（未合并） */
function extractRawTickerForStock(stock: Stock): string {
  const sym = stock.symbol.trim().toUpperCase();
  if (stock.type === 'option' || isOptionSymbol(sym)) {
    const full = sym.match(/^([A-Z]+)\d{6}[CP]\d+$/i);
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
  document.getElementById('cost-lots-modal-root')?.remove();

  const stock = state.stocks.find(s => s.symbol === symbol);
  if (!stock) return;

  const isOpt = stock.type === 'option' || isOptionSymbol(stock.symbol);
  const unitLabel = isOpt ? '数量（张）' : '股数';
  const costLabel = isOpt ? '每份合约成本 ($)' : '每股成本 ($)';

  let lots: CostLot[] =
    stock.costLots && stock.costLots.length > 0
      ? stock.costLots.map(l => ({ shares: l.shares, costPerShare: l.costPerShare }))
      : [{ shares: stock.shares || 0, costPerShare: stock.avgCost ?? 0 }];

  const root = document.createElement('div');
  root.id = 'cost-lots-modal-root';
  root.style.cssText =
    'position:fixed;inset:0;background:rgba(15,23,42,0.5);z-index:10000;display:flex;align-items:center;justify-content:center;padding:16px;';

  function redraw(): void {
    const tbody = root.querySelector('#cost-lots-modal-tbody');
    if (tbody) tbody.innerHTML = formatCostLotsModalRows(lots);
    bindLotEvents();
  }

  function bindLotEvents(): void {
    root.querySelectorAll('.lot-remove-btn').forEach(btn => {
      btn.addEventListener('click', e => {
        const tr = (e.target as HTMLElement).closest('tr');
        const idx = tr ? parseInt(tr.getAttribute('data-lot-index') || '-1', 10) : -1;
        if (idx < 0) return;
        lots = lots.filter((_, i) => i !== idx);
        if (lots.length === 0) lots = [{ shares: 0, costPerShare: 0 }];
        redraw();
      });
    });
  }

  root.innerHTML = `
    <div style="background:#fff;border-radius:16px;max-width:520px;width:100%;box-shadow:0 25px 50px -12px rgba(0,0,0,0.25);overflow:hidden;">
      <div style="padding:18px 20px;border-bottom:1px solid #e5e7eb;">
        <h2 style="margin:0;font-size:1.15rem;color:#0f172a;">编辑买入明细 · ${escapeHtml(symbol)}</h2>
        <p style="margin:8px 0 0 0;font-size:0.82rem;color:#64748b;">保存后列表中的股数与成本为<strong>合计股数</strong>与<strong>加权平均成本</strong>。</p>
      </div>
      <div style="padding:16px 20px;">
        <table style="width:100%;border-collapse:collapse;font-size:0.9rem;">
          <thead>
            <tr style="background:linear-gradient(135deg,#475569 0%,#334155 100%);color:#fff;text-align:left;">
              <th style="padding:10px 12px;font-weight:600;border-radius:10px 0 0 0;">${unitLabel}</th>
              <th style="padding:10px 12px;font-weight:600;">${costLabel}</th>
              <th style="padding:10px 12px;width:72px;border-radius:0 10px 0 0;"></th>
            </tr>
          </thead>
          <tbody id="cost-lots-modal-tbody">${formatCostLotsModalRows(lots)}</tbody>
        </table>
        <button type="button" id="cost-lots-add-row" class="btn btn-secondary" style="margin-top:12px;padding:8px 14px;font-size:0.85rem;">+ 添加一笔</button>
      </div>
      <div style="padding:14px 20px;border-top:1px solid #e5e7eb;display:flex;justify-content:flex-end;gap:10px;background:#f8fafc;">
        <button type="button" id="cost-lots-cancel" class="btn btn-secondary" style="padding:8px 18px;">取消</button>
        <button type="button" id="cost-lots-save" class="btn btn-primary" style="padding:8px 18px;">保存</button>
      </div>
    </div>
  `;

  document.body.appendChild(root);
  bindLotEvents();

  root.addEventListener('click', e => {
    if (e.target === root) root.remove();
  });

  root.querySelector('#cost-lots-add-row')?.addEventListener('click', () => {
    lots.push({ shares: 0, costPerShare: 0 });
    redraw();
  });

  root.querySelector('#cost-lots-cancel')?.addEventListener('click', () => root.remove());

  root.querySelector('#cost-lots-save')?.addEventListener('click', () => {
    const tbody = root.querySelector('#cost-lots-modal-tbody');
    if (!tbody || !stock) return;
    const next: CostLot[] = [];
    tbody.querySelectorAll('tr').forEach(tr => {
      const sh = parseFloat((tr.querySelector('.lot-shares-input') as HTMLInputElement)?.value || '0') || 0;
      const c = parseFloat((tr.querySelector('.lot-cost-input') as HTMLInputElement)?.value || '0') || 0;
      if (sh > 0) next.push({ shares: sh, costPerShare: c });
    });
    stock.costLots = next.length > 0 ? next : undefined;
    syncStockCostFromLots(stock);
    root.remove();
    calculateTotals();
    saveToStorage();
    render();
    renderSuccess(`已更新 ${symbol} 持仓成本`);
  });
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

/** 防抖写入服务端按用户分文件（需登录 Cookie） */
function saveToStorage(): void {
  if (!sessionUsername) return;
  const data = buildPortfolioPayload();
  if (persistDebounceId !== null) clearTimeout(persistDebounceId);
  persistDebounceId = setTimeout(() => {
    persistDebounceId = null;
    void (async () => {
      try {
        const res = await fetch('/api/portfolio', {
          method: 'PUT',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data)
        });
        if (res.status === 401) {
          sessionUsername = null;
          state.stocks = [];
          state.cash = 0;
          calculateTotals();
          render();
          return;
        }
        if (!res.ok) console.error('同步到服务器失败:', res.status);
      } catch (e) {
        console.error('同步到服务器失败:', e);
      }
    })();
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

async function loadPortfolioOnStartup(): Promise<void> {
  if (!sessionUsername) return;
  try {
    const res = await fetch('/api/portfolio', { credentials: 'include' });
    if (res.status === 401) {
      sessionUsername = null;
      return;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const parsed = (await res.json()) as { stocks?: unknown; cash?: unknown };
    const stocksArr = Array.isArray(parsed.stocks) ? parsed.stocks : [];
    const cashNum = typeof parsed.cash === 'number' && Number.isFinite(parsed.cash) ? parsed.cash : 0;
    const hasServerData = stocksArr.length > 0 || cashNum !== 0;
    if (hasServerData) {
      applyPortfolioFromParsed({ stocks: stocksArr, cash: cashNum });
      return;
    }
  } catch (e) {
    console.warn('从服务器加载持仓失败:', e);
  }
  try {
    const raw = localStorage.getItem(LS_PORTFOLIO_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as { stocks?: unknown; cash?: unknown };
    if (!Array.isArray(parsed.stocks) || parsed.stocks.length === 0) return;
    applyPortfolioFromParsed({ stocks: parsed.stocks, cash: parsed.cash });
    localStorage.removeItem(LS_PORTFOLIO_KEY);
    await fetch('/api/portfolio', {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildPortfolioPayload())
    }).catch(() => {});
  } catch (e) {
    console.error('读取本地旧持仓失败:', e);
  }
}

async function refreshSession(): Promise<void> {
  try {
    const r = await fetch('/api/auth/me', { credentials: 'include' });
    if (r.ok) {
      const j = (await r.json()) as { username?: string };
      sessionUsername = typeof j.username === 'string' ? j.username : null;
    } else {
      sessionUsername = null;
    }
  } catch {
    sessionUsername = null;
  }
}

function renderAuthScreen(): string {
  const tab = authPanelTab;
  const loginForm = `
    <form onsubmit="event.preventDefault(); submitLoginForm(); return false;">
      <div class="input-group" style="margin-bottom:14px;">
        <label for="auth-user">用户名</label>
        <input type="text" id="auth-user" autocomplete="username" required maxlength="32" pattern="[a-zA-Z0-9_]{3,32}" placeholder="3–32 位字母、数字或下划线" />
      </div>
      <div class="input-group" style="margin-bottom:18px;">
        <label for="auth-pass">密码</label>
        <input type="password" id="auth-pass" autocomplete="current-password" required minlength="8" maxlength="128" placeholder="至少 8 位" />
      </div>
      <button type="submit" class="btn btn-primary" style="width:100%;">登录</button>
    </form>
  `;
  const registerForm = `
    <form onsubmit="event.preventDefault(); submitRegisterForm(); return false;">
      <div class="input-group" style="margin-bottom:14px;">
        <label for="auth-user">用户名</label>
        <input type="text" id="auth-user" autocomplete="username" required maxlength="32" pattern="[a-zA-Z0-9_]{3,32}" placeholder="3–32 位字母、数字或下划线" />
      </div>
      <div class="input-group" style="margin-bottom:18px;">
        <label for="auth-pass">密码</label>
        <input type="password" id="auth-pass" autocomplete="new-password" required minlength="8" maxlength="128" placeholder="至少 8 位" />
      </div>
      <button type="submit" class="btn btn-primary" style="width:100%;">注册并登录</button>
    </form>
  `;
  return `
    <div class="container">
      <div class="header">
        <h1>美股持仓管理</h1>
        <p>登录后持仓保存在服务器；不同账户数据隔离</p>
      </div>
      <div class="card" style="max-width: 440px; margin: 0 auto;">
        <div style="display:flex; gap:10px; margin-bottom: 22px;">
          <button type="button" class="btn ${tab === 'login' ? 'btn-primary' : 'btn-secondary'}" onclick="switchAuthTab('login')" style="flex:1;">登录</button>
          <button type="button" class="btn ${tab === 'register' ? 'btn-primary' : 'btn-secondary'}" onclick="switchAuthTab('register')" style="flex:1;">注册</button>
        </div>
        ${tab === 'login' ? loginForm : registerForm}
        <p id="auth-msg" style="margin-top:14px;font-size:0.9rem;min-height:1.3em;"></p>
      </div>
    </div>
  `;
}

function switchAuthTab(tab: 'login' | 'register'): void {
  authPanelTab = tab;
  render();
}

async function submitLoginForm(): Promise<void> {
  const userEl = document.getElementById('auth-user') as HTMLInputElement | null;
  const passEl = document.getElementById('auth-pass') as HTMLInputElement | null;
  const msg = document.getElementById('auth-msg');
  const u = userEl?.value?.trim() ?? '';
  const p = passEl?.value ?? '';
  if (!u || !p) {
    if (msg) {
      msg.style.color = '#b91c1c';
      msg.textContent = '请填写用户名和密码';
    }
    return;
  }
  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: u, password: p })
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string; username?: string };
    if (!res.ok) {
      if (msg) {
        msg.style.color = '#b91c1c';
        msg.textContent = data.error || '登录失败';
      }
      return;
    }
    sessionUsername = typeof data.username === 'string' ? data.username : u;
    await loadPortfolioOnStartup();
    if (msg) {
      msg.textContent = '';
      msg.style.color = '';
    }
    render();
    void refreshFinnhubCanonicalEquivalents();
  } catch {
    if (msg) {
      msg.style.color = '#b91c1c';
      msg.textContent = '网络错误，请稍后重试';
    }
  }
}

async function submitRegisterForm(): Promise<void> {
  const userEl = document.getElementById('auth-user') as HTMLInputElement | null;
  const passEl = document.getElementById('auth-pass') as HTMLInputElement | null;
  const msg = document.getElementById('auth-msg');
  const u = userEl?.value?.trim() ?? '';
  const p = passEl?.value ?? '';
  if (!u || !p) {
    if (msg) {
      msg.style.color = '#b91c1c';
      msg.textContent = '请填写用户名和密码';
    }
    return;
  }
  try {
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: u, password: p })
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string; username?: string };
    if (!res.ok) {
      if (msg) {
        msg.style.color = '#b91c1c';
        msg.textContent = data.error || '注册失败';
      }
      return;
    }
    sessionUsername = typeof data.username === 'string' ? data.username : u;
    await loadPortfolioOnStartup();
    if (msg) {
      msg.textContent = '';
      msg.style.color = '';
    }
    render();
    void refreshFinnhubCanonicalEquivalents();
  } catch {
    if (msg) {
      msg.style.color = '#b91c1c';
      msg.textContent = '网络错误，请稍后重试';
    }
  }
}

async function logoutApp(): Promise<void> {
  try {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
  } catch {
    /* ignore */
  }
  sessionUsername = null;
  state.stocks = [];
  state.cash = 0;
  calculateTotals();
  render();
}

// 导出数据为 JSON 文件
function exportToJSON(): void {
  const exportData: ExportData = {
    version: '1.0',
    exportDate: new Date().toISOString(),
    cash: state.cash,
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

// 从 JSON 文件导入
function importFromJSON(event: Event): void {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const content = e.target?.result as string;
      const data = JSON.parse(content) as ExportData;
      
      if (data.stocks && Array.isArray(data.stocks)) {
        state.stocks = data.stocks.map(s => {
          const sym = s.symbol.toUpperCase();
          const opt = s.type === 'option' || isOptionSymbol(sym);
          return {
            ...s,
            symbol: sym,
            type: s.type ?? (isOptionSymbol(sym) ? 'option' : 'stock'),
            // 期权：股数 × 现价 × 100
            position: s.shares * s.currentPrice * (opt ? 100 : 1),
            weight: 0
          };
        });
        state.cash = data.cash || 0;
        calculateTotals();
        saveToStorage();
        render();

        void refreshFinnhubCanonicalEquivalents();

        // 如果有股票，自动更新价格
        if (state.stocks.length > 0) {
          setTimeout(() => updateStockPrices(), 500);
        }

        renderSuccess(`成功导入 ${state.stocks.length} 条记录`);
      } else {
        renderError('无效的数据格式');
      }
    } catch (error) {
      renderError('导入失败：文件格式错误');
    }
  };
  reader.readAsText(file);

  // 清空 input 以允许再次选择同一文件
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

      const weightRowspanTd =
        i === 0
          ? `<td rowspan="${items.length}" style="font-weight: 600; color: #4338ca; vertical-align: middle; text-align: center;" title="同标的合并持仓市值 ÷ 总资产（含现金）">${formatPercent(stock.weight)}</td>`
          : '';

      rows.push(`
        <tr${trStyles ? ` style="${trStyles}"` : ''}>
          <td>
            ${stock.type === 'option'
              ? '<span style="background: #667eea; color: white; padding: 2px 8px; border-radius: 4px; font-size: 0.75rem;">期权</span>'
              : stock.instrumentType
                ? `<span style="background: #0ea5e9; color: white; padding: 2px 8px; border-radius: 4px; font-size: 0.75rem;">${escapeHtml(stock.instrumentType)}</span>`
                : '<span style="background: #10b981; color: white; padding: 2px 8px; border-radius: 4px; font-size: 0.75rem;">股票</span>'}
          </td>
          <td style="font-weight: 600; color: #667eea; cursor: grab;"
              draggable="true"
              ondragstart="symbolDragStart(event, '${stock.symbol.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}')"
              ondragover="symbolDragOver(event)"
              ondrop="symbolDropOnRow(event, '${stock.symbol.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}')"
              ondragend="symbolDragEnd()"
              title="拖动代码到另一条持仓，合并为同一标的">
            <span style="display: inline-flex; align-items: center; gap: 4px; flex-wrap: wrap;">
              <span>${stock.symbol}</span>
              ${stock.groupWith
                ? `<button type="button" onclick="clearGroupOverride('${stock.symbol.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}')" title="恢复自动分组" style="padding: 0 5px; font-size: 0.65rem; border: 1px solid #e5e7eb; border-radius: 4px; background: #fff; cursor: pointer; color: #64748b;">↺</button>`
                : ''}
            </span>
          </td>
          <td>${escapeHtml(stock.name)}</td>
          <td style="text-align: center; vertical-align: middle;">
            <div style="font-weight: 600;">${formatNumber(stock.shares)}</div>
            ${
              stock.costLots && stock.costLots.length > 1
                ? `<div style="font-size: 0.65rem; color: #64748b; margin-top: 2px;">${stock.costLots.length} 笔合计</div>`
                : ''
            }
          </td>
          <td style="text-align: center; vertical-align: middle;">
            <div style="font-weight: 600;">${
              stock.avgCost !== undefined && stock.avgCost !== null && !Number.isNaN(Number(stock.avgCost))
                ? `$${formatNumber(stock.avgCost)}`
                : '—'
            }</div>
            ${
              stock.costLots && stock.costLots.length > 1
                ? `<div style="font-size: 0.65rem; color: #94a3b8; margin-top: 2px;">加权平均</div>`
                : ''
            }
          </td>
          <td style="font-weight: 600;">
            <span id="price-${stock.symbol}">$${formatNumber(stock.currentPrice)}</span>
            <button type="button" onclick="refreshSingleStock('${stock.symbol}')" 
                    style="margin-left: 4px; padding: 2px 6px; font-size: 0.7rem; background: #f3f4f6; border: 1px solid #d1d5db; border-radius: 4px; cursor: pointer;">
              ↻
            </button>
          </td>
          <td style="font-size: 0.9rem;">${formatPnLCell(pnl)}</td>
          <td style="font-size: 0.9rem;">${formatPnLPercentCell(computeLinePnLPercent(stock))}</td>
          <td style="font-weight: 600; color: #059669;" id="position-${stock.symbol}">$${formatNumber(stock.position)}</td>
          ${weightRowspanTd}
          <td>
            <input type="number" value="${formatTargetInputValue(stock.targetPrice)}" placeholder="—"
                   onchange="updateStock('${stock.symbol}', 'targetPrice', this.value)" 
                   style="width: 88px; padding: 6px; border: 1px solid #e5e7eb; border-radius: 6px; text-align: center;"
                   step="0.01" min="0" />
          </td>
          <td style="font-size: 0.8rem; color: #666;">
            ${stock.type === 'option' && stock.optionStrike
              ? `${stock.optionType === 'C' ? 'Call' : 'Put'} $${stock.optionStrike}<br/><span style="color: #999;">${stock.optionExpiry || ''}</span>`
              : '-'}
          </td>
          <td>
            <select onchange="updateStock('${stock.symbol}', 'signal', this.value)"
                    style="padding: 6px 8px; border: 1px solid #e5e7eb; border-radius: 6px; font-size: 0.85rem; max-width: 88px;">
              <option value="buy" ${sig === 'buy' ? 'selected' : ''}>买入</option>
              <option value="hold" ${sig === 'hold' ? 'selected' : ''}>持有</option>
              <option value="sell" ${sig === 'sell' ? 'selected' : ''}>卖出</option>
            </select>
          </td>
          <td class="holdings-actions-cell">
            <div class="holdings-actions-btns">
              <button type="button" class="btn btn-secondary holdings-action-btn" title="编辑成本" aria-label="编辑成本" onclick="openCostLotsEditor('${stock.symbol.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}')">✎</button>
              <button type="button" class="btn btn-danger holdings-action-btn" title="移除持仓" aria-label="移除持仓" onclick="removeStock('${stock.symbol.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}')">✕</button>
            </div>
          </td>
        </tr>
      `);
    }
  }

  rows.push(`
    <tr style="background: rgba(234, 179, 8, 0.12);">
      <td><span style="background: #eab308; color: white; padding: 2px 8px; border-radius: 4px; font-size: 0.75rem;">现金</span></td>
      <td style="font-weight: 600; color: #a16207;">CASH</td>
      <td style="color: #713f12;">现金</td>
      <td style="color: #94a3b8;">—</td>
      <td style="color: #94a3b8;">—</td>
      <td style="color: #94a3b8;">—</td>
      <td style="color: #94a3b8;">—</td>
      <td style="color: #94a3b8;">—</td>
      <td style="font-weight: 700; color: #0f766e;">$${formatNumber(state.cash)}</td>
      <td style="font-weight: 700; color: #4338ca;">${formatPercent(cashWeightPct)}</td>
      <td style="color: #94a3b8;">—</td>
      <td style="color: #94a3b8;">—</td>
      <td style="color: #94a3b8;">—</td>
      <td style="color: #94a3b8;">—</td>
      <td style="color: #94a3b8;">—</td>
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

// 函数：移除股票
function removeStock(symbol: string): void {
  state.stocks = state.stocks.filter(s => s.symbol !== symbol);
  calculateTotals();
  render();
  renderSuccess(`已移除 ${symbol}`);
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

  if (!sessionUsername) {
    app.innerHTML = renderAuthScreen();
    return;
  }

  app.innerHTML = `
    <div class="container">
      <div class="header" style="display: flex; flex-wrap: wrap; align-items: center; justify-content: center; gap: 16px; margin-bottom: 30px;">
        <div style="text-align: center; flex: 1; min-width: 220px;">
          <h1>美股持仓管理</h1>
          <p>实时查询股票价格，计算持仓和仓位</p>
        </div>
        <div style="display: flex; align-items: center; gap: 10px;">
          <span style="color: white; opacity: 0.92; font-size: 0.95rem;">${sessionUsername}</span>
          <button type="button" class="btn btn-secondary" onclick="logoutApp()" style="padding: 8px 16px; font-size: 0.9rem;">退出</button>
        </div>
      </div>
      
      <div class="card">
        <div class="input-section">
          <div class="input-group" style="position: relative;">
            <label for="symbol">股票代码</label>
            <input type="text" id="symbol" placeholder="输入股票代码搜索..." autocomplete="off" ${state.loading ? 'disabled' : ''} />
            <div id="stock-suggestions" class="suggestions-dropdown"></div>
          </div>
          <div class="input-group">
            <label for="shares">股数</label>
            <input type="number" id="shares" placeholder="持有股数" step="0.01" min="0" ${state.loading ? 'disabled' : ''} />
          </div>
          <div class="input-group">
            <label for="targetPrice">1年目标价</label>
            <input type="number" id="targetPrice" placeholder="可选" step="0.01" min="0" ${state.loading ? 'disabled' : ''} />
          </div>
          <div class="input-actions">
            <button class="btn btn-primary" onclick="addStock()" ${state.loading ? 'disabled' : ''}>
              ${state.loading ? '<span class="loading"></span>' : '添加'}
            </button>
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
        
        ${state.stocks.length === 0 ? `
          <div class="empty-state">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
            <h3>暂无持仓</h3>
            <p>在上方输入股票代码或期权代码开始添加</p>
            <p style="font-size: 0.85rem; color: #888; margin-top: 8px;">期权格式: AAPL250530C150</p>
          </div>
        ` : `
          <div class="holdings-section-head" style="margin-bottom: 16px;">
            <h3 style="margin: 0;">持仓明细</h3>
            <p class="holdings-hint" style="margin: 8px 0 0 0; font-size: 0.82rem; color: #64748b;">拖动「代码」列到另一条持仓，即可合并到同一标的；点击代码旁 ↺ 恢复自动分组。</p>
          </div>
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
                       style="width: 90px; padding: 4px 6px; border: 1px solid rgba(255,255,255,0.3); border-radius: 6px; background: rgba(255,255,255,0.15); color: white; font-size: 1.1rem; font-weight: 600;"
                       step="0.01" min="0" />
              </div>
              <div style="font-size: 0.72rem; opacity: 0.95; margin-top: 6px;">
                占组合 ${formatPercent(state.totalValue + state.cash > 0 ? (state.cash / (state.totalValue + state.cash)) * 100 : 0)}
              </div>
            </div>
          </div>
          
          <div class="table-container">
            <table class="holdings-table">
              <colgroup>
                <col class="holdings-col-type" />
                <col class="holdings-col-symbol" />
                <col class="holdings-col-name" />
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
                  <th>类型</th>
                  <th style="cursor: pointer; user-select: none; white-space: nowrap;" onclick="setTableSort('symbol')" title="按标的代码排序">
                    代码${tableSortKey === 'symbol' ? (tableSortDir === 1 ? ' ▲' : ' ▼') : ''}
                  </th>
                  <th>名称</th>
                  <th title="多笔买入合计股数/张数，见「编辑」">股数</th>
                  <th title="多笔买入的加权平均成本">成本</th>
                  <th>现价</th>
                  <th>盈亏</th>
                  <th title="(现价 − 成本) ÷ 成本">盈亏比例</th>
                  <th>持仓</th>
                  <th style="cursor: pointer; user-select: none; white-space: nowrap;" onclick="setTableSort('weight')" title="按同标的合计占总资产比例排序">
                    仓位 / 占比${tableSortKey === 'weight' ? (tableSortDir === 1 ? ' ▲' : ' ▼') : ''}
                  </th>
                  <th>1y目标价</th>
                  <th>期权信息</th>
                  <th>打分</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                ${renderHoldingsTableBody()}
              </tbody>
            </table>
          </div>
        `}
      </div>
    </div>
  `;
  
  // 自动保存
  saveToStorage();
  
  // 每次渲染后重新设置下拉搜索事件
  setupStockSearchEvents();
}

// 初始化应用（会话 → 持仓；未登录仅展示登录页）
async function init(): Promise<void> {
  await refreshSession();
  if (sessionUsername) {
    await loadPortfolioOnStartup();
  }
  render();
  if (sessionUsername) {
    void refreshFinnhubCanonicalEquivalents();
  }
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
(window as any).openCostLotsEditor = openCostLotsEditor;
(window as any).switchAuthTab = switchAuthTab;
(window as any).submitLoginForm = submitLoginForm;
(window as any).submitRegisterForm = submitRegisterForm;
(window as any).logoutApp = logoutApp;

// 下拉搜索相关变量
let selectedIndex = -1;
/** 与当前下拉内容一致，供键盘上下键/回车使用（含 Finnhub 合并结果） */
let lastSearchSuggestions: SuggestionItem[] = [];
let searchDebounceId: ReturnType<typeof setTimeout> | null = null;

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

  const optionMatch = upperQuery.match(/^([A-Z]{1,5})(\d{6})([CP])(\d+)$/);
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

// 函数：高亮建议项
function highlightSuggestion(index: number): void {
  const items = document.querySelectorAll('.suggestion-item');
  items.forEach((item, i) => {
    (item as HTMLElement).classList.toggle('selected', i === index);
  });
  selectedIndex = index;
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

  const sharesInput = document.getElementById('shares') as HTMLInputElement;
  if (sharesInput) {
    sharesInput.focus();
  }
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
    }
  });
}
