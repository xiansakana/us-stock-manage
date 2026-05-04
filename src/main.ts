// 类型定义
interface Stock {
  symbol: string;
  name: string;
  shares: number;
  targetPrice: number;
  currentPrice: number;
  position: number;
  weight: number;
}

interface AlphaVantageGlobalQuote {
  'Global Quote': {
    '05. price': string;
    '09. change': string;
    '10. change percent': string;
  };
}

interface AppState {
  stocks: Stock[];
  totalValue: number;
  loading: boolean;
  error: string;
}

// 应用状态
const state: AppState = {
  stocks: [],
  totalValue: 0,
  loading: false,
  error: ''
};

// Alpha Vantage API
const ALPHA_VANTAGE_API = 'https://www.alphavantage.co/query';
const ALPHA_VANTAGE_API_KEY = 'DU6YOC69XS1OR37G';

// 股票名称映射 (完整的常用美股代码)
const STOCK_NAMES: Record<string, string> = {
  // 科技巨头
  'AAPL': 'Apple Inc.',
  'GOOGL': 'Alphabet Inc. Class A',
  'GOOG': 'Alphabet Inc. Class C',
  'MSFT': 'Microsoft Corporation',
  'AMZN': 'Amazon.com Inc.',
  'META': 'Meta Platforms Inc.',
  'TSLA': 'Tesla Inc.',
  'NVDA': 'NVIDIA Corporation',
  
  // 半导体
  'AMD': 'Advanced Micro Devices',
  'INTC': 'Intel Corporation',
  'QCOM': 'Qualcomm Inc.',
  'TXN': 'Texas Instruments',
  'AVGO': 'Broadcom Inc.',
  'MU': 'Micron Technology',
  
  // 互联网
  'NFLX': 'Netflix Inc.',
  'PYPL': 'PayPal Holdings Inc.',
  'SHOP': 'Shopify Inc.',
  'SQ': 'Block Inc.',
  'SNAP': 'Snap Inc.',
  'TWTR': 'Twitter Inc.',
  'PINS': 'Pinterest Inc.',
  'ROKU': 'Roku Inc.',
  
  // 金融
  'JPM': 'JPMorgan Chase & Co.',
  'BAC': 'Bank of America Corp.',
  'WFC': 'Wells Fargo & Co.',
  'GS': 'Goldman Sachs Group',
  'MS': 'Morgan Stanley',
  'V': 'Visa Inc.',
  'MA': 'Mastercard Inc.',
  'AXP': 'American Express Co.',
  'BX': 'Blackstone Inc.',
  
  // 消费
  'WMT': 'Walmart Inc.',
  'TGT': 'Target Corporation',
  'COST': 'Costco Wholesale',
  'HD': 'The Home Depot Inc.',
  'LOW': "Lowe's Companies",
  'NKE': 'Nike Inc.',
  'SBUX': 'Starbucks Corporation',
  'MCD': "McDonald's Corporation",
  'DIS': 'The Walt Disney Company',
  
  // 医疗健康
  'JNJ': 'Johnson & Johnson',
  'UNH': 'UnitedHealth Group Inc.',
  'PFE': 'Pfizer Inc.',
  'ABBV': 'AbbVie Inc.',
  'MRK': 'Merck & Co.',
  'LLY': 'Eli Lilly and Company',
  'ABT': 'Abbott Laboratories',
  'TMO': 'Thermo Fisher Scientific',
  'DHR': 'Danaher Corporation',
  'AMGN': 'Amgen Inc.',
  
  // 工业
  'BA': 'Boeing Company',
  'CAT': 'Caterpillar Inc.',
  'GE': 'General Electric',
  'HON': 'Honeywell International',
  'UPS': 'United Parcel Service',
  'FDX': 'FedEx Corporation',
  
  // 能源
  'XOM': 'Exxon Mobil Corporation',
  'CVX': 'Chevron Corporation',
  'COP': 'ConocoPhillips',
  
  // 电信
  'T': 'AT&T Inc.',
  'VZ': 'Verizon Communications',
  'TMUS': 'T-Mobile US Inc.',
  
  // 电商/零售
  'BABA': 'Alibaba Group',
  'JD': 'JD.com Inc.',
  'EBAY': 'eBay Inc.',
  'ETSY': 'Etsy Inc.',
  
  // 其他热门
  'SOFI': 'SoFi Technologies Inc.',
  'SOXX': 'iShares Semiconductor ETF',
  'BULL': 'Bull (3x Long)',
  'SPY': 'SPDR S&P 500 ETF Trust',
  'QQQ': 'Invesco QQQ Trust',
  'DIA': 'SPDR Dow Jones ETF',
  'IWM': 'iShares Russell 2000 ETF'
};

