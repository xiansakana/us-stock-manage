import { Router } from 'express';

const router = Router();

// Finnhub API Key (股票数据)
const FINNHUB_API_KEY = 'd7sa5a1r01qorsvhvrlgd7sa5a1r01qorsvhvrm0';

// Polygon.io API Key (期权数据)
const POLYGON_API_KEY = 'ksTLCk4yRwmpfGycHMVKdvYIWyoAuCsb';

// 股票数据接口
interface StockData {
  symbol: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
}

// 期权数据接口
interface OptionData {
  symbol: string;
  name: string;
  price: number;
  change: number;
  changePercent: number;
  type: 'call' | 'put';
  strikePrice: number;
  expirationDate: string;
  underlying: string;
}

// 解析期权代码
function parseOptionSymbol(symbol: string): { underlying: string; expiration: string; type: string; strike: string } | null {
  // 格式: AAPL250530C150 或 AAPL260620P200
  const match = symbol.match(/^([A-Z]+)(\d{6})([CP])(\d+)$/i);
  if (!match) return null;
  
  const [, underlying, date, type, strike] = match;
  return {
    underlying: underlying.toUpperCase(),
    expiration: date,
    type: type.toUpperCase(),
    strike: strike
  };
}

// 格式化为 Polygon.io 期权代码
function toPolygonOptionSymbol(symbol: string): string {
  const parsed = parseOptionSymbol(symbol);
  if (!parsed) return '';
  
  // Polygon.io 格式: O:AAPL250530C00150000
  // 执行价格式：3位整数 + 3位小数 = 6位数字，左补零到8位
  // 例如: $150 = 150000 -> 00150000 (左补零到8位)
  const strikeFloat = parseFloat(parsed.strike);
  const strikeInt = Math.round(strikeFloat * 1000); // 3位小数
  const strikePadded = strikeInt.toString().padStart(8, '0');
  return `O:${parsed.underlying}${parsed.expiration}${parsed.type}${strikePadded}`;
}

// 获取股票数据 (Finnhub)
router.get('/stock/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    
    // 使用原生 fetch 调用 Finnhub API
    const quoteUrl = `https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${FINNHUB_API_KEY}`;
    const response = await fetch(quoteUrl);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    const quoteData = await response.json();
    
    // Finnhub 返回: { c: current price, d: change, dp: change percent, h: high, l: low, o: open, pc: previous close, t: timestamp }
    if (!quoteData.c && quoteData.c !== 0) {
      return res.status(404).json({
        error: '无法获取股票数据，请检查股票代码是否正确',
        symbol: symbol.toUpperCase()
      });
    }
    
    // 如果价格为空或为0，说明股票代码无效
    if (quoteData.c === 0 && quoteData.pc === 0) {
      return res.status(404).json({
        error: '无法获取股票数据，请检查股票代码是否正确',
        symbol: symbol.toUpperCase()
      });
    }
    
    let stockData: StockData = {
      symbol: symbol.toUpperCase(),
      name: symbol.toUpperCase(),
      price: quoteData.c,
      change: quoteData.d,
      changePercent: quoteData.dp
    };
    
    res.json(stockData);
  } catch (error) {
    console.error('获取股票数据失败:', error);
    return res.status(500).json({
      error: '服务器错误，无法获取股票数据',
      message: error instanceof Error ? error.message : '未知错误'
    });
  }
});

// 获取期权数据 (Polygon.io)
router.get('/option/:symbol', async (req, res) => {
  try {
    const { symbol } = req.params;
    const upperSymbol = symbol.toUpperCase();
    
    const parsed = parseOptionSymbol(upperSymbol);
    if (!parsed) {
      return res.status(400).json({
        error: '期权代码格式错误，格式应为: AAPL250530C150',
        example: 'AAPL250530C150 = Apple 2025-05-30 看涨期权 $150'
      });
    }
    
    const polygonSymbol = toPolygonOptionSymbol(upperSymbol);
    
    // 使用 Polygon.io 获取上一个交易日的数据
    const url = `https://api.polygon.io/v2/aggs/ticker/${polygonSymbol}/prev?apiKey=${POLYGON_API_KEY}`;
    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    
    const data = await response.json();
    
    if (data.status !== 'OK' || !data.results || data.results.length === 0) {
      return res.status(404).json({
        error: '无法获取期权数据，期权代码可能不存在或已过期',
        symbol: upperSymbol,
        polygonSymbol: polygonSymbol
      });
    }
    
    const result = data.results[0];
    
    // 格式化到期日
    const expDate = `${parsed.expiration.slice(0, 4)}-${parsed.expiration.slice(4, 6)}-${parsed.expiration.slice(6, 8)}`;
    
    let optionData: OptionData = {
      symbol: upperSymbol,
      name: `${parsed.underlying} ${expDate} ${parsed.type === 'C' ? 'Call' : 'Put'} $${parsed.strike}`,
      price: result.c || result.vw || 0,
      change: result.c && result.o ? result.c - result.o : 0,
      changePercent: result.c && result.o ? ((result.c - result.o) / result.o) * 100 : 0,
      type: parsed.type === 'C' ? 'call' : 'put',
      strikePrice: parseFloat(parsed.strike),
      expirationDate: expDate,
      underlying: parsed.underlying
    };
    
    res.json(optionData);
  } catch (error) {
    console.error('获取期权数据失败:', error);
    return res.status(500).json({
      error: '服务器错误，无法获取期权数据',
      message: error instanceof Error ? error.message : '未知错误'
    });
  }
});

