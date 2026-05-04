// 类型定义
interface Stock {
  symbol: string;
  name: string;
  shares: number;
  targetPrice: number;
  currentPrice: number;
  position: number;
  weight: number;
  type?: 'stock' | 'option'; // 股票或期权
  optionStrike?: number;      // 期权执行价
  optionExpiry?: string;       // 期权到期日
  optionType?: 'C' | 'P';      // 期权类型 C=看涨 P=看跌
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
  cash: number;
  loading: boolean;
  error: string;
}

// 应用状态
const state: AppState = {
  stocks: [],
  totalValue: 0,
  cash: 0,
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

// 函数：批量获取股票数据
async function fetchBatchStockData(symbols: string[]): Promise<any[]> {
  const results = [];
  
  for (const symbol of symbols) {
    try {
      const data = await fetchStockDataFromAPI(symbol);
      results.push(data);
      // 添加延迟以遵守 API rate limit
      await new Promise(resolve => setTimeout(resolve, 1000));
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
  // 计算股票总市值
  const stocksValue = state.stocks.reduce((sum, stock) => {
    return sum + (stock.shares * stock.currentPrice);
  }, 0);
  
  // 总资产 = 股票市值 + 现金
  const totalAssets = stocksValue + state.cash;
  state.totalValue = stocksValue;
  
  state.stocks = state.stocks.map(stock => {
    const position = stock.shares * stock.currentPrice;
    const weight = totalAssets > 0 ? (position / totalAssets) * 100 : 0;
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
      currentPrice: s.currentPrice,
      type: s.type,
      optionStrike: s.optionStrike,
      optionExpiry: s.optionExpiry,
      optionType: s.optionType
    })),
    cash: state.cash
  };
  localStorage.setItem('stockPortfolio', JSON.stringify(data));
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
      currentPrice: s.currentPrice,
      position: s.position,
      weight: s.weight,
      type: s.type,
      optionStrike: s.optionStrike,
      optionExpiry: s.optionExpiry,
      optionType: s.optionType
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
  const headers = ['代码', '名称', '类型', '股数', '现价', '持仓', '仓位', '1y目标价', '期权执行价', '期权到期日', '期权类型'];
  const rows = state.stocks.map(s => [
    s.symbol,
    s.name,
    s.type === 'option' ? '期权' : '股票',
    s.shares,
    s.currentPrice,
    s.position,
    s.weight,
    s.targetPrice,
    s.optionStrike || '',
    s.optionExpiry || '',
    s.optionType || ''
  ]);
  
  // 添加现金行
  const csvContent = [
    headers.join(','),
    ...rows.map(r => r.map(cell => `"${cell}"`).join(',')),
    '',
    `"现金","","","","","${state.cash}"`
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
        state.stocks = data.stocks.map(s => ({
          ...s,
          position: s.shares * s.currentPrice,
          weight: 0
        }));
        state.cash = data.cash || 0;
        calculateTotals();
        saveToStorage();
        render();
        
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
      
      // 跳过标题行，解析数据
      const newStocks: Stock[] = [];
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line || line.includes('"现金"')) continue; // 跳过现金行
        
        // 解析 CSV 行
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
        
        if (values[0] && values[3]) { // 代码和股数存在
          newStocks.push({
            symbol: values[0].toUpperCase(),
            name: values[1] || STOCK_NAMES[values[0].toUpperCase()] || values[0].toUpperCase(),
            type: values[2] === '期权' ? 'option' : 'stock',
            shares: parseFloat(values[3]) || 0,
            targetPrice: parseFloat(values[7]) || 0,
            currentPrice: parseFloat(values[4]) || 0,
            position: parseFloat(values[5]) || 0,
            weight: 0,
            optionStrike: values[8] ? parseFloat(values[8]) : undefined,
            optionExpiry: values[9] || undefined,
            optionType: (values[10] as 'C' | 'P') || undefined
          });
        }
      }
      
      if (newStocks.length > 0) {
        state.stocks = newStocks;
        calculateTotals();
        saveToStorage();
        render();
        
        if (state.stocks.length > 0) {
          setTimeout(() => updateStockPrices(), 500);
        }
        
        renderSuccess(`成功导入 ${state.stocks.length} 条记录`);
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
      state.cash = parsed.cash || 0;
      calculateTotals();
    }
  } catch (error) {
    console.error('加载数据失败:', error);
  }
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
    renderError('请输入股票代码或期权代码');
    return;
  }
  
  // 检查是否已存在
  if (state.stocks.find(s => s.symbol === symbol)) {
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
          stockData.name = `${STOCK_NAMES[underlying] || underlying} 期权`;
        }
      } catch {
        // 获取期权数据失败，使用标的股票价格
        const underlying = symbol.match(/^[A-Z]+/)?.[0] || symbol;
        stockData = await fetchStockDataFromAPI(underlying);
        stockData.name = `${STOCK_NAMES[underlying] || underlying} 期权`;
      }
    } else {
      stockData = await fetchStockDataFromAPI(symbol);
    }
    
    const underlying = symbol.match(/^[A-Z]+/)?.[0] || symbol;
    const newStock: Stock = {
      symbol,
      name: isOption ? `${STOCK_NAMES[underlying] || underlying} 期权` : (stockData.name || symbol),
      shares,
      targetPrice,
      currentPrice: stockData.price || 0,
      position: 0,
      weight: 0,
      type: isOption ? 'option' : 'stock',
      optionStrike: selectedOptionData.strike,
      optionExpiry: selectedOptionData.expiry,
      optionType: selectedOptionData.type
    };
    
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
              ${state.loading ? '<span class="loading"></span>' : '添加'}
            </button>
            <button class="btn btn-secondary" onclick="updateStockPrices()" ${state.loading || state.stocks.length === 0 ? 'disabled' : ''}>
              ${state.loading ? '<span class="loading"></span>' : '刷新价格'}
            </button>
          </div>
          <div id="option-info" style="display: none; margin-top: 10px;"></div>
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
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px;">
            <h3 style="margin: 0;">持仓明细</h3>
            <div style="display: flex; gap: 8px;">
              <button class="btn btn-secondary" onclick="exportToJSON()" style="padding: 8px 16px; font-size: 0.85rem;">
                导出 JSON
              </button>
              <button class="btn btn-secondary" onclick="exportToCSV()" style="padding: 8px 16px; font-size: 0.85rem;">
                导出 CSV
              </button>
              <label class="btn btn-secondary" style="padding: 8px 16px; font-size: 0.85rem; cursor: pointer;">
                导入
                <input type="file" accept=".json,.csv" onchange="importFromJSON(event)" style="display: none;" />
              </label>
              <label class="btn btn-secondary" style="padding: 8px 16px; font-size: 0.85rem; cursor: pointer;">
                导入 CSV
                <input type="file" accept=".csv" onchange="importFromCSV(event)" style="display: none;" />
              </label>
            </div>
          </div>
          <div class="table-container">
            <table>
              <thead>
                <tr>
                  <th>类型</th>
                  <th>代码</th>
                  <th>名称</th>
                  <th>股数</th>
                  <th>现价</th>
                  <th>持仓</th>
                  <th>仓位</th>
                  <th>1y目标价</th>
                  <th>期权信息</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                ${state.stocks.map(stock => `
                  <tr ${stock.type === 'option' ? 'style="background: rgba(102, 126, 234, 0.05);"' : ''}>
                    <td>
                      ${stock.type === 'option' 
                        ? '<span style="background: #667eea; color: white; padding: 2px 8px; border-radius: 4px; font-size: 0.75rem;">期权</span>' 
                        : '<span style="background: #10b981; color: white; padding: 2px 8px; border-radius: 4px; font-size: 0.75rem;">股票</span>'}
                    </td>
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
                    <td style="font-size: 0.8rem; color: #666;">
                      ${stock.type === 'option' && stock.optionStrike
                        ? `${stock.optionType === 'C' ? 'Call' : 'Put'} $${stock.optionStrike}<br/><span style="color: #999;">${stock.optionExpiry || ''}</span>`
                        : '-'}
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
              <h3>现金</h3>
              <div class="value" style="display: flex; align-items: center; gap: 8px;">
                <span style="font-size: 0.9rem;">$</span>
                <input type="number" value="${state.cash}" 
                       onchange="updateCash(parseFloat(this.value) || 0)" 
                       style="width: 100px; padding: 4px 8px; border: 1px solid rgba(255,255,255,0.3); border-radius: 6px; background: rgba(255,255,255,0.1); color: white; font-size: 1.2rem; font-weight: 600;"
                       step="0.01" min="0" />
              </div>
            </div>
            <div class="summary-card" style="background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);">
              <h3>股票市值</h3>
              <div class="value">$${formatNumber(state.totalValue)}</div>
            </div>
            <div class="summary-card" style="background: linear-gradient(135deg, #059669 0%, #10b981 100%);">
              <h3>总资产</h3>
              <div class="value">$${formatNumber(state.totalValue + state.cash)}</div>
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
(window as any).updateCash = updateCash;
(window as any).selectStock = selectStock;
(window as any).exportToJSON = exportToJSON;
(window as any).exportToCSV = exportToCSV;
(window as any).importFromJSON = importFromJSON;
(window as any).importFromCSV = importFromCSV;
(window as any).highlightSuggestion = highlightSuggestion;

// 下拉搜索相关变量
let selectedIndex = -1;

// 函数：过滤股票
interface SuggestionItem {
  symbol: string;
  name: string;
  type?: 'stock' | 'option';
  optionStrike?: number;
  optionExpiry?: string;
  optionType?: 'C' | 'P';
}

function filterStocks(query: string): SuggestionItem[] {
  if (!query.trim()) return [];
  
  const upperQuery = query.toUpperCase();
  const lowerQuery = query.toLowerCase();
  
  const results: SuggestionItem[] = [];
  
  // 检查是否是期权代码格式：标的代码 + 到期日 + C/P + 执行价
  // 例如: AAPL250530C150 = Apple 2025-05-30 Call 150
  const optionMatch = upperQuery.match(/^([A-Z]{1,5})(\d{6})([CP])(\d+)$/);
  if (optionMatch) {
    const [, symbol, expiry, type, strike] = optionMatch;
    const underlyingName = STOCK_NAMES[symbol] || symbol;
    const dateStr = `${expiry.slice(0, 2)}-${expiry.slice(2, 4)}-${expiry.slice(4, 6)}`;
    results.push({
      symbol: `${symbol}${expiry}${type}${strike}`,
      name: `${underlyingName} 期权 ${type === 'C' ? '看涨' : '看跌'} $${strike} ${dateStr}`,
      type: 'option',
      optionStrike: parseFloat(strike),
      optionExpiry: `20${dateStr}`,
      optionType: type as 'C' | 'P'
    });
  }
  
  // 检查是否输入了期权部分格式，提供期权建议
  if (/^[A-Z]{1,5}\d{0,6}$/.test(upperQuery) && upperQuery.length >= 2) {
    // 添加股票选项
    const stockResults = Object.entries(STOCK_NAMES)
      .filter(([symbol, name]) => {
        return symbol.includes(upperQuery) || name.toLowerCase().includes(lowerQuery);
      })
      .slice(0, 5)
      .map(([symbol, name]) => ({ symbol, name, type: 'stock' as const }));
    
    results.push(...stockResults);
    
    // 如果输入了至少4个字符，添加期权快速添加提示
    if (upperQuery.length >= 4 && /^[A-Z]{1,5}$/.test(upperQuery.slice(0, -3))) {
      const stockSymbol = Object.keys(STOCK_NAMES).find(s => s.startsWith(upperQuery.slice(0, -3)));
      if (stockSymbol) {
        // 格式说明
        const expiryExample = 'YYMMDD';
        const strikeExample = '150';
        results.push({
          symbol: upperQuery,
          name: `期权格式: ${stockSymbol}${expiryExample}${strikeExample}`,
          type: 'option'
        });
      }
    }
  } else {
    // 普通搜索
    const stockResults = Object.entries(STOCK_NAMES)
      .filter(([symbol, name]) => {
        return symbol.includes(upperQuery) || name.toLowerCase().includes(lowerQuery);
      })
      .slice(0, 10)
      .map(([symbol, name]) => ({ symbol, name, type: 'stock' as const }));
    
    results.push(...stockResults);
  }
  
  return results.slice(0, 10);
}

// 函数：显示下拉建议
function showSuggestions(suggestions: SuggestionItem[]): void {
  const dropdown = document.getElementById('stock-suggestions');
  if (!dropdown) return;
  
  if (suggestions.length === 0) {
    dropdown.innerHTML = '<div class="no-results">输入股票代码或期权代码搜索<br><small style="color:#999">期权格式: AAPL250530C150</small></div>';
    dropdown.style.display = 'block';
    return;
  }
  
  dropdown.innerHTML = suggestions.map((item, index) => `
    <div class="suggestion-item ${index === selectedIndex ? 'selected' : ''} ${item.type === 'option' ? 'option-item' : ''}" 
         onclick="selectStock('${item.symbol}', ${item.optionStrike ? item.optionStrike : 'undefined'}, '${item.optionExpiry || ''}', '${item.optionType || ''}')"
         onmouseenter="highlightSuggestion(${index})">
      <span class="suggestion-symbol">${item.symbol}</span>
      <span class="suggestion-name">${item.name}</span>
      ${item.type === 'option' ? '<span class="option-badge">期权</span>' : ''}
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
// 存储选中的期权信息
let selectedOptionData: {strike?: number; expiry?: string; type?: 'C' | 'P'} = {};

function selectStock(symbol: string, strike?: number, expiry?: string, type?: string): void {
  const input = document.getElementById('symbol') as HTMLInputElement;
  if (input) {
    input.value = symbol;
  }
  
  // 保存期权信息
  if (strike && expiry && type) {
    selectedOptionData = {
      strike,
      expiry,
      type: type as 'C' | 'P'
    };
    // 更新期权信息显示
    updateOptionInfoDisplay(symbol, strike, expiry, type);
  } else {
    selectedOptionData = {};
    clearOptionInfoDisplay();
  }
  
  hideSuggestions();
  
  // 聚焦到股数输入框
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
    const name = STOCK_NAMES[underlying] || underlying;
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
