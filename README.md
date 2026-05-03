# BTC Portfolio Tracker

A self-hosted crypto portfolio tracker for Bitcoin and other major cryptocurrencies. Tracks your full cost basis, P&L, DCA performance, and portfolio allocation — with both local storage and Supabase cloud sync.

**Live:** [btc-portfolio-tracker.vercel.app](https://btc-portfolio-tracker.vercel.app)

---

## Features

### Portfolio Overview
- **Multi-asset support**: BTC, ETH, SOL — both CSV-imported and manually tracked positions
- **Cost basis tracking**: Average cost per unit, total USD spent, realized & unrealized P&L
- **Manual exchange holdings**: Hardcoded positions from exchanges without CSV export (Hashkey, OKX)
- **Live price feeds**: Real-time BTC, ETH, SOL prices via CoinGecko API
- **HKD/USD dual currency**: Supports HKD transactions with automatic 7.8 rate conversion

### DCA Tracking
- **Weekly DCA schedule**: Automatically calculates next Monday 8 AM UTC DCA session
- **BTC bought this week**: Live counter of current week's DCA purchases
- **Time to next DCA**: Countdown to next scheduled buy
- **CSV import**: Parse transaction history from CSV exports (Coinbase, etc.)

### Charts & Analytics
- **Portfolio value chart**: Area chart of total portfolio value over time
- **Monthly breakdown**: Bar chart of BTC purchased per month with average cost
- **Price trend chart**: BTC price history with buy-point markers (bubble size = cost)
- **Time range filter**: 1M / 3M / 6M / ALL view
- **P&L chart**: Portfolio value vs. cost basis over time

### Transaction History
- **Full CSV import**: Supports date, method, amount, currency, status fields
- **Sortable & filterable**: Sort by date/method/amount/currency/status
- **Pagination**: 20 transactions per page
- **Currency badges**: Color-coded BTC (orange), USD (green), HKD (blue), ETH (purple)

### Cloud Sync
- **Supabase backend**: Portfolio state persisted to Supabase PostgreSQL
- **LocalStorage fallback**: Works fully offline without cloud
- **Cloud-first loading**: Tries Supabase first, falls back to localStorage
- **One-click sync**: Manual push to cloud via sync button

---

## Tech Stack

| Layer | Tech |
|-------|------|
| Frontend | React 19, TypeScript, Vite |
| Styling | Tailwind CSS v4, Radix UI |
| Charts | Recharts |
| Routing | Wouter |
| Backend | Express (Node.js) for static file serving |
| Database | Supabase (PostgreSQL) |
| Deployment | Vercel |

### Architecture

```
btc-portfolio-tracker/
├── client/              # React frontend (Vite)
│   ├── src/
│   │   ├── pages/Home.tsx    # Main dashboard
│   │   ├── lib/supabase.ts   # Supabase client
│   │   ├── hooks/            # useMobile, usePersistFn, useComposition
│   │   └── components/ui/    # Radix UI primitive components
├── server/              # Express static file server
├── supabase/            # SQL schema for cloud sync table
│   └── btc-portfolio-schema.sql
└── shared/              # Shared constants (cookie name, etc.)
```

### Database Schema

```sql
CREATE TABLE btc_portfolio (
  id SERIAL PRIMARY KEY,
  user_id TEXT NOT NULL DEFAULT 'cruise',
  transactions JSONB NOT NULL DEFAULT '[]',
  portfolio_state JSONB NOT NULL DEFAULT '{}',
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id)
);
```

---

## Setup

### 1. Clone & Install

```bash
git clone https://github.com/OceanCD/btc-portfolio-tracker.git
cd btc-portfolio-tracker
pnpm install
```

### 2. Configure Environment

Create `client/.env`:

```env
VITE_OAUTH_PORTAL_URL=https://your-oauth-provider.com
VITE_APP_ID=your_app_id
```

The app works fully without OAuth — cloud sync to Supabase runs without auth for this single-user setup.

### 3. Supabase Setup (Cloud Sync)

1. Create a Supabase project at [supabase.com](https://supabase.com)
2. Run `supabase/btc-portfolio-schema.sql` in the SQL Editor
3. Copy your Supabase URL and anon key into `client/src/lib/supabase.ts`

### 4. Run

```bash
pnpm dev        # Development (Vite dev server)
pnpm build      # Production build
pnpm start      # Run production server
```

---

## Usage

### Importing Transactions

1. Export your交易 history from Coinbase (or other supported exchanges) as CSV
2. Click **Upload CSV** on the dashboard
3. Select your CSV file — the app parses `date`, `method`, `amount`, `currency`, `status` columns
4. Data is merged with your manual holdings and portfolio metrics recalculate instantly

### Manual Holdings

Edit the `MANUAL_HOLDINGS` array in `client/src/pages/Home.tsx` to reflect your actual holdings on exchanges that don't support CSV export (Hashkey, OKX, etc.):

```typescript
const MANUAL_HOLDINGS: ManualHolding[] = [
  { exchange: "Hashkey", asset: "BTC", amount: 0.117, avgCostUsd: 98601 },
  { exchange: "OKX", asset: "ETH", amount: 2.3698, avgCostUsd: 4000 },
];
```

---

## Scripts

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start Vite dev server |
| `pnpm build` | Production build |
| `pnpm start` | Run production server |
| `pnpm check` | TypeScript type check |
| `pnpm format` | Format code with Prettier |

---

## License

MIT