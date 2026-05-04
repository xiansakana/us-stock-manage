import { Router } from 'express';
import { FetchClient, Config } from 'coze-coding-dev-sdk';

const router = Router();

// 创建 FetchClient 实例
const config = new Config();
const client = new FetchClient(config);

// Finnhub API Key
const FINNHUB_API_KEY = 'd7sa5a1r01qorsvhvrlgd7sa5a1r01qorsvhvrm0';

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
    
    // 使用 Finnhub API 获取股票报价
    const quoteUrl = `https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${FINNHUB_API_KEY}`;
    
    const response = await client.fetch(quoteUrl);
    
    // 解析 JSON 内容
    const htmlContent = response.content
      .filter((item: any) => item.type === 'text')
      .map((item: any) => item.text)
      .join('\n');
    
    const quoteData = JSON.parse(htmlContent);
    
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

export default router;
