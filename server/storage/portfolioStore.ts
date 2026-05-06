// 持仓数据持久化存储（JSON 文件）
import fs from 'fs/promises';
import path from 'path';
import { DATA_ROOT } from '../lib/dataRoot';

interface Stock {
  symbol: string;
  name: string;
  shares: number;
  avgCost: number;
}

interface PortfolioRecord {
  userId: string;
  stocks: Stock[];
  cash: number;
  updatedAt: string;
}

interface PortfolioStoreShape {
  portfolios: PortfolioRecord[];
}

function portfolioFilePath(): string {
  return path.join(DATA_ROOT, 'portfolios.json');
}

async function readStore(): Promise<PortfolioStoreShape> {
  const fp = portfolioFilePath();
  try {
    const raw = await fs.readFile(fp, 'utf8');
    const p = JSON.parse(raw) as PortfolioStoreShape;
    if (!Array.isArray(p.portfolios)) return { portfolios: [] };
    return p;
  } catch (e) {
    const code = e && typeof e === 'object' && 'code' in e ? (e as NodeJS.ErrnoException).code : '';
    if (code === 'ENOENT') return { portfolios: [] };
    throw e;
  }
}

async function writeStore(store: PortfolioStoreShape): Promise<void> {
  const fp = portfolioFilePath();
  await fs.mkdir(path.dirname(fp), { recursive: true });
  await fs.writeFile(fp, JSON.stringify(store, null, 2), 'utf8');
}

// 串行化写操作，防止并发冲突
let writeChain: Promise<void> = Promise.resolve();

function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = writeChain.then(fn);
  writeChain = next.then(
    () => undefined,
    () => undefined
  );
  return next;
}

export interface PortfolioData {
  stocks: Stock[];
  cash: number;
}

export async function getPortfolio(userId: string): Promise<PortfolioData> {
  const store = await readStore();
  const record = store.portfolios.find(p => p.userId === userId);
  if (!record) {
    return { stocks: [], cash: 0 };
  }
  return {
    stocks: record.stocks,
    cash: record.cash
  };
}

export async function savePortfolio(userId: string, data: PortfolioData): Promise<void> {
  return withLock(async () => {
    const store = await readStore();
    const index = store.portfolios.findIndex(p => p.userId === userId);
    const record: PortfolioRecord = {
      userId,
      stocks: data.stocks,
      cash: data.cash,
      updatedAt: new Date().toISOString()
    };
    
    if (index >= 0) {
      store.portfolios[index] = record;
    } else {
      store.portfolios.push(record);
    }
    
    await writeStore(store);
    console.log(`Portfolio saved for user: ${userId.substring(0, 8)}...`);
  });
}

export async function deletePortfolio(userId: string): Promise<void> {
  return withLock(async () => {
    const store = await readStore();
    store.portfolios = store.portfolios.filter(p => p.userId !== userId);
    await writeStore(store);
  });
}
