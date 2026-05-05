// ABOUTME: JWT 签发与校验（登录 Cookie）
import jwt from 'jsonwebtoken';

function getJwtSecret(): string {
  const s = process.env.JWT_SECRET?.trim();
  if (s && s.length >= 16) return s;
  const prod =
    process.env.COZE_PROJECT_ENV === 'PROD' ||
    process.env.NODE_ENV === 'production';
  if (prod) {
    throw new Error(
      'JWT_SECRET 环境变量未设置或长度不足 16。公网部署请务必配置强随机密钥。'
    );
  }
  console.warn(
    '[auth] 使用开发环境默认 JWT_SECRET，切勿用于生产。请设置 JWT_SECRET。'
  );
  return 'dev-only-jwt-secret-min16chars!';
}

export function signAuthToken(username: string): string {
  return jwt.sign({ sub: username }, getJwtSecret(), { expiresIn: '30d' });
}

export function verifyAuthToken(token: string): { sub: string } | null {
  try {
    const p = jwt.verify(token, getJwtSecret()) as jwt.JwtPayload;
    if (typeof p.sub === 'string' && p.sub.length > 0) return { sub: p.sub };
  } catch {
    /* invalid */
  }
  return null;
}
