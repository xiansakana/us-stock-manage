// 持仓数据持久化存储（Supabase 数据库）
import { getSupabaseClient } from './supabase-client';

export interface Stock {
  symbol: string;
  name: string;
  shares: number;
  avg_cost: number;
}

export interface PortfolioData {
  stocks: Stock[];
  cash: number;
}

interface DbPortfolio {
  id: string;
  user_id: string;
  cash: string;
  created_at: string;
  updated_at: string;
}

interface DbPortfolioStock {
  id: string;
  portfolio_id: string;
  symbol: string;
  name: string;
  shares: string;
  avg_cost: string;
  created_at: string;
  updated_at: string;
}

export async function getPortfolio(userId: string): Promise<PortfolioData> {
  const client = getSupabaseClient();
  
  // 查询持仓记录
  const { data: portfolio, error: portfolioError } = await client
    .from('portfolios')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();
  
  if (portfolioError) {
    throw new Error(`查询持仓失败: ${portfolioError.message}`);
  }
  
  if (!portfolio) {
    return { stocks: [], cash: 0 };
  }
  
  // 查询股票列表
  const { data: stocks, error: stocksError } = await client
    .from('portfolio_stocks')
    .select('symbol, name, shares, avg_cost')
    .eq('portfolio_id', (portfolio as DbPortfolio).id);
  
  if (stocksError) {
    throw new Error(`查询股票失败: ${stocksError.message}`);
  }
  
  return {
    stocks: (stocks as DbPortfolioStock[] | null)?.map(s => ({
      symbol: s.symbol,
      name: s.name,
      shares: parseFloat(s.shares),
      avg_cost: parseFloat(s.avg_cost)
    })) || [],
    cash: parseFloat((portfolio as DbPortfolio).cash)
  };
}

export async function savePortfolio(userId: string, data: PortfolioData): Promise<void> {
  const client = getSupabaseClient();
  
  // 查询或创建持仓记录
  const { data: existingPortfolio, error: queryError } = await client
    .from('portfolios')
    .select('id')
    .eq('user_id', userId)
    .maybeSingle();
  
  if (queryError) {
    throw new Error(`查询持仓失败: ${queryError.message}`);
  }
  
  let portfolioId: string;
  
  if (existingPortfolio) {
    // 更新现有持仓
    portfolioId = (existingPortfolio as DbPortfolio).id;
    const { error: updateError } = await client
      .from('portfolios')
      .update({
        cash: data.cash.toString(),
        updated_at: new Date().toISOString()
      })
      .eq('id', portfolioId);
    
    if (updateError) {
      throw new Error(`更新持仓失败: ${updateError.message}`);
    }
    
    // 删除现有股票
    const { error: deleteError } = await client
      .from('portfolio_stocks')
      .delete()
      .eq('portfolio_id', portfolioId);
    
    if (deleteError) {
      throw new Error(`删除股票失败: ${deleteError.message}`);
    }
  } else {
    // 创建新持仓
    const { data: newPortfolio, error: insertError } = await client
      .from('portfolios')
      .insert({
        user_id: userId,
        cash: data.cash.toString()
      })
      .select('id')
      .single();
    
    if (insertError) {
      throw new Error(`创建持仓失败: ${insertError.message}`);
    }
    
    portfolioId = (newPortfolio as DbPortfolio).id;
  }
  
  // 插入股票
  if (data.stocks.length > 0) {
    const stocksToInsert = data.stocks.map(stock => ({
      portfolio_id: portfolioId,
      symbol: stock.symbol,
      name: stock.name,
      shares: stock.shares.toString(),
      avg_cost: stock.avg_cost.toString()
    }));
    
    const { error: stocksError } = await client
      .from('portfolio_stocks')
      .insert(stocksToInsert);
    
    if (stocksError) {
      throw new Error(`保存股票失败: ${stocksError.message}`);
    }
  }
  
  console.log(`Portfolio saved for user: ${userId.substring(0, 8)}...`);
}

export async function deletePortfolio(userId: string): Promise<void> {
  const client = getSupabaseClient();
  
  // 先查询 portfolio id
  const { data: portfolio, error: queryError } = await client
    .from('portfolios')
    .select('id')
    .eq('user_id', userId)
    .maybeSingle();
  
  if (queryError) {
    throw new Error(`查询持仓失败: ${queryError.message}`);
  }
  
  if (portfolio) {
    // portfolio_stocks 会通过 CASCADE 自动删除
    const { error: deleteError } = await client
      .from('portfolios')
      .delete()
      .eq('user_id', userId);
    
    if (deleteError) {
      throw new Error(`删除持仓失败: ${deleteError.message}`);
    }
  }
}
