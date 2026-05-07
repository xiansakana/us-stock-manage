// ABOUTME: Client-side FIFO profit/loss and windowed trade aggregates

export interface TradeLike {
  id: string;
  symbol: string;
  name: string;
  type: 'buy' | 'sell';
  shares: number;
  price: number;
  total_amount: number;
  commission: number;
  trade_date: string;
  created_at: string;
}

export interface ProfitLossStats {
  totalBuyAmount: number;
  totalSellAmount: number;
  realizedPL: number;
  commission: number;
  netPL: number;
}

function tradeTime(t: string): number {
  return new Date(t).getTime();
}

function isOptionContractSymbol(symbol: string): boolean {
  return /^[A-Z]+\d{6}[CP]\d+(?:\.\d+)?$/i.test(symbol.trim());
}

/** Trades in optional date range and exact symbol (case-insensitive). */
function filterTradesForWindow(
  trades: readonly TradeLike[],
  options?: { startDate?: string; endDate?: string; symbol?: string }
): TradeLike[] {
  return trades.filter((t) => {
    if (options?.symbol && t.symbol.toUpperCase() !== options.symbol.toUpperCase()) {
      return false;
    }
    const d = t.trade_date.slice(0, 10);
    if (options?.startDate && d < options.startDate) return false;
    if (options?.endDate && d > options.endDate) return false;
    return true;
  });
}

/**
 * Buy/sell totals and commission use the filtered window; FIFO realized P&L is all-time
 * (optional symbol filter only), matching previous server behavior.
 */
export function computeProfitLoss(
  trades: readonly TradeLike[],
  options?: { startDate?: string; endDate?: string; symbol?: string }
): ProfitLossStats {
  const windowTrades = filterTradesForWindow(trades, options);

  let totalBuyAmount = 0;
  let totalSellAmount = 0;
  let commission = 0;
  for (const trade of windowTrades) {
    commission += trade.commission;
    if (trade.type === 'buy') {
      totalBuyAmount += trade.total_amount;
    } else {
      totalSellAmount += trade.total_amount;
    }
  }

  const fifoTrades = trades.filter((t) =>
    options?.symbol ? t.symbol.toUpperCase() === options.symbol.toUpperCase() : true
  );

  const tradesBySymbol = new Map<string, TradeLike[]>();
  for (const trade of fifoTrades) {
    const sym = trade.symbol;
    if (!tradesBySymbol.has(sym)) tradesBySymbol.set(sym, []);
    tradesBySymbol.get(sym)!.push(trade);
  }

  let realizedPL = 0;
  for (const [, symTrades] of tradesBySymbol) {
    symTrades.sort((a, b) => tradeTime(a.trade_date) - tradeTime(b.trade_date));
    const buyQueue: Array<{ shares: number; price: number }> = [];
    for (const trade of symTrades) {
      if (trade.type === 'buy') {
        buyQueue.push({ shares: trade.shares, price: trade.price });
      } else {
        let remaining = trade.shares;
        while (remaining > 0 && buyQueue.length > 0) {
          const first = buyQueue[0];
          const usedShares = Math.min(remaining, first.shares);
          const mult = isOptionContractSymbol(trade.symbol) ? 100 : 1;
          realizedPL += usedShares * (trade.price - first.price) * mult;
          first.shares -= usedShares;
          remaining -= usedShares;
          if (first.shares <= 0) {
            buyQueue.shift();
          }
        }
      }
    }
  }

  return {
    totalBuyAmount,
    totalSellAmount,
    realizedPL,
    commission,
    netPL: realizedPL - commission
  };
}

/** 剩余持仓一笔买入层（与 CostLot 一致：costPerShare = 单价） */
export interface DerivedLot {
  shares: number;
  costPerShare: number;
}

export interface DerivedHolding {
  symbol: string;
  name: string;
  shares: number;
  avgCost: number;
  costLots: DerivedLot[];
}

/** 按标的分组，FIFO 消耗卖出后得到的当前持仓、加权成本与余下批次 */
export function deriveHoldingsFromTrades(trades: readonly TradeLike[]): DerivedHolding[] {
  const bySym = new Map<string, TradeLike[]>();
  for (const t of trades) {
    const sym = t.symbol.trim().toUpperCase();
    if (!sym) continue;
    if (!bySym.has(sym)) bySym.set(sym, []);
    bySym.get(sym)!.push(t);
  }

  const out: DerivedHolding[] = [];

  for (const [symbol, symTrades] of bySym) {
    symTrades.sort((a, b) => {
      const ta = tradeTime(a.trade_date);
      const tb = tradeTime(b.trade_date);
      if (ta !== tb) return ta - tb;
      return a.id.localeCompare(b.id);
    });

    const queue: Array<{ shares: number; price: number }> = [];
    let latestName = symbol;

    for (const tr of symTrades) {
      if (tr.name && tr.name.trim()) latestName = tr.name.trim();
      if (tr.type === 'buy') {
        queue.push({ shares: tr.shares, price: tr.price });
      } else {
        let rem = tr.shares;
        while (rem > 0 && queue.length > 0) {
          const first = queue[0];
          const u = Math.min(rem, first.shares);
          first.shares -= u;
          rem -= u;
          if (first.shares <= 0) queue.shift();
        }
      }
    }

    const netShares = queue.reduce((s, x) => s + x.shares, 0);
    if (netShares <= 0) continue;

    const totalCost = queue.reduce((s, x) => s + x.shares * x.price, 0);
    const avgCost = totalCost / netShares;
    const costLots = queue.map((x) => ({ shares: x.shares, costPerShare: x.price }));

    out.push({
      symbol,
      name: latestName,
      shares: netShares,
      avgCost,
      costLots
    });
  }

  out.sort((a, b) => a.symbol.localeCompare(b.symbol));
  return out;
}
