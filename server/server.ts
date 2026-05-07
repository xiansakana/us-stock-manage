// ABOUTME: Express server with Vite integration
// ABOUTME: Handles API routes and serves frontend in dev/prod modes

import 'dotenv/config';
import { createServer, type Server } from 'http';
import express from 'express';
import { setupVite } from './vite';
import stocksRouter from './routes/stocks';

const isDev = process.env.COZE_PROJECT_ENV !== 'PROD';
const port = parseInt(process.env.PORT || '5000', 10);
const hostname = process.env.HOSTNAME || '0.0.0.0';
const app = express();

if (process.env.TRUST_PROXY === '1' || process.env.TRUST_PROXY === 'true') {
  app.set('trust proxy', 1);
}

// 使用 http.createServer 包装 Express app，以便支持 WebSocket 等协议升级
const server = createServer(app);

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

  // 健康检查
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', env: isDev ? 'DEV' : 'PROD', timestamp: new Date().toISOString() });
  });

  app.use('/api', stocksRouter);

  // 集成 Vite（开发模式）或静态文件服务（生产模式）
  await setupVite(app);

  // 全局错误处理
  app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
    void next;
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

  server.listen(port, hostname, () => {
    console.log(`\n✨ Server running at http://${hostname === '0.0.0.0' ? 'localhost' : hostname}:${port}`);
    console.log(`📝 Environment: ${isDev ? 'development' : 'production'}\n`);
  });

  return server;
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
