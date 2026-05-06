// 持仓数据 Schema
import { sql } from "drizzle-orm";
import { pgTable, text, varchar, timestamp, numeric, index } from "drizzle-orm/pg-core";

// 用户持仓主表
export const portfolios = pgTable(
  "portfolios",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    user_id: varchar("user_id", { length: 255 }).notNull().unique(), // 用户标识（token）
    cash: numeric("cash", { precision: 15, scale: 2 }).notNull().default(0),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("portfolios_user_id_idx").on(table.user_id),
  ]
);

// 用户持仓股票表
export const portfolioStocks = pgTable(
  "portfolio_stocks",
  {
    id: varchar("id", { length: 36 }).primaryKey().default(sql`gen_random_uuid()`),
    portfolio_id: varchar("portfolio_id", { length: 36 }).notNull().references(() => portfolios.id, { onDelete: "cascade" }),
    symbol: varchar("symbol", { length: 20 }).notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    shares: numeric("shares", { precision: 15, scale: 6 }).notNull(),
    avg_cost: numeric("avg_cost", { precision: 15, scale: 4 }).notNull(),
    created_at: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updated_at: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("portfolio_stocks_portfolio_id_idx").on(table.portfolio_id),
    index("portfolio_stocks_symbol_idx").on(table.symbol),
  ]
);

// 类型导出
export type Portfolio = typeof portfolios.$inferSelect;
export type PortfolioStock = typeof portfolioStocks.$inferSelect;
export type InsertPortfolio = typeof portfolios.$inferInsert;
export type InsertPortfolioStock = typeof portfolioStocks.$inferInsert;