// 获取期权链 (Polygon.io) - 获取某个标的的所有期权
router.get('/options/chain/:underlying', async (req, res) => {
  try {
    const { underlying } = req.params;
    const upperUnderlying = underlying.toUpperCase();
    
    // Polygon.io 的 snapshot API 需要付费，但我们可以用聚合数据
    // 这里返回提示信息
    return res.status(501).json({
      error: '期权链查询需要付费订阅',
      message: '请手动输入期权代码，格式: AAPL250530C150',
      example: 'AAPL250530C150 = Apple 2025-05-30 看涨期权 $150'
    });
  } catch (error) {
    console.error('获取期权链失败:', error);
    return res.status(500).json({
      error: '服务器错误',
      message: error instanceof Error ? error.message : '未知错误'
    });
  }
});

// 批量获取股票/期权数据
router.post('/batch', async (req, res) => {
  try {
    const { symbols } = req.body;
    
    if (!Array.isArray(symbols)) {
      return res.status(400).json({ error: 'symbols 必须是数组' });
    }
    
    const results: (StockData | OptionData | { symbol: string; error: string })[] = [];
    
    for (const symbol of symbols) {
      try {
        const upperSymbol = symbol.toUpperCase();
        
        if (parseOptionSymbol(upperSymbol)) {
          // 期权
          const parsed = parseOptionSymbol(upperSymbol)!;
          const polygonSymbol = toPolygonOptionSymbol(upperSymbol);
          const url = `https://api.polygon.io/v2/aggs/ticker/${polygonSymbol}/prev?apiKey=${POLYGON_API_KEY}`;
          const response = await fetch(url);
          const data = await response.json();
          
          if (data.status === 'OK' && data.results && data.results.length > 0) {
            const result = data.results[0];
            const expDate = `${parsed.expiration.slice(0, 4)}-${parsed.expiration.slice(4, 6)}-${parsed.expiration.slice(6, 8)}`;
            
            results.push({
              symbol: upperSymbol,
              name: `${parsed.underlying} ${expDate} ${parsed.type === 'C' ? 'Call' : 'Put'} $${parsed.strike}`,
              price: result.c || result.vw || 0,
              change: result.c && result.o ? result.c - result.o : 0,
              changePercent: result.c && result.o ? ((result.c - result.o) / result.o) * 100 : 0,
              type: parsed.type === 'C' ? 'call' : 'put',
              strikePrice: parseFloat(parsed.strike),
              expirationDate: expDate,
              underlying: parsed.underlying
            });
          } else {
            results.push({ symbol: upperSymbol, error: '期权数据不存在' });
          }
        } else {
          // 股票
          const url = `https://finnhub.io/api/v1/quote?symbol=${upperSymbol}&token=${FINNHUB_API_KEY}`;
          const response = await fetch(url);
          const data = await response.json();
          
          if (data.c && data.c > 0) {
            results.push({
              symbol: upperSymbol,
              name: upperSymbol,
              price: data.c,
              change: data.d,
              changePercent: data.dp
            });
          } else {
            results.push({ symbol: upperSymbol, error: '股票数据不存在' });
          }
        }
      } catch {
        results.push({ symbol: symbol, error: '获取失败' });
      }
    }
    
    res.json(results);
  } catch (error) {
    console.error('批量获取数据失败:', error);
    return res.status(500).json({
      error: '服务器错误',
      message: error instanceof Error ? error.message : '未知错误'
    });
  }
});

export default router;
