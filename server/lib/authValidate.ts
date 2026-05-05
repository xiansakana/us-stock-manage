// ABOUTME: 注册/登录入参校验

export function parseUsername(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const u = raw.trim();
  if (!/^[a-zA-Z0-9_]{3,32}$/.test(u)) return null;
  return u;
}

export function parsePassword(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  if (raw.length < 8 || raw.length > 128) return null;
  return raw;
}
