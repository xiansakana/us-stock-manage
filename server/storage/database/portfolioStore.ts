// 交易记录与持仓管理（Supabase 数据库）
import { getSupabaseClient } from './supabase-client';

export interface Trade {
  id: string;
  user_id: string;
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

export interface TradeInput {
  symbol: string;
  name: string;
  type: 'buy' | 'sell';
  shares: number;
  price: number;
  commission?: number;
  trade_date?: string;
}

export interface Position {
  symbol: string;
  name: string;
  shares: number;        // 当前持股数
  avgCost: number;      // 平均成本
  totalCost: number;     // 总成本
  totalBuyAmount: number; // 总买入金额
  totalSellAmount: number; // 总卖出金额
  realizedPL: number;    // 已实现盈亏
  unrealizedPL: number;  // 浮盈/浮亏（需要当前价格）
  currentPrice?: number; // 当前价格
}

export interface ProfitLoss {
  totalBuyAmount: number;
  totalSellAmount: number;
  realizedPL: number;    // 已实现盈亏（卖出产生的）
  commission: number;     // 总手续费
  netPL: number;          // 净盈亏
}

// 获取用户所有交易记录
export async function getTrades(
  userId: string, 
  options?: { 
    symbol?: string; 
    startDate?: string; 
    endDate?: string;
    limit?: number;
  }
): Promise<Trade[]> {
  const client = getSupabaseClient();
  
  let query = client
    .from('trades')
    .select('*')
    .eq('user_id', userId)
    .order('trade_date', { ascending: false });
  
  if (options?.symbol) {
    query = query.eq('symbol', options.symbol);
  }
  
  if (options?.startDate) {
    query = query.gte('trade_date', options.startDate);
  }
  
  if (options?.endDate) {
    query = query.lte('trade_date', options.endDate);
  }
  
  if (options?.limit) {
    query = query.limit(options.limit);
  }
  
  const { data, error } = await query;
  
  if (error) {
    throw new Error(`查询交易记录失败: ${error.message}`);
  }
  
  return (data || []) as Trade[];
}

// 添加交易记录
export async function addTrade(userId: string, trade: TradeInput): Promise<Trade> {
  const client = getSupabaseClient();
  
  const totalAmount = trade.shares * trade.price;
  
  const { data, error } = await client
    .from('trades')
    .insert({
      user_id: userId,
      symbol: trade.symbol.toUpperCase(),
      name: trade.name,
      type: trade.type,
      shares: trade.shares.toString(),
      price: trade.price.toString(),
      total_amount: totalAmount.toString(),
      commission: (trade.commission || 0).toString(),
      trade_date: trade.trade_date || new Date().toISOString()
    })
    .select()
    .single();
  
  if (error) {
    throw new Error(`添加交易记录失败: ${error.message}`);
  }
  
  console.log(`Trade added: ${trade.type.toUpperCase()} ${trade.shares} ${trade.symbol} @ ${trade.price}`);
  return data as Trade;
}

// 获取当前持仓（基于交易记录计算）
export async function getPositions(userId: string): Promise<Position[]> {
  const trades = await getTrades(userId);
  
  // 按股票分组
  const positionsMap = new Map<string, {
    name: string;
    totalBuyShares: number;
    totalBuyAmount: number;
    totalSellShares: number;
    totalSellAmount: number;
    buyTrades: Array<{ shares: number; price: number }>;
  }>();
  
  for (const trade of trades) {
    if (!positionsMap.has(trade.symbol)) {
      positionsMap.set(trade.symbol, {
        name: trade.name,
        totalBuyShares: 0,
        totalBuyAmount: 0,
        totalSellShares: 0,
        totalSellAmount: 0,
        buyTrades: []
      });
    }
    
    const pos = positionsMap.get(trade.symbol)!;
    
    if (trade.type === 'buy') {
      pos.totalBuyShares += trade.shares;
      pos.totalBuyAmount += trade.total_amount;
      pos.buyTrades.push({ shares: trade.shares, price: trade.price });
    } else {
      pos.totalSellShares += trade.shares;
      pos.totalSellAmount += trade.total_amount;
    }
  }
  
  // 计算每个股票的持仓
  const positions: Position[] = [];
  
  for (const [symbol, pos] of positionsMap) {
    const currentShares = pos.totalBuyShares - pos.totalSellShares;
    
    if (currentShares <= 0) {
      // 已全部卖出，计算已实现盈亏
      positions.push({
        symbol,
        name: pos.name,
        shares: 0,
        avgCost: 0,
        totalCost: 0,
        totalBuyAmount: pos.totalBuyAmount,
        totalSellAmount: pos.totalSellAmount,
        realizedPL: pos.totalSellAmount - calculateCostBasis(pos.buyTrades, pos.totalSellShares),
        unrealizedPL: 0
      });
    } else {
      // 仍有持仓，计算平均成本
      const avgCost = pos.totalBuyAmount / pos.totalBuyShares;
      positions.push({
        symbol,
        name: pos.name,
        shares: currentShares,
        avgCost,
        totalCost: avgCost * currentShares,
        totalBuyAmount: pos.totalBuyAmount,
        totalSellAmount: pos.totalSellAmount,
        realizedPL: 0,
        unrealizedPL: 0
      });
    }
  }
  
  return positions;
}

// 计算卖出股票的成本基础（先进先出法）
function calculateCostBasis(buyTrades: Array<{ shares: number; price: number }>, sellShares: number): number {
  let remaining = sellShares;
  let totalCost = 0;
  
  // 按时间顺序（先进先出）
  for (const buy of buyTrades) {
    if (remaining <= 0) break;
    
    const usedShares = Math.min(remaining, buy.shares);
    totalCost += usedShares * buy.price;
    remaining -= usedShares;
  }
  
  return totalCost;
}

// 计算时间段内的盈亏
export async function getProfitLoss(
  userId: string, 
  options?: { startDate?: string; endDate?: string; symbol?: string }
): Promise<ProfitLoss> {
  const trades = await getTrades(userId, options);
  
  let totalBuyAmount = 0;
  let totalSellAmount = 0;
  let commission = 0;
  
  for (const trade of trades) {
    commission += trade.commission;
    if (trade.type === 'buy') {
      totalBuyAmount += trade.total_amount;
    } else {
      totalSellAmount += trade.total_amount;
    }
  }
  
  // 计算已实现盈亏需要更复杂的 FIFO 计算
  let realizedPL = 0;
  
  // 获取所有交易用于 FIFO 计算
  const allTrades = await getTrades(userId, { symbol: options?.symbol });
  
  // 按 symbol 分组计算
  const tradesBySymbol = new Map<string, Trade[]>();
  for (const trade of allTrades) {
    if (!tradesBySymbol.has(trade.symbol)) {
      tradesBySymbol.set(trade.symbol, []);
    }
    tradesBySymbol.get(trade.symbol)!.push(trade);
  }
  
  // 按时间排序
  for (const [, symTrades] of tradesBySymbol) {
    symTrades.sort((a, b) => new Date(a.trade_date).getTime() - new Date(b.trade_date).getTime());
    
    // FIFO 计算
    const buyQueue: Array<{ shares: number; price: number }> = [];
    
    for (const trade of symTrades) {
      if (trade.type === 'buy') {
        buyQueue.push({ shares: trade.shares, price: trade.price });
      } else {
        let remaining = trade.shares;
        while (remaining > 0 && buyQueue.length > 0) {
          const first = buyQueue[0];
          const usedShares = Math.min(remaining, first.shares);
          realizedPL += usedShares * (trade.price - first.price);
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
    // 净盈亏 = 已实现盈亏 + 浮盈/浮亏 - 手续费
    // 当前不考虑浮盈/浮亏，需要外部提供当前价格
    netPL: realizedPL - commission
  };
}

// 删除交易记录（用于修正错误）
export async function deleteTrade(userId: string, tradeId: string): Promise<void> {
  const client = getSupabaseClient();
  
  const { error } = await client
    .from('trades')
    .delete()
    .eq('id', tradeId)
    .eq('user_id', userId); // 确保只能删除自己的交易
  
  if (error) {
    throw new Error(`删除交易记录失败: ${error.message}`);
  }
}

// 获取单个持仓详情（包括历史交易）
export async function getPositionDetail(userId: string, symbol: string): Promise<{
  position: Position;
  trades: Trade[];
}> {
  const [positions, trades] = await Promise.all([
    getPositions(userId),
    getTrades(userId, { symbol })
  ]);
  
  const position = positions.find(p => p.symbol === symbol);
  
  if (!position) {
    throw new Error(`未找到 ${symbol} 的持仓记录`);
  }
  
  return { position, trades };
}
