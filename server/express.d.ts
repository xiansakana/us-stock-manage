import 'express';

declare global {
  namespace Express {
    interface Request {
      /** requireAuth 中间件校验 JWT 后写入 */
      authUser?: string;
    }
  }
}

export {};
