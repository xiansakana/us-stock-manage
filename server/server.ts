// ABOUTME: Express server with Vite integration
// ABOUTME: Handles API routes and serves frontend in dev/prod modes

import 'dotenv/config';
import { createServer, type Server } from 'http';
import cookieParser from 'cookie-parser';
import express from 'express';
import { setupVite } from './vite';
import { getPortfolio, savePortfolio } from './storage/portfolioStore';

const isDev = process.env.COZE_PROJECT_ENV !== 'PROD';
const port = parseInt(process.env.PORT || '5000', 10);
const hostname = process.env.HOSTNAME || 'localhost';
const app = express();

if (process.env.TRUST_PROXY === '1' || process.env.TRUST_PROXY === 'true') {
  app.set('trust proxy', 1);
}

// 使用 http.createServer 包装 Express app，以便支持 WebSocket 等协议升级
const server = createServer(app);

// 内存用户存储（用于开发演示）
const users = new Map<string, { id: string; email: string; passwordHash: string }>();
interface SessionData {
  userId: string;
  email: string;
  portfolio?: {
    stocks: unknown[];
    cash: number;
  };
}
const sessions = new Map<string, SessionData>();

async function startServer(): Promise<Server> {
  // 请求日志（仅开发环境）
  if (isDev) {
    app.use((req, res, next) => {
      const start = Date.now();
      res.on('finish', () => {
        const ms = Date.now() - start;
        console.log(`${req.method} ${req.url} - ${ms}ms`);
      });
      next();
    });
  }

  // 添加请求体解析
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser());

  // 健康检查
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', env: isDev ? 'DEV' : 'PROD', timestamp: new Date().toISOString() });
  });

  // 注册
  app.post('/api/auth/register', (req, res) => {
    const { email, password } = req.body as { email?: string; password?: string };
    
    if (!email || !password) {
      return res.status(400).json({ error: '邮箱和密码不能为空' });
    }
    
    if (password.length < 6) {
      return res.status(400).json({ error: '密码至少6位' });
    }
    
    if (users.has(email)) {
      return res.status(400).json({ error: '该邮箱已注册' });
    }
    
    // 生成 token
    const token = Buffer.from(`${email}:${Date.now()}`).toString('base64');
    users.set(email, { id: crypto.randomUUID(), email, passwordHash: password });
    sessions.set(token, { userId: email, email });
    
    console.log(`注册成功: ${email}`);
    res.json({
      success: true,
      user: { email },
      token
    });
  });

  // 登录
  app.post('/api/auth/login', (req, res) => {
    const { email, password } = req.body as { email?: string; password?: string };
    
    if (!email || !password) {
      return res.status(400).json({ error: '邮箱和密码不能为空' });
    }
    
    const user = users.get(email);
    if (!user || user.passwordHash !== password) {
      return res.status(401).json({ error: '邮箱或密码错误' });
    }
    
    // 生成 token
    const token = Buffer.from(`${email}:${Date.now()}`).toString('base64');
    sessions.set(token, { userId: user.id, email });
    
    console.log(`登录成功: ${email}`);
    res.json({
      success: true,
      user: { email },
      token
    });
  });

  // 登出
  app.post('/api/auth/logout', (req, res) => {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.slice(7);
      sessions.delete(token);
    }
    res.json({ success: true });
  });

  // 获取持仓
  app.get('/api/portfolios', async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: '未登录' });
    }
    
    const token = authHeader.slice(7);
    const session = sessions.get(token);
    if (!session) {
      return res.status(401).json({ error: 'Token 无效或已过期' });
    }
    
    try {
      const portfolio = await getPortfolio(token);
      res.json(portfolio);
    } catch (error) {
      console.error('获取持仓失败:', error);
      res.status(500).json({ error: '获取持仓失败' });
    }
  });

  // 保存持仓
  app.put('/api/portfolios', async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: '未登录' });
    }
    
    const token = authHeader.slice(7);
    const session = sessions.get(token);
    if (!session) {
      return res.status(401).json({ error: 'Token 无效或已过期' });
    }
    
    const { stocks = [], cash = 0 } = req.body as { stocks?: unknown[]; cash?: number };
    
    try {
      await savePortfolio(token, { stocks, cash });
      // 同时更新内存会话
      session.portfolio = { stocks, cash };
      res.json({ success: true });
    } catch (error) {
      console.error('保存持仓失败:', error);
      res.status(500).json({ error: '保存持仓失败' });
    }
  });

  // 股票查询 (Finnhub)
  app.get('/api/stock/:symbol', async (req, res) => {
    const { symbol } = req.params;
    try {
      const finnhubKey = process.env.FINNHUB_API_KEY || 'd7sa5a1r01qorsvhvrlgd7sa5a1r01qorsvhvrm0';
      const response = await fetch(`https://finnhub.io/api/v1/quote?symbol=${symbol}&token=${finnhubKey}`);
      const data = await response.json() as { c?: number; d?: number; dp?: number };
      
      if (data.c && data.c > 0) {
        res.json({
          symbol,
          name: symbol,
          price: data.c,
          change: data.d || 0,
          changePercent: data.dp || 0
        });
      } else {
        res.status(404).json({ error: '股票未找到' });
      }
    } catch (error) {
      console.error('获取股票数据失败:', error);
      res.status(500).json({ error: '获取股票数据失败' });
    }
  });

  // 期权查询 (Polygon.io)
  app.get('/api/option/:symbol', async (req, res) => {
    const { symbol } = req.params;
    
    // 解析期权代码: AAPL260504C150 -> AAPL 2026-05-04 Call 150
    const match = symbol.match(/^([A-Z]+)(\d{2})(\d{2})(\d{2})([CP])(\d+)$/);
    
    if (!match) {
      return res.status(400).json({ error: '无效的期权代码格式' });
    }
    
    const [, underlying, yy, mm, dd, type, strikeStr] = match;
    const strike = parseFloat(strikeStr) / 1000;
    const year = 2000 + parseInt(yy);
    const expirationDate = `${year}-${mm}-${dd}`;
    
    // 转换为期权代码: AAPL260504C150 -> O:AAPL260504C00150000
    const polygonSymbol = `O:${underlying}${yy}${mm}${dd}${type}${strikeStr.padStart(8, '0')}`;
    
    try {
      const polygonKey = process.env.POLYGON_API_KEY || 'ksTLCk4yRwmpfGycHMVKdvYIWyoAuCsb';
      const response = await fetch(
        `https://api.polygon.io/v2/aggs/ticker/${polygonSymbol}/prev?adjusted=true&apiKey=${polygonKey}`
      );
      const data = await response.json() as { results?: Array<{ c?: number; o?: number; h?: number; l?: number; v?: number }> };
      
      if (data.results && data.results.length > 0 && data.results[0].c) {
        const result = data.results[0];
        res.json({
          symbol,
          name: `${underlying} ${expirationDate.replace('20', '')} ${type === 'C' ? 'Call' : 'Put'} $${strike}`,
          price: result.c,
          type: type === 'C' ? 'call' : 'put',
          strikePrice: strike,
          expirationDate,
          underlying
        });
      } else {
        res.status(404).json({ error: '期权未找到或无价格数据' });
      }
    } catch (error) {
      console.error('获取期权数据失败:', error);
      res.status(500).json({ error: '获取期权数据失败' });
    }
  });

  // 集成 Vite（开发模式）或静态文件服务（生产模式）
  await setupVite(app);

  // 全局错误处理
  app.use((err: Error, req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error('Server error:', err);
    const status = 'status' in err ? (err as { status?: number }).status || 500 : 500;
    if (res && typeof res.status === 'function') {
      res.status(status).json({
        error: err.message || 'Internal server error',
      });
    }
  });

  server.once('error', (err) => {
    console.error('Server error:', err);
    process.exit(1);
  });

  server.listen(port, () => {
    console.log(`\n✨ Server running at http://${hostname}:${port}`);
    console.log(`📝 Environment: ${isDev ? 'development' : 'production'}\n`);
  });

  return server;
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