// 工具函数：格式化数字
function formatNumber(num: number, decimals: number = 2): string {
  return num.toFixed(decimals);
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

// 函数：从 Alpha Vantage 获取股票数据
async function fetchStockDataFromAlphaVantage(symbol: string): Promise<any> {
  try {
    // 获取实时报价
    const quoteUrl = `${ALPHA_VANTAGE_API}?function=GLOBAL_QUOTE&symbol=${encodeURIComponent(symbol)}&apikey=${ALPHA_VANTAGE_API_KEY}`;
    const quoteResponse = await fetch(quoteUrl);
    
    if (!quoteResponse.ok) {
      throw new Error(`HTTP ${quoteResponse.status}`);
    }
    
    const quoteData: AlphaVantageGlobalQuote = await quoteResponse.json();
    
    if (!quoteData['Global Quote'] || !quoteData['Global Quote']['05. price']) {
      throw new Error('无法获取股票数据');
    }
    
    const globalQuote = quoteData['Global Quote'];
    const price = parseFloat(globalQuote['05. price']) || 0;
    const change = parseFloat(globalQuote['09. change']) || 0;
    const changePercentStr = globalQuote['10. change percent'].replace('%', '');
    const changePercent = parseFloat(changePercentStr) || 0;
    
    // 获取公司名称 (需要额外的 API 调用)
    let companyName = STOCK_NAMES[symbol.toUpperCase()] || symbol.toUpperCase();
    
    try {
      const overviewUrl = `${ALPHA_VANTAGE_API}?function=OVERVIEW&symbol=${encodeURIComponent(symbol)}&apikey=${ALPHA_VANTAGE_API_KEY}`;
      const overviewResponse = await fetch(overviewUrl);
      
      if (overviewResponse.ok) {
        const overviewData = await overviewResponse.json();
        if (overviewData.Name) {
          companyName = overviewData.Name;
        }
      }
    } catch (nameError) {
      console.warn(`获取 ${symbol} 公司名称失败，使用默认名称`);
    }
    
    return {
      symbol: symbol.toUpperCase(),
      name: companyName,
      price: price,
      change: change,
      changePercent: changePercent
    };
  } catch (error) {
    console.error('获取股票数据失败:', error);
    throw error;
  }
}

// 函数：批量获取股票数据
async function fetchBatchStockData(symbols: string[]): Promise<any[]> {
  const results = [];
  
  for (const symbol of symbols) {
    try {
      const data = await fetchStockDataFromAlphaVantage(symbol);
      results.push(data);
      // 添加延迟以遵守 API rate limit (每分钟 5 次请求)
      await new Promise(resolve => setTimeout(resolve, 13000));
    } catch (error) {
      console.error(`获取 ${symbol} 数据失败:`, error);
      results.push({
        symbol: symbol.toUpperCase(),
        name: STOCK_NAMES[symbol.toUpperCase()] || symbol.toUpperCase(),
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
  state.totalValue = state.stocks.reduce((sum, stock) => {
    return sum + (stock.shares * stock.currentPrice);
  }, 0);
  
  state.stocks = state.stocks.map(stock => {
    const position = stock.shares * stock.currentPrice;
    const weight = state.totalValue > 0 ? (position / state.totalValue) * 100 : 0;
    return {
      ...stock,
      position,
      weight
    };
  });
}

// 函数：保存到 localStorage
function saveToStorage(): void {
  const data = {
    stocks: state.stocks.map(s => ({
      symbol: s.symbol,
      name: s.name,
      shares: s.shares,
      targetPrice: s.targetPrice,
      currentPrice: s.currentPrice
    }))
  };
  localStorage.setItem('stockPortfolio', JSON.stringify(data));
}

// 函数：从 localStorage 加载
function loadFromStorage(): void {
  try {
    const data = localStorage.getItem('stockPortfolio');
    if (data) {
      const parsed = JSON.parse(data);
      state.stocks = parsed.stocks.map((s: any) => ({
        ...s,
        position: 0,
        weight: 0
      }));
      calculateTotals();
    }
  } catch (error) {
    console.error('加载数据失败:', error);
  }
}

// 函数：更新股票价格
async function updateStockPrices(): Promise<void> {
  if (state.stocks.length === 0) return;
  
  state.loading = true;
  render();
  
  try {
    const symbols = state.stocks.map(s => s.symbol);
    const stockDataList = await fetchBatchStockData(symbols);
    
    state.stocks = state.stocks.map(stock => {
      const data = stockDataList.find((d: any) => d.symbol === stock.symbol);
      if (data && data.price > 0) {
        return {
          ...stock,
          currentPrice: data.price,
          name: data.name
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
  const targetPrice = parseFloat(targetPriceInput.value) || 0;
  
  if (!symbol) {
    renderError('请输入股票代码');
    return;
  }
  
  // 检查是否已存在
  if (state.stocks.find(s => s.symbol === symbol)) {
    renderError('该股票已在持仓列表中');
    return;
  }
  
  state.loading = true;
  render();
  
  try {
    const stockData = await fetchStockDataFromAlphaVantage(symbol);
    
    const newStock: Stock = {
      symbol,
      name: stockData.name || symbol,
      shares,
      targetPrice,
      currentPrice: stockData.price || 0,
      position: 0,
      weight: 0
    };
    
    state.stocks.push(newStock);
    
    // 清空输入框
    symbolInput.value = '';
    sharesInput.value = '';
    targetPriceInput.value = '';
    
    calculateTotals();
    renderSuccess(`已添加 ${symbol}`);
  } catch (error) {
    renderError('添加股票失败，请检查股票代码是否正确');
  } finally {
    state.loading = false;
    render();
  }
}

// 函数：移除股票
function removeStock(symbol: string): void {
  state.stocks = state.stocks.filter(s => s.symbol !== symbol);
  calculateTotals();
  render();
  renderSuccess(`已移除 ${symbol}`);
}

// 函数：更新股票信息
function updateStock(symbol: string, field: keyof Stock, value: number): void {
  const stock = state.stocks.find(s => s.symbol === symbol);
  if (stock) {
    (stock as any)[field] = value;
    calculateTotals();
    render();
  }
}

// 函数：渲染应用
function render(): void {
  const app = document.getElementById('app');
  if (!app) return;
  
  app.innerHTML = `
    <div class="container">
      <div class="header">
        <h1>美股持仓管理</h1>
        <p>实时查询股票价格，计算持仓和仓位</p>
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
          <div style="display: flex; gap: 10px; align-items: end;">
            <button class="btn btn-primary" onclick="addStock()" ${state.loading ? 'disabled' : ''}>
              ${state.loading ? '<span class="loading"></span>' : '添加股票'}
            </button>
            <button class="btn btn-secondary" onclick="updateStockPrices()" ${state.loading || state.stocks.length === 0 ? 'disabled' : ''}>
              ${state.loading ? '<span class="loading"></span>' : '刷新价格'}
            </button>
          </div>
        </div>
        
        ${state.stocks.length === 0 ? `
          <div class="empty-state">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
            <h3>暂无持仓</h3>
            <p>在上方输入股票代码开始添加您的持仓</p>
          </div>
        ` : `
          <div class="table-container">
            <table>
              <thead>
                <tr>
                  <th>代码</th>
                  <th>股票名称</th>
                  <th>股数</th>
                  <th>现价</th>
                  <th>持仓</th>
                  <th>仓位</th>
                  <th>1y目标价</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                ${state.stocks.map(stock => `
                  <tr>
                    <td style="font-weight: 600; color: #667eea;">${stock.symbol}</td>
                    <td>${stock.name}</td>
                    <td>
                      <input type="number" value="${stock.shares}" 
                             onchange="updateStock('${stock.symbol}', 'shares', parseFloat(this.value) || 0)" 
                             style="width: 80px; padding: 6px; border: 1px solid #e5e7eb; border-radius: 6px; text-align: center;"
                             step="0.01" min="0" />
                    </td>
                    <td style="font-weight: 600;">$${formatNumber(stock.currentPrice)}</td>
                    <td style="font-weight: 600; color: #059669;">$${formatNumber(stock.position)}</td>
                    <td style="font-weight: 600; color: #667eea;">${formatPercent(stock.weight)}</td>
                    <td>
                      <input type="number" value="${stock.targetPrice}" 
                             onchange="updateStock('${stock.symbol}', 'targetPrice', parseFloat(this.value) || 0)" 
                             style="width: 80px; padding: 6px; border: 1px solid #e5e7eb; border-radius: 6px; text-align: center;"
                             step="0.01" min="0" />
                    </td>
                    <td>
                      <button class="btn btn-danger" onclick="removeStock('${stock.symbol}')" style="padding: 6px 12px; font-size: 0.85rem;">
                        移除
                      </button>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
          
          <div class="summary">
            <div class="summary-card">
              <h3>总持仓</h3>
              <div class="value">$${formatNumber(state.totalValue)}</div>
            </div>
            <div class="summary-card" style="background: linear-gradient(135deg, #059669 0%, #10b981 100%);">
              <h3>持仓数量</h3>
              <div class="value">${state.stocks.length}</div>
            </div>
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

// 初始化应用
function init(): void {
  loadFromStorage();
  render();
  
  // 设置下拉搜索事件
  setupStockSearchEvents();
  
  // 页面加载时自动更新价格
  if (state.stocks.length > 0) {
    updateStockPrices();
  }
}

// 启动应用
init();

// 暴露全局函数供 HTML 调用
(window as any).addStock = addStock;
(window as any).removeStock = removeStock;
(window as any).updateStock = updateStock;
(window as any).updateStockPrices = updateStockPrices;
(window as any).selectStock = selectStock;

// 下拉搜索相关变量
let selectedIndex = -1;

// 函数：过滤股票
function filterStocks(query: string): Array<{symbol: string; name: string}> {
  if (!query.trim()) return [];
  
  const upperQuery = query.toUpperCase();
  const lowerQuery = query.toLowerCase();
  
  return Object.entries(STOCK_NAMES)
    .filter(([symbol, name]) => {
      return symbol.includes(upperQuery) || name.toLowerCase().includes(lowerQuery);
    })
    .slice(0, 10) // 最多显示10个结果
    .map(([symbol, name]) => ({ symbol, name }));
}

// 函数：显示下拉建议
function showSuggestions(suggestions: Array<{symbol: string; name: string}>): void {
  const dropdown = document.getElementById('stock-suggestions');
  if (!dropdown) return;
  
  if (suggestions.length === 0) {
    dropdown.innerHTML = '<div class="no-results">未找到匹配的股票</div>';
    dropdown.style.display = 'block';
    return;
  }
  
  dropdown.innerHTML = suggestions.map((item, index) => `
    <div class="suggestion-item ${index === selectedIndex ? 'selected' : ''}" 
         onclick="selectStock('${item.symbol}')"
         onmouseenter="highlightSuggestion(${index})">
      <span class="suggestion-symbol">${item.symbol}</span>
      <span class="suggestion-name">${item.name}</span>
    </div>
  `).join('');
  
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
function selectStock(symbol: string): void {
  const input = document.getElementById('symbol') as HTMLInputElement;
  if (input) {
    input.value = symbol;
  }
  hideSuggestions();
  
  // 聚焦到股数输入框
  const sharesInput = document.getElementById('shares') as HTMLInputElement;
  if (sharesInput) {
    sharesInput.focus();
  }
}

// 函数：设置下拉搜索事件
function setupStockSearchEvents(): void {
  const input = document.getElementById('symbol') as HTMLInputElement;
  const dropdown = document.getElementById('stock-suggestions');
  
  if (!input || !dropdown) return;
  
  // 输入事件
  input.addEventListener('input', (e) => {
    const value = (e.target as HTMLInputElement).value;
    const suggestions = filterStocks(value);
    showSuggestions(suggestions);
  });
  
  // 聚焦事件
  input.addEventListener('focus', () => {
    const value = input.value;
    if (value) {
      const suggestions = filterStocks(value);
      showSuggestions(suggestions);
    }
  });
  
  // 键盘导航
  input.addEventListener('keydown', (e) => {
    const suggestions = filterStocks(input.value);
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
      selectStock(suggestions[selectedIndex].symbol);
    } else if (e.key === 'Escape') {
      hideSuggestions();
    }
  });
  
  // 点击外部关闭
  document.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    if (!target.closest('.input-group')) {
      hideSuggestions();
    }
  });
}
