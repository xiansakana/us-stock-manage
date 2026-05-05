// ABOUTME: 持仓组合服务端持久化（按用户分文件）
import { Router } from 'express';
import fs from 'fs/promises';
import path from 'path';
import { DATA_ROOT } from '../lib/dataRoot';
import { requireAuth } from '../middleware/requireAuth';

const router = Router();

export interface PortfolioPersistBody {
  stocks: unknown[];
  cash: unknown;
}

function dataFilePath(username: string): string {
  const base = DATA_ROOT;
  const safe = username.replace(/[^a-zA-Z0-9_]/g, '');
  if (safe !== username || !safe) {
    throw new Error('invalid username scope');
  }
  return path.join(base, 'portfolios', `${safe}.json`);
}

async function ensureDirForFile(filePath: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
}

function isValidPayload(body: unknown): body is PortfolioPersistBody {
  if (body === null || typeof body !== 'object') return false;
  const o = body as Record<string, unknown>;
  return Array.isArray(o.stocks) && typeof o.cash === 'number' && Number.isFinite(o.cash);
}

/** GET /api/portfolio — 读取当前登录用户的持仓 */
router.get('/portfolio', requireAuth, async (req, res) => {
  const username = req.authUser!;
  let filePath: string;
  try {
    filePath = dataFilePath(username);
  } catch {
    return res.status(400).json({ error: '无效用户' });
  }
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = JSON.parse(raw) as unknown;
    if (!isValidPayload(parsed)) {
      return res.status(500).json({ error: '服务端数据格式无效' });
    }
    return res.json(parsed);
  } catch (e) {
    const code = e && typeof e === 'object' && 'code' in e ? (e as NodeJS.ErrnoException).code : '';
    if (code === 'ENOENT') {
      return res.json({ stocks: [], cash: 0 });
    }
    console.error('portfolio read:', e);
    return res.status(500).json({ error: '读取持仓失败' });
  }
});

/** PUT /api/portfolio — 保存当前登录用户的持仓 */
router.put('/portfolio', requireAuth, async (req, res) => {
  const username = req.authUser!;
  const body = req.body as unknown;
  if (!isValidPayload(body)) {
    return res.status(400).json({ error: '请求体须为 { stocks: [], cash: number }' });
  }
  let filePath: string;
  try {
    filePath = dataFilePath(username);
  } catch {
    return res.status(400).json({ error: '无效用户' });
  }
  try {
    await ensureDirForFile(filePath);
    await fs.writeFile(filePath, JSON.stringify(body, null, 2), 'utf8');
    return res.json({ ok: true });
  } catch (e) {
    console.error('portfolio write:', e);
    return res.status(500).json({ error: '保存持仓失败' });
  }
});

export default router;
