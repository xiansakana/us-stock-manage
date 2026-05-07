# 项目上下文

## 技术栈

- **核心**: Vite 7, TypeScript, Express
- **UI**: Tailwind CSS
- **数据**: 浏览器 localStorage（持仓 `stockPortfolio`、交易 `stockTrades`）；服务端仅代理行情 API
- **Node.js**: 24

## 目录结构

```
├── scripts/            # 构建与启动脚本
│   ├── build.sh        # 构建脚本（前端 Vite build + 服务端 tsup bundle）
│   ├── dev.sh          # 开发环境启动脚本
│   ├── prepare.sh      # 预处理脚本（安装依赖）
│   ├── start.sh        # 生产环境启动脚本
│   └── validate.sh     # 验证脚本
├── server/             # 服务端逻辑
│   ├── routes/         # API 路由
│   ├── server.ts       # Express 服务入口
│   └── vite.ts         # Vite 中间件集成
├── src/                # 前端源码
│   ├── index.css       # 全局样式
│   ├── index.ts        # 客户端入口
│   └── main.ts         # 主逻辑
├── index.html          # 入口 HTML
├── package.json        # 项目依赖管理
├── tsconfig.json       # TypeScript 配置
└── vite.config.ts      # Vite 配置
```

## 包管理规范

**仅允许使用 pnpm** 作为包管理器，**严禁使用 npm 或 yarn**。
**常用命令**：
- 安装依赖：`pnpm add <package>`
- 安装开发依赖：`pnpm add -D <package>`
- 安装所有依赖：`pnpm install`
- 移除依赖：`pnpm remove <package>`

## 开发规范

- 使用 Tailwind CSS 进行样式开发

### 编码规范

- 默认按 TypeScript `strict` 心智写代码；优先复用当前作用域已声明的变量、函数、类型和导入，禁止引用未声明标识符或拼错变量名。
- 禁止隐式 `any` 和 `as any`；函数参数、返回值、解构项、事件对象、Express `req`/`res`、`catch` 错误在使用前应有明确类型或先完成类型收窄，并清理未使用的变量和导入。

## 运行与预览

### 开发预览

```bash
# 预处理（安装依赖）
bash scripts/prepare.sh

# 启动开发服务（Vite + Express，端口 5000）
bash scripts/dev.sh
```

预览验证：访问 `http://localhost:5000`，返回 HTTP 200。

### 生产构建与部署

```bash
# 构建
bash scripts/build.sh

# 启动生产服务
bash scripts/start.sh
```

## 项目初始化记录

- **sub_id**: `0527ad55`
- **project_type**: `web`
- **preview_enable**: `enabled`
- **deploy_profile**: `kind = "service", flavor = "web"`
- **requires**: `nodejs-24`

### 预览链路说明

- Vite dev server 以中间件模式集成到 Express
- 服务绑定 `0.0.0.0:5000`（IPv4 全接口）
- HMR 已配置（端口 6000）
- 预览通过 `scripts/prepare.sh` 安装依赖，`scripts/dev.sh` 启动服务

### 部署链路说明

- 构建产物：`dist/`（前端）+ `dist-server/`（服务端）
- 生产入口：`node dist-server/server.js`
- 端口固定为 `5000`

### 数据持久化与 API

**浏览器（localStorage）：**
- `stockPortfolio` — 持仓与现金（JSON）
- `stockTrades` — 交易记录数组（JSON）

**客户端逻辑：**
- `src/main.ts` — 界面与写入 localStorage
- `src/localTrades.ts` — FIFO 盈亏与区间汇总（与原先服务端口径一致）

**服务端行情（`server/routes/stocks.ts`，挂载在 `/api`）：**
- `GET /api/stock/:symbol` — Finnhub 报价
- `GET /api/option/:symbol` — Polygon 期权
- `GET /api/search` — Finnhub Symbol Search
- `GET /api/symbol/canonical-underlying/:symbol` — ETF 主成分推断
- `GET /api/options/chain/:underlying` — 期权链（可选）

**环境变量（可选）：** `FINNHUB_API_KEY`、`POLYGON_API_KEY`

**前端交易功能：** 买/卖记录、交易记录弹窗（筛选、分页、导入导出）、盈亏面板按时间段查询；无登录，数据仅存本机。
