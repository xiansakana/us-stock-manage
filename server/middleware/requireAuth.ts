// ABOUTME: 校验 JWT Cookie，注入 req.authUser
import type { RequestHandler } from 'express';
import { verifyAuthToken } from '../lib/authTokens';

export const AUTH_COOKIE = 'auth_token';

export const requireAuth: RequestHandler = (req, res, next) => {
  const raw = req.cookies?.[AUTH_COOKIE];
  if (typeof raw !== 'string' || !raw) {
    return res.status(401).json({ error: '未登录' });
  }
  const v = verifyAuthToken(raw);
  if (!v) {
    return res.status(401).json({ error: '登录已失效，请重新登录' });
  }
  req.authUser = v.sub;
  next();
};
