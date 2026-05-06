// 简单的内存用户存储（用于开发演示）
// 生产环境请替换为真实数据库
import { Router } from 'express';
import crypto from 'crypto';

const router = Router();

// 内存用户存储
const users = new Map<string, { id: string; email: string; passwordHash: string }>();
const sessions = new Map<string, { userId: string; email: string }>();

// 简单的密码哈希函数
function hashPassword(password: string): string {
  return crypto.createHash('sha256').update(password).digest('hex');
}

// 生成随机 ID
function generateId(): string {
  return crypto.randomBytes(16).toString('hex');
}

// 生成随机 token
function generateToken(): string {
  return crypto.randomBytes(32).toString('hex');
}

// 注册
router.post('/register', async (req, res) => {
  const { email, password } = req.body as { email?: string; password?: string };
  
  if (!email || !password) {
    return res.status(400).json({ error: '邮箱和密码不能为空' });
  }
  
  if (password.length < 6) {
    return res.status(400).json({ error: '密码至少6位' });
  }
  
  // 检查邮箱格式
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    return res.status(400).json({ error: '请输入有效的邮箱地址' });
  }
  
  // 检查是否已存在
  if (users.has(email)) {
    return res.status(400).json({ error: '该邮箱已注册' });
  }
  
  // 创建用户
  const userId = generateId();
  const passwordHash = hashPassword(password);
  users.set(email, { id: userId, email, passwordHash });
  
  // 创建会话
  const token = generateToken();
  sessions.set(token, { userId, email });
  
  console.log(`注册成功: ${email}`);
  res.json({
    success: true,
    user: { id: userId, email },
    token
  });
});

// 登录
router.post('/login', async (req, res) => {
  const { email, password, token } = req.body as { email?: string; password?: string; token?: string };
  
  // 如果提供了 token，验证 token
  if (token) {
    const session = sessions.get(token);
    if (session) {
      return res.json({
        success: true,
        user: { id: session.userId, email: session.email }
      });
    }
    return res.status(401).json({ error: 'Token 无效或已过期' });
  }
  
  if (!email || !password) {
    return res.status(400).json({ error: '邮箱和密码不能为空' });
  }
  
  const user = users.get(email);
  if (!user) {
    return res.status(401).json({ error: '邮箱或密码错误' });
  }
  
  const passwordHash = hashPassword(password);
  if (user.passwordHash !== passwordHash) {
    return res.status(401).json({ error: '邮箱或密码错误' });
  }
  
  // 创建会话
  const newToken = generateToken();
  sessions.set(newToken, { userId: user.id, email: user.email });
  
  console.log(`登录成功: ${email}`);
  res.json({
    success: true,
    user: { id: user.id, email: user.email },
    token: newToken
  });
});

// 登出
router.post('/logout', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    sessions.delete(token);
  }
  res.json({ success: true });
});

// 验证 token
function verifyToken(authHeader: string | undefined): { userId: string; email: string } | null {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  const token = authHeader.slice(7);
  return sessions.get(token) || null;
}

export { router, verifyToken };
