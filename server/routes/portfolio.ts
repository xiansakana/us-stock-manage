// 持仓组合服务端持久化（JSON 文件存储）
import { Router } from 'express';
import { getPortfolio, savePortfolio, type PortfolioData } from '../storage/portfolioStore';

const router = Router();

// 持仓数据结构
interface Stock {
  symbol: string;
  name: string;
  shares: number;
  avgCost: number;
}

// 获取持仓
router.get('/', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: '未登录' });
  }
  
  const token = authHeader.slice(7);
  
  try {
    const portfolio = await getPortfolio(token);
    res.json(portfolio);
  } catch (error) {
    console.error('获取持仓失败:', error);
    res.status(500).json({ error: '获取持仓失败' });
  }
});

// 保存持仓
router.put('/', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: '未登录' });
  }
  
  const token = authHeader.slice(7);
  const { stocks = [], cash = 0 } = req.body as PortfolioData;
  
  try {
    await savePortfolio(token, { stocks, cash });
    res.json({ success: true });
  } catch (error) {
    console.error('保存持仓失败:', error);
    res.status(500).json({ error: '保存持仓失败' });
  }
});

export default router;
