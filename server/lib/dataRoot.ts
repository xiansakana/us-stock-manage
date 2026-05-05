// ABOUTME: 数据目录：优先 PORTFOLIO_DATA_DIR；否则尝试 cwd/data；不可写时回退到系统临时目录（Serverless 常见）
import fs from 'fs';
import os from 'os';
import path from 'path';

function computeDataRoot(): string {
  const env = process.env.PORTFOLIO_DATA_DIR?.trim();
  if (env) {
    console.log('[data] PORTFOLIO_DATA_DIR=', env);
    return env;
  }
  const cwdData = path.join(process.cwd(), 'data');
  try {
    fs.mkdirSync(cwdData, { recursive: true });
    fs.accessSync(cwdData, fs.constants.W_OK);
    console.log('[data] using', cwdData);
    return cwdData;
  } catch {
    const fallback = path.join(os.tmpdir(), 'us-stock-manage-data');
    fs.mkdirSync(fallback, { recursive: true });
    console.warn(
      `[data] 无法在进程目录下创建可写 data（${cwdData}），已改用临时目录：${fallback}。可设置环境变量 PORTFOLIO_DATA_DIR 指向持久卷。`
    );
    return fallback;
  }
}

/** 用户库、持仓 JSON 的根目录（进程启动时解析一次） */
export const DATA_ROOT = computeDataRoot();
