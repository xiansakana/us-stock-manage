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

// 股票名称映射
const STOCK_NAMES: Record<string, string> = {
  'AAPL': 'Apple Inc.',
  'GOOGL': 'Alphabet Inc.',
  'MSFT': 'Microsoft Corporation',
  'AMZN': 'Amazon.com Inc.',
  'META': 'Meta Platforms Inc.',
  'TSLA': 'Tesla Inc.',
  'NVDA': 'NVIDIA Corporation',
  'JPM': 'JPMorgan Chase & Co.',
  'V': 'Visa Inc.',
  'JNJ': 'Johnson & Johnson',
  'WMT': 'Walmart Inc.',
  'PG': 'Procter & Gamble Co.',
  'MA': 'Mastercard Inc.',
  'UNH': 'UnitedHealth Group Inc.',
  'HD': 'The Home Depot Inc.',
  'DIS': 'The Walt Disney Company',
  'NFLX': 'Netflix Inc.',
  'PYPL': 'PayPal Holdings Inc.',
  'ADBE': 'Adobe Inc.',
  'CRM': 'Salesforce Inc.',
  'NKE': 'Nike Inc.',
  'BULL': 'Bull',
  'BX': 'Blackstone Inc.',
  'SOFI': 'SoFi Technologies Inc.'
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
          <div class="input-group">
            <label for="symbol">股票代码</label>
            <input type="text" id="symbol" placeholder="例如: AAPL" ${state.loading ? 'disabled' : ''} />
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
}

// 初始化应用
function init(): void {
  loadFromStorage();
  render();
  
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
