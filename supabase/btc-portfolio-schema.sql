-- BTC Portfolio Tracker - Cloud Sync Schema
-- Run this in Supabase SQL Editor to create the required table
-- Project: family-budget-tracker (https://vkuhcjcpzhgfszrcavhr.supabase.co)

-- Portfolio data table: stores the full parsed portfolio state as a JSON blob
-- Single-user design: one row per user_id (default 'cruise')
CREATE TABLE IF NOT EXISTS btc_portfolio (
  id SERIAL PRIMARY KEY,
  user_id TEXT NOT NULL DEFAULT 'cruise',
  transactions JSONB NOT NULL DEFAULT '[]'::jsonb,
  portfolio_state JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id)
);

-- Enable RLS
ALTER TABLE btc_portfolio ENABLE ROW LEVEL SECURITY;

-- Allow public read/write (same pattern as other tables in this project)
CREATE POLICY "Anyone can read btc_portfolio" ON btc_portfolio FOR SELECT USING (true);
CREATE POLICY "Anyone can insert btc_portfolio" ON btc_portfolio FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update btc_portfolio" ON btc_portfolio FOR UPDATE USING (true);
CREATE POLICY "Anyone can delete btc_portfolio" ON btc_portfolio FOR DELETE USING (true);

-- Index on user_id for fast lookups
CREATE INDEX IF NOT EXISTS idx_btc_portfolio_user_id ON btc_portfolio(user_id);

-- Usage notes:
-- transactions: full array of parsed CSV Transaction objects
-- portfolio_state: computed metrics (totalBtc, totalUsdSpent, avgCostPerBtc, monthlyData, chartData, buyPoints)
-- The app upserts on user_id='cruise' so there's always exactly one row
