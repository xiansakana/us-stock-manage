// ABOUTME: 注册、登录、登出、当前用户
import { Router } from 'express';
import { signAuthToken, verifyAuthToken } from '../lib/authTokens';
import { parsePassword, parseUsername } from '../lib/authValidate';
import { createUser, verifyCredentials } from '../lib/usersStore';
import { AUTH_COOKIE } from '../middleware/requireAuth';

const router = Router();

function isSecureCookie(): boolean {
  if (process.env.COOKIE_SECURE === 'true') return true;
  if (process.env.COOKIE_SECURE === 'false') return false;
  return process.env.COZE_PROJECT_ENV === 'PROD' || process.env.NODE_ENV === 'production';
}

function setAuthCookie(res: import('express').Response, token: string): void {
  res.cookie(AUTH_COOKIE, token, {
    httpOnly: true,
    secure: isSecureCookie(),
    sameSite: 'lax',
    maxAge: 30 * 24 * 60 * 60 * 1000,
    path: '/',
  });
}

/** POST /api/auth/register */
router.post('/auth/register', async (req, res) => {
  const username = parseUsername(req.body?.username);
  const password = parsePassword(req.body?.password);
  if (!username || !password) {
    return res.status(400).json({
      error:
        '用户名须为 3–32 位字母、数字或下划线；密码长度 8–128 位。',
    });
  }
  try {
    const created = await createUser(username, password);
    if (created === 'exists') {
      return res.status(409).json({ error: '该用户名已被注册' });
    }
    const token = signAuthToken(username);
    setAuthCookie(res, token);
    return res.status(201).json({ username });
  } catch (e) {
    console.error('register:', e);
    return res.status(500).json({ error: '注册失败' });
  }
});

/** POST /api/auth/login */
router.post('/auth/login', async (req, res) => {
  const username = parseUsername(req.body?.username);
  const password = parsePassword(req.body?.password);
  if (!username || !password) {
    return res.status(400).json({ error: '用户名或密码格式不正确' });
  }
  try {
    const ok = await verifyCredentials(username, password);
    if (!ok) {
      return res.status(401).json({ error: '用户名或密码错误' });
    }
    const token = signAuthToken(username);
    setAuthCookie(res, token);
    return res.json({ username });
  } catch (e) {
    console.error('login:', e);
    return res.status(500).json({ error: '登录失败' });
  }
});

/** POST /api/auth/logout */
router.post('/auth/logout', (req, res) => {
  res.clearCookie(AUTH_COOKIE, { path: '/' });
  res.json({ ok: true });
});

/** GET /api/auth/me */
router.get('/auth/me', (req, res) => {
  const raw = req.cookies?.[AUTH_COOKIE];
  if (typeof raw !== 'string' || !raw) {
    return res.status(401).json({ error: '未登录' });
  }
  const v = verifyAuthToken(raw);
  if (!v) {
    return res.status(401).json({ error: '未登录' });
  }
  return res.json({ username: v.sub });
});

export default router;
