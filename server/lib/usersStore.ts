// ABOUTME: 用户账号 JSON 存储（用户名 + bcrypt 密码哈希）
import bcrypt from 'bcryptjs';
import fs from 'fs/promises';
import path from 'path';

interface UserRecord {
  username: string;
  passwordHash: string;
}

interface UsersFileShape {
  users: UserRecord[];
}

function usersFilePath(): string {
  const base = process.env.PORTFOLIO_DATA_DIR?.trim() || path.join(process.cwd(), 'data');
  return path.join(base, 'users.json');
}

async function readStore(): Promise<UsersFileShape> {
  const fp = usersFilePath();
  try {
    const raw = await fs.readFile(fp, 'utf8');
    const p = JSON.parse(raw) as UsersFileShape;
    if (!Array.isArray(p.users)) return { users: [] };
    return p;
  } catch (e) {
    const code = e && typeof e === 'object' && 'code' in e ? (e as NodeJS.ErrnoException).code : '';
    if (code === 'ENOENT') return { users: [] };
    throw e;
  }
}

async function writeStore(store: UsersFileShape): Promise<void> {
  const fp = usersFilePath();
  await fs.mkdir(path.dirname(fp), { recursive: true });
  await fs.writeFile(fp, JSON.stringify(store, null, 2), 'utf8');
}

let chain: Promise<void> = Promise.resolve();

function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const next = chain.then(fn);
  chain = next.then(
    () => undefined,
    () => undefined
  );
  return next;
}

export async function createUser(username: string, password: string): Promise<'ok' | 'exists'> {
  return withLock(async () => {
    const store = await readStore();
    if (store.users.some(u => u.username === username)) return 'exists';
    const passwordHash = bcrypt.hashSync(password, 12);
    store.users.push({ username, passwordHash });
    await writeStore(store);
    return 'ok';
  });
}

export async function verifyCredentials(username: string, password: string): Promise<boolean> {
  const store = await readStore();
  const u = store.users.find(x => x.username === username);
  if (!u) return false;
  return bcrypt.compareSync(password, u.passwordHash);
}
