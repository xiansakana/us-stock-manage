import { Router } from 'express';
import { FetchClient, Config } from 'coze-coding-dev-sdk';

const router = Router();

// 创建 FetchClient 实例
const config = new Config();
const client = new FetchClient(config);

// 股票数据接口
interface StockData {
  symbol: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
  marketCap?: number;
  pe?: number;
}

// 获取股票数据
router.get('/stock/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    
    // 使用 Yahoo Finance 的查询 API
    const queryUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=1d`;
    
    const response = await client.fetch(queryUrl);
    
    // 从返回的文本内容中提取股票信息
    let stockData: StockData = {
      symbol: symbol.toUpperCase(),
      name: symbol.toUpperCase(),
      price: 0,
      change: 0,
      changePercent: 0
    };
    
    // 解析 JSON 内容
    const htmlContent = response.content
      .filter(item => item.type === 'text')
      .map(item => item.text)
      .join('\n');
    
    try {
      const data = JSON.parse(htmlContent);
      
      if (data.chart && data.chart.result && data.chart.result[0]) {
        const result = data.chart.result[0];
        const meta = result.meta;
        
        stockData.price = meta.regularMarketPrice || 0;
        stockData.change = meta.regularMarketChange || 0;
        stockData.changePercent = meta.regularMarketChangePercent || 0;
        stockData.name = meta.shortName || meta.symbol || symbol.toUpperCase();
        
        // 如果无法从 Yahoo 获取，返回估算数据作为备选
        if (stockData.price === 0) {
          return res.status(404).json({
            error: '无法获取股票数据，请检查股票代码是否正确',
            symbol: symbol.toUpperCase()
          });
        }
        
        res.json(stockData);
      } else {
        return res.status(404).json({
          error: '无法获取股票数据，请检查股票代码是否正确',
          symbol: symbol.toUpperCase()
        });
      }
    } catch (parseError) {
      console.error('解析股票数据失败:', parseError);
      return res.status(404).json({
        error: '无法获取股票数据，请检查股票代码是否正确',
        symbol: symbol.toUpperCase()
      });
    }
  } catch (error) {
    console.error('获取股票数据失败:', error);
    res.status(500).json({
      error: '服务器错误，请稍后重试'
    });
  }
});

// 批量获取股票数据
router.post('/stocks/batch', async (req, res) => {
  try {
    const { symbols } = req.body;
    
    if (!Array.isArray(symbols) || symbols.length === 0) {
      return res.status(400).json({
        error: '请提供有效的股票代码数组'
      });
    }
    
    const results: StockData[] = [];
    
    // 逐个获取股票数据
    for (const symbol of symbols) {
      try {
        const queryUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=1d`;
        const response = await client.fetch(queryUrl);
        
        const htmlContent = response.content
          .filter(item => item.type === 'text')
          .map(item => item.text)
          .join('\n');
        
        try {
          const data = JSON.parse(htmlContent);
          
          if (data.chart && data.chart.result && data.chart.result[0]) {
            const result = data.chart.result[0];
            const meta = result.meta;
            
            results.push({
              symbol: symbol.toUpperCase(),
              name: meta.shortName || meta.symbol || symbol.toUpperCase(),
              price: meta.regularMarketPrice || 0,
              change: meta.regularMarketChange || 0,
              changePercent: meta.regularMarketChangePercent || 0
            });
          } else {
            results.push({
              symbol: symbol.toUpperCase(),
              name: symbol.toUpperCase(),
              price: 0,
              change: 0,
              changePercent: 0
            });
          }
        } catch (parseError) {
          console.error(`解析 ${symbol} 数据失败:`, parseError);
          results.push({
            symbol: symbol.toUpperCase(),
            name: symbol.toUpperCase(),
            price: 0,
            change: 0,
            changePercent: 0
          });
        }
      } catch (err) {
        console.error(`获取 ${symbol} 数据失败:`, err);
        results.push({
          symbol: symbol.toUpperCase(),
          name: symbol.toUpperCase(),
          price: 0,
          change: 0,
          changePercent: 0
        });
      }
    }
    
    res.json(results);
  } catch (error) {
    console.error('批量获取股票数据失败:', error);
    res.status(500).json({
      error: '服务器错误，请稍后重试'
    });
  }
});

export default router;
