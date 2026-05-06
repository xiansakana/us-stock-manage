// 持仓组合服务端持久化（使用内存存储演示）
import { Router } from 'express';

const router = Router();

// 内存持仓存储
const portfolios = new Map<string, { stocks: unknown[]; cash: number }>();

// 获取持仓
router.get('/', (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: '未登录' });
  }
  
  const token = authHeader.slice(7);
  // 简单验证：使用 token 作为 userId
  const portfolio = portfolios.get(token);
  if (!portfolio) {
    return res.json({ stocks: [], cash: 0 });
  }
  
  res.json(portfolio);
});

// 保存持仓
router.put('/', (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: '未登录' });
  }
  
  const token = authHeader.slice(7);
  const { stocks = [], cash = 0 } = req.body as { stocks?: unknown[]; cash?: number };
  
  portfolios.set(token, {
    stocks,
    cash
  });
  
  console.log(`保存持仓: ${token.substring(0, 8)}..., ${stocks.length} 个持仓`);
  res.json({ success: true });
});

export default router;
