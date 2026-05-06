import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { Upload, TrendingUp, TrendingDown, RefreshCw, Calendar, Repeat, DollarSign, ArrowUpDown, ArrowUp, ArrowDown, Search, X, Cloud, CloudOff, Check, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, ComposedChart, Scatter, Area,
  PieChart, Pie, Cell, ScatterChart, ZAxis,
} from "recharts";
import { useIsMobile } from "@/hooks/useMobile";
import { supabase, PORTFOLIO_USER_ID } from "@/lib/supabase";
import { toast } from "sonner";

interface Transaction {
  date: string;
  method: string;
  amount: number;
  currency: string;
  status: string;
}

interface MonthlyData {
  month: string;
  btcBought: number;
  totalCost: number;
  avgPrice: number;
  cumulativeBtc: number;
}

interface BtcBuyPoint {
  date: string;       // "YYYY-MM-DD"
  timestamp: number;  // ms
  btcAmount: number;
  usdCost: number;
  price: number;      // effective price paid
}

interface PricePoint {
  date: string;
  timestamp: number;
  price: number;
  buyPrice?: number | null;
  buyBtc?: number | null;
  buyCost?: number | null;
}

type SortField = "date" | "method" | "amount" | "currency" | "status";
type SortDir = "asc" | "desc";
type ChartRange = "1M" | "3M" | "6M" | "ALL";
type CloudSyncStatus = "idle" | "loading" | "syncing" | "synced" | "error";

const HKD_TO_USD = 7.8;

// ============================================================
// Manual Holdings (exchanges without CSV export)
// ============================================================
interface ManualHolding {
  exchange: string;
  asset: string;
  amount: number;
  avgCostUsd: number | null; // null = unknown cost basis
}

const MANUAL_HOLDINGS: ManualHolding[] = [
  // Hashkey Exchange
  { exchange: "Hashkey", asset: "BTC", amount: 0.117, avgCostUsd: 98601 },
  { exchange: "Hashkey", asset: "ETH", amount: 1.15, avgCostUsd: 4548 },
  // OKX Exchange
  { exchange: "OKX", asset: "BTC", amount: 0.05647, avgCostUsd: 116932 },
  { exchange: "OKX", asset: "ETH", amount: 2.3698, avgCostUsd: 4000 },
  { exchange: "OKX", asset: "SOL", amount: 9.26, avgCostUsd: 193 },
];

// Derived constants from manual holdings
const MANUAL_BTC = MANUAL_HOLDINGS.filter((h) => h.asset === "BTC");
const MANUAL_ETH = MANUAL_HOLDINGS.filter((h) => h.asset === "ETH");
const MANUAL_SOL = MANUAL_HOLDINGS.filter((h) => h.asset === "SOL");

const MANUAL_BTC_TOTAL = MANUAL_BTC.reduce((sum, h) => sum + h.amount, 0);
const MANUAL_BTC_COST = MANUAL_BTC.reduce((sum, h) => sum + h.amount * (h.avgCostUsd || 0), 0);

const MANUAL_ETH_TOTAL = MANUAL_ETH.reduce((sum, h) => sum + h.amount, 0);
const MANUAL_ETH_COST = MANUAL_ETH.reduce((sum, h) => sum + h.amount * (h.avgCostUsd || 0), 0);

const MANUAL_SOL_TOTAL = MANUAL_SOL.reduce((sum, h) => sum + h.amount, 0);
const MANUAL_SOL_COST = MANUAL_SOL.reduce((sum, h) => sum + h.amount * (h.avgCostUsd || 0), 0);

// Format USD with thousand separators and 2 decimal places
const fmtUsd = (value: number) =>
  "$" + value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Format USD for large numbers (no decimals)
const fmtUsdInt = (value: number) =>
  "$" + Math.round(value).toLocaleString("en-US");

// Get next Monday from a given date
const getNextMonday = (from: Date): Date => {
  const d = new Date(from);
  const day = d.getDay();
  const daysUntilMonday = day === 0 ? 1 : day === 1 ? 7 : 8 - day;
  d.setDate(d.getDate() + daysUntilMonday);
  d.setHours(8, 0, 0, 0);
  return d;
};

// Format date nicely
const formatDate = (d: Date): string => {
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
};

// Days until a date
const daysUntil = (target: Date): number => {
  const now = new Date();
  const diff = target.getTime() - now.getTime();
  return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
};

// Cutoff date for a given range
const getRangeCutoff = (range: ChartRange): Date => {
  const now = new Date();
  switch (range) {
    case "1M": return new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
    case "3M": return new Date(now.getFullYear(), now.getMonth() - 3, now.getDate());
    case "6M": return new Date(now.getFullYear(), now.getMonth() - 6, now.getDate());
    case "ALL": return new Date(2020, 0, 1);
  }
};

// Custom dot for buy markers on the price chart — size scales with buy cost
const BuyMarkerDot = (props: any) => {
  const { cx, cy, payload } = props;
  if (!payload?.buyPrice || !cx || !cy) return null;

  // Scale radius based on buy cost: $100 → r=8, $500 → r=12, $1000+ → r=16
  const cost = payload.buyCost || 0;
  const minR = 8;
  const maxR = 18;
  const r = Math.min(maxR, Math.max(minR, minR + (cost / 100) * 1.5));
  const innerR = r * 0.6;
  const fontSize = Math.max(7, Math.min(12, r * 0.7));

  return (
    <g>
      <circle cx={cx} cy={cy} r={r + 3} fill="#f7931a" fillOpacity={0.18} stroke="none" />
      <circle cx={cx} cy={cy} r={r} fill="#f7931a" fillOpacity={0.35} stroke="none" />
      <circle cx={cx} cy={cy} r={innerR} fill="#f7931a" stroke="#fff" strokeWidth={1.5} />
      <text x={cx} y={cy + 0.5} textAnchor="middle" dominantBaseline="middle"
        fill="#000" fontSize={fontSize} fontWeight="bold">B</text>
    </g>
  );
};

// Custom tooltip for the price trend chart
const PriceTrendTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload || !payload.length) return null;
  const data = payload[0]?.payload;
  if (!data) return null;

  return (
    <div className="bg-[#1e2329] border border-[#2d3139] rounded-lg p-3 shadow-xl text-xs">
      <p className="text-gray-400 mb-1.5 font-medium">{data.date}</p>
      <p className="text-white">
        BTC Price: <span className="font-semibold text-[#f7931a]">{fmtUsd(data.price)}</span>
      </p>
      {data.buyPrice && (
        <div className="mt-1.5 pt-1.5 border-t border-[#2d3139]">
          <p className="text-[#f7931a] font-semibold mb-0.5">Buy Executed</p>
          <p className="text-white">Amount: <span className="text-[#f7931a]">{data.buyBtc?.toFixed(6)} BTC</span></p>
          <p className="text-white">Cost: <span className="text-gray-300">{fmtUsd(data.buyCost || 0)}</span></p>
        </div>
      )}
    </div>
  );
};

export default function Home() {
  const isMobile = useIsMobile();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [totalBtc, setTotalBtc] = useState(0);
  const [totalUsdSpent, setTotalUsdSpent] = useState(0);
  const [avgCostPerBtc, setAvgCostPerBtc] = useState(0);
  const [currentBtcPrice, setCurrentBtcPrice] = useState(0);
  const [currentEthPrice, setCurrentEthPrice] = useState(0);
  const [currentSolPrice, setCurrentSolPrice] = useState(0);
  // CSV-extracted ETH/SOL holdings
  const [csvEth, setCsvEth] = useState(0);
  const [csvEthCost, setCsvEthCost] = useState(0);
  const [csvSol, setCsvSol] = useState(0);
  const [csvSolCost, setCsvSolCost] = useState(0);
  const [portfolioValue, setPortfolioValue] = useState(0);
  const [pnlUsd, setPnlUsd] = useState(0);
  const [pnlPercent, setPnlPercent] = useState(0);
  const [monthlyData, setMonthlyData] = useState<MonthlyData[]>([]);
  const [chartData, setChartData] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // BTC price history for the trend chart
  const [priceHistory, setPriceHistory] = useState<PricePoint[]>([]);
  const [priceHistoryLoading, setPriceHistoryLoading] = useState(false);

  // Extracted buy points from transactions
  const [buyPoints, setBuyPoints] = useState<BtcBuyPoint[]>([]);

  // Chart range filter — default 6M (shows from ~Sep 2025)
  const [chartRange, setChartRange] = useState<ChartRange>("6M");

  // Transaction table state
  const [dcaChartView, setDcaChartView] = useState<"pnl" | "scatter">("pnl");
  const [txSortField, setTxSortField] = useState<SortField>("date");
  const [txSortDir, setTxSortDir] = useState<SortDir>("desc");
  const [txFilters, setTxFilters] = useState<Record<SortField, string>>({
    date: "", method: "", amount: "", currency: "", status: "",
  });
  const [txPage, setTxPage] = useState(0);
  const TX_PER_PAGE = 20;

  // Cloud sync state
  const [cloudStatus, setCloudStatus] = useState<CloudSyncStatus>("idle");
  const [lastSyncTime, setLastSyncTime] = useState<Date | null>(null);

  // Apply portfolio data to state (shared by localStorage and Supabase load)
  const applyPortfolioData = useCallback((data: any) => {
    setTransactions(data.transactions || []);
    setTotalBtc(data.totalBtc || 0);
    setTotalUsdSpent(data.totalUsdSpent || 0);
    setAvgCostPerBtc(data.avgCostPerBtc || 0);
    setMonthlyData(data.monthlyData || []);
    setChartData(data.chartData || []);
    if (data.buyPoints) setBuyPoints(data.buyPoints);
    // Restore CSV ETH/SOL
    setCsvEth(data.csvEth || 0);
    setCsvEthCost(data.csvEthCost || 0);
    setCsvSol(data.csvSol || 0);
    setCsvSolCost(data.csvSolCost || 0);
  }, []);

  // Load portfolio from Supabase cloud
  const loadFromCloud = useCallback(async (): Promise<boolean> => {
    try {
      setCloudStatus("loading");
      const { data, error } = await supabase
        .from("btc_portfolio")
        .select("transactions, portfolio_state, updated_at")
        .eq("user_id", PORTFOLIO_USER_ID)
        .single();

      if (error) {
        // PGRST116 = no rows found — not an error, just empty
        if (error.code === "PGRST116") {
          setCloudStatus("idle");
          return false;
        }
        console.error("Supabase load error:", error);
        setCloudStatus("error");
        return false;
      }

      if (data && data.transactions && Array.isArray(data.transactions) && data.transactions.length > 0) {
        const portfolioState = data.portfolio_state || {};
        const fullData = {
          transactions: data.transactions,
          ...portfolioState,
        };
        applyPortfolioData(fullData);
        // Also cache in localStorage
        localStorage.setItem("btc_portfolio", JSON.stringify(fullData));
        setLastSyncTime(new Date(data.updated_at));
        setCloudStatus("synced");
        return true;
      }

      setCloudStatus("idle");
      return false;
    } catch (err) {
      console.error("Cloud load failed:", err);
      setCloudStatus("error");
      return false;
    }
  }, [applyPortfolioData]);

  // Save portfolio to Supabase cloud
  const saveToCloud = useCallback(async (txns: Transaction[], state: any) => {
    try {
      setCloudStatus("syncing");
      const { error } = await supabase
        .from("btc_portfolio")
        .upsert({
          user_id: PORTFOLIO_USER_ID,
          transactions: txns,
          portfolio_state: state,
          updated_at: new Date().toISOString(),
        }, {
          onConflict: "user_id",
        });

      if (error) {
        console.error("Supabase save error:", error);
        setCloudStatus("error");
        toast.error("Cloud sync failed", {
          description: error.message || "Could not save to cloud",
        });
        return false;
      }

      setLastSyncTime(new Date());
      setCloudStatus("synced");
      toast.success("Synced to cloud", {
        description: "Portfolio data saved to Supabase",
      });
      return true;
    } catch (err) {
      console.error("Cloud save failed:", err);
      setCloudStatus("error");
      toast.error("Cloud sync failed", {
        description: "Network error — data saved locally",
      });
      return false;
    }
  }, []);

  // Load portfolio on mount: try Supabase first, fall back to localStorage
  useEffect(() => {
    const loadPortfolio = async () => {
      // Try cloud first
      const cloudLoaded = await loadFromCloud();

      // Fall back to localStorage if cloud had nothing
      if (!cloudLoaded) {
        const saved = localStorage.getItem("btc_portfolio");
        if (saved) {
          try {
            const data = JSON.parse(saved);
            applyPortfolioData(data);
          } catch (e) {
            console.error("Error loading saved portfolio:", e);
          }
        }
      }
    };
    loadPortfolio();
  }, [loadFromCloud, applyPortfolioData]);

  // Fetch BTC, ETH, SOL prices from CoinGecko
  const fetchPrices = async () => {
    try {
      const response = await fetch(
        "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana&vs_currencies=usd"
      );
      const data = await response.json();
      if (data.bitcoin?.usd) setCurrentBtcPrice(data.bitcoin.usd);
      if (data.ethereum?.usd) setCurrentEthPrice(data.ethereum.usd);
      if (data.solana?.usd) setCurrentSolPrice(data.solana.usd);
      return data.bitcoin?.usd || currentBtcPrice;
    } catch (error) {
      console.error("Error fetching prices:", error);
      return currentBtcPrice;
    }
  };

  // Keep backward-compatible alias
  const fetchBtcPrice = fetchPrices;

  // Parse CoinGecko market_chart response into PricePoint[]
  const parsePriceData = (data: any): PricePoint[] | null => {
    if (!data?.prices || !Array.isArray(data.prices)) return null;
    const points: PricePoint[] = data.prices.map((p: [number, number]) => {
      const d = new Date(p[0]);
      return {
        date: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`,
        timestamp: p[0],
        price: p[1],
        buyPrice: null,
        buyBtc: null,
        buyCost: null,
      };
    });
    // Deduplicate by date (keep last entry per day for daily granularity)
    const dateMap = new Map<string, PricePoint>();
    points.forEach((p) => dateMap.set(p.date, p));
    return Array.from(dateMap.values()).sort((a, b) => a.timestamp - b.timestamp);
  };

  // Try fetching from a single URL, return parsed points or null
  const tryFetchPrices = async (url: string): Promise<PricePoint[] | null> => {
    const response = await fetch(url);
    if (!response.ok) return null;
    const data = await response.json();
    return parsePriceData(data);
  };

  // Fetch BTC price history with fallback chain and retry
  const fetchPriceHistory = async (retryCount = 0) => {
    setPriceHistoryLoading(true);
    const endpoints = [
      "https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=usd&days=365",
      "https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=usd&days=180",
      "https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=usd&days=90",
    ];

    for (const url of endpoints) {
      try {
        const points = await tryFetchPrices(url);
        if (points && points.length > 0) {
          setPriceHistory(points);
          localStorage.setItem("btc_price_history", JSON.stringify(points));
          localStorage.setItem("btc_price_history_ts", Date.now().toString());
          setPriceHistoryLoading(false);
          return;
        }
      } catch {
        // Try next endpoint
      }
    }

    // All endpoints failed — try cache
    const cached = localStorage.getItem("btc_price_history");
    if (cached) {
      try { setPriceHistory(JSON.parse(cached)); } catch { /* ignore */ }
    }

    // Retry after 5 s if this was an early attempt and we have no data
    if (retryCount < 2 && !cached) {
      setPriceHistoryLoading(true);
      setTimeout(() => fetchPriceHistory(retryCount + 1), 5000);
      return;
    }

    setPriceHistoryLoading(false);
  };

  // Auto-refresh prices every 30 seconds
  useEffect(() => {
    fetchPrices();
    const interval = setInterval(fetchPrices, 30000);
    return () => clearInterval(interval);
  }, []);

  // Fetch price history on mount (with 5-min cache)
  useEffect(() => {
    const cachedTs = localStorage.getItem("btc_price_history_ts");
    const cached = localStorage.getItem("btc_price_history");
    const fiveMin = 5 * 60 * 1000;

    if (cachedTs && cached && Date.now() - parseInt(cachedTs) < fiveMin) {
      try {
        setPriceHistory(JSON.parse(cached));
      } catch (e) {
        fetchPriceHistory();
      }
    } else {
      fetchPriceHistory();
    }
  }, []);

  // Parse CSV file
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const csv = event.target?.result as string;
      const lines = csv.split("\n");

      const parsedTransactions: Transaction[] = [];
      for (let i = 1; i < lines.length; i++) {
        if (!lines[i].trim()) continue;

        // Parse CSV line handling quoted fields
        const fields: string[] = [];
        let current = "";
        let inQuotes = false;

        for (let j = 0; j < lines[i].length; j++) {
          const char = lines[i][j];
          if (char === '"') {
            inQuotes = !inQuotes;
          } else if (char === "," && !inQuotes) {
            fields.push(current.trim().replace(/"/g, ""));
            current = "";
          } else {
            current += char;
          }
        }
        fields.push(current.trim().replace(/"/g, ""));

        const transaction: Transaction = {
          date: fields[0] || "",
          method: fields[1] || "",
          amount: parseFloat(fields[2]) || 0,
          currency: fields[3] || "",
          status: fields[4] || "",
        };

        if (transaction.status === "Processed") {
          parsedTransactions.push(transaction);
        }
      }

      setTransactions(parsedTransactions);
      calculateMetrics(parsedTransactions);
    };

    reader.readAsText(file);
  };

  // Calculate portfolio metrics
  const calculateMetrics = (txns: Transaction[]) => {
    let btc = 0;
    let usdSpent = 0;
    let ethTotal = 0;
    let ethCostTotal = 0;
    let solTotal = 0;
    let solCostTotal = 0;
    const monthlyMap = new Map<string, { btc: number; cost: number }>();
    const cumulativeData: any[] = [];

    // Sort by date
    const sorted = [...txns].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    // Build a map of timestamps that have crypto purchases (BTC, ETH, SOL)
    const cryptoBuyTimestamps = new Map<string, Set<string>>();
    sorted.forEach((tx) => {
      if ((tx.currency === "BTC" || tx.currency === "ETH" || tx.currency === "SOL") && tx.amount > 0) {
        if (tx.method === "Rewards") return;
        if (!cryptoBuyTimestamps.has(tx.date)) {
          cryptoBuyTimestamps.set(tx.date, new Set());
        }
        cryptoBuyTimestamps.get(tx.date)!.add(tx.currency);
      }
    });

    // Build buy points for the price trend chart (BTC only)
    const buyByTimestamp = new Map<string, { btc: number; cost: number }>();

    let cumulativeBtc = 0;
    let cumulativeCost = 0;

    // Build a map of USD costs per timestamp
    const usdCostByTimestamp = new Map<string, number>();
    sorted.forEach((tx) => {
      if ((tx.currency === "USD" || tx.currency === "HKD") && tx.amount < 0) {
        const usdAmount = tx.currency === "HKD" ? Math.abs(tx.amount) / HKD_TO_USD : Math.abs(tx.amount);
        usdCostByTimestamp.set(tx.date, (usdCostByTimestamp.get(tx.date) || 0) + usdAmount);
      }
    });

    sorted.forEach((tx) => {
      const date = new Date(tx.date);
      const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;

      if (tx.currency === "BTC" && tx.amount > 0) {
        if (tx.method === "Rewards") return;

        btc += tx.amount;
        cumulativeBtc += tx.amount;

        if (!monthlyMap.has(monthKey)) {
          monthlyMap.set(monthKey, { btc: 0, cost: 0 });
        }
        const monthly = monthlyMap.get(monthKey)!;
        monthly.btc += tx.amount;

        if (!buyByTimestamp.has(tx.date)) {
          buyByTimestamp.set(tx.date, { btc: 0, cost: 0 });
        }
        buyByTimestamp.get(tx.date)!.btc += tx.amount;

        // Allocate cost from paired USD debit at same timestamp
        const costAtTs = usdCostByTimestamp.get(tx.date) || 0;
        const currenciesAtTs = cryptoBuyTimestamps.get(tx.date);
        let btcCostShare = costAtTs;
        if (currenciesAtTs && currenciesAtTs.size > 1) {
          btcCostShare = costAtTs / currenciesAtTs.size;
        }

        usdSpent += btcCostShare;
        cumulativeCost += btcCostShare;
        buyByTimestamp.get(tx.date)!.cost += btcCostShare;
        monthlyMap.get(monthKey)!.cost += btcCostShare;

        cumulativeData.push({
          date: tx.date.split(" ")[0],
          cumulativeBtc: cumulativeBtc,
          costBasis: cumulativeCost,
          avgCost: cumulativeBtc > 0 ? cumulativeCost / cumulativeBtc : 0,
        });
      } else if (tx.currency === "ETH" && tx.amount > 0) {
        if (tx.method === "Rewards") return;
        ethTotal += tx.amount;
        const costAtTs = usdCostByTimestamp.get(tx.date) || 0;
        const currenciesAtTs = cryptoBuyTimestamps.get(tx.date);
        let ethCostShare = costAtTs;
        if (currenciesAtTs && currenciesAtTs.size > 1) {
          ethCostShare = costAtTs / currenciesAtTs.size;
        }
        ethCostTotal += ethCostShare;
      } else if (tx.currency === "SOL" && tx.amount > 0) {
        if (tx.method === "Rewards") return;
        solTotal += tx.amount;
        const costAtTs = usdCostByTimestamp.get(tx.date) || 0;
        const currenciesAtTs = cryptoBuyTimestamps.get(tx.date);
        let solCostShare = costAtTs;
        if (currenciesAtTs && currenciesAtTs.size > 1) {
          solCostShare = costAtTs / currenciesAtTs.size;
        }
        solCostTotal += solCostShare;
      }
    });

    // Build buy points array (aggregate by date for the chart)
    const buyDateMap = new Map<string, { btc: number; cost: number }>();
    buyByTimestamp.forEach((val, ts) => {
      const dateKey = ts.split(" ")[0];
      if (!buyDateMap.has(dateKey)) {
        buyDateMap.set(dateKey, { btc: 0, cost: 0 });
      }
      const entry = buyDateMap.get(dateKey)!;
      entry.btc += val.btc;
      entry.cost += val.cost;
    });

    const extractedBuyPoints: BtcBuyPoint[] = [];
    buyDateMap.forEach((val, dateStr) => {
      if (val.btc > 0 && val.cost > 0) {
        extractedBuyPoints.push({
          date: dateStr,
          timestamp: new Date(dateStr).getTime(),
          btcAmount: val.btc,
          usdCost: val.cost,
          price: val.cost / val.btc,
        });
      }
    });
    extractedBuyPoints.sort((a, b) => a.timestamp - b.timestamp);
    setBuyPoints(extractedBuyPoints);

    setTotalBtc(btc);
    setTotalUsdSpent(usdSpent);
    setCsvEth(ethTotal);
    setCsvEthCost(ethCostTotal);
    setCsvSol(solTotal);
    setCsvSolCost(solCostTotal);

    const avgCost = btc > 0 ? usdSpent / btc : 0;
    setAvgCostPerBtc(avgCost);

    const monthlyArray: MonthlyData[] = [];
    monthlyMap.forEach((value, key) => {
      monthlyArray.push({
        month: key,
        btcBought: value.btc,
        totalCost: value.cost,
        avgPrice: value.btc > 0 ? value.cost / value.btc : 0,
        cumulativeBtc: 0,
      });
    });

    let cumBtc = 0;
    monthlyArray.forEach((m) => {
      cumBtc += m.btcBought;
      m.cumulativeBtc = cumBtc;
    });

    setMonthlyData(monthlyArray);
    setChartData(cumulativeData);

    const portfolioState = {
      totalBtc: btc,
      totalUsdSpent: usdSpent,
      avgCostPerBtc: avgCost,
      monthlyData: monthlyArray,
      chartData: cumulativeData,
      buyPoints: extractedBuyPoints,
      csvEth: ethTotal,
      csvEthCost: ethCostTotal,
      csvSol: solTotal,
      csvSolCost: solCostTotal,
    };

    // Save to localStorage (cache/fallback)
    localStorage.setItem("btc_portfolio", JSON.stringify({
      transactions: txns,
      ...portfolioState,
    }));

    // Save to Supabase cloud
    saveToCloud(txns, portfolioState);
  };

  // Merge price history with buy points, then filter by selected range
  const priceTrendData = useMemo(() => {
    if (priceHistory.length === 0) return [];

    const cutoff = getRangeCutoff(chartRange);
    const cutoffTs = cutoff.getTime();

    // Create a map of buy points by date
    const buyMap = new Map<string, BtcBuyPoint>();
    buyPoints.forEach((bp) => buyMap.set(bp.date, bp));

    return priceHistory
      .filter((p) => p.timestamp >= cutoffTs)
      .map((p) => {
        const buy = buyMap.get(p.date);
        return {
          ...p,
          buyPrice: buy ? buy.price : null,
          buyBtc: buy ? buy.btcAmount : null,
          buyCost: buy ? buy.usdCost : null,
        };
      });
  }, [priceHistory, buyPoints, chartRange]);

  // Count visible buys in current range
  const visibleBuys = useMemo(() => {
    return priceTrendData.filter((p) => p.buyPrice !== null).length;
  }, [priceTrendData]);

  // DCA Performance: what each buy is worth today vs what you paid
  const dcaPerformanceData = useMemo(() => {
    if (buyPoints.length === 0 || currentBtcPrice === 0) return [];

    return buyPoints
      .slice() // copy
      .sort((a, b) => a.timestamp - b.timestamp) // oldest first for chart
      .map((bp) => {
        const paid = bp.usdCost;
        const currentValue = bp.btcAmount * currentBtcPrice;
        const pnl = currentValue - paid;
        const pnlPct = paid > 0 ? (pnl / paid) * 100 : 0;
        return {
          date: bp.date,
          btcAmount: bp.btcAmount,
          paid,
          currentValue,
          pnl,
          pnlPct,
          price: bp.price,  // BTC price at time of buy
        };
      });
  }, [buyPoints, currentBtcPrice]);

  // Combined totals (CSV + manual holdings) — must be before any useMemo that references them
  const combinedBtc = totalBtc + MANUAL_BTC_TOTAL;
  const combinedBtcCost = totalUsdSpent + MANUAL_BTC_COST;
  const combinedAvgCostBtc = combinedBtc > 0 ? combinedBtcCost / combinedBtc : 0;

  const combinedEth = csvEth + MANUAL_ETH_TOTAL;
  const combinedEthCost = csvEthCost + MANUAL_ETH_COST;
  const combinedSol = csvSol + MANUAL_SOL_TOTAL;
  const combinedSolCost = csvSolCost + MANUAL_SOL_COST;

  // ETH & SOL market values
  const ethValue = combinedEth * currentEthPrice;
  const solValue = combinedSol * currentSolPrice;
  const totalAltCost = combinedEthCost + combinedSolCost;

  // Portfolio allocation data for donut chart
  const allocationData = useMemo(() => {
    if (portfolioValue === 0) return [];

    const slices: { name: string; value: number; color: string }[] = [];

    // BTC CSV holdings
    if (totalBtc * currentBtcPrice > 0) {
      slices.push({ name: "BTC (CSV)", value: totalBtc * currentBtcPrice, color: "#f7931a" });
    }

    // BTC manual holdings — split by exchange
    if (MANUAL_BTC_TOTAL * currentBtcPrice > 0) {
      const hkBtcVal = (MANUAL_BTC.find(h => h.exchange === "Hashkey")?.amount || 0) * currentBtcPrice;
      const okxBtcVal = (MANUAL_BTC.find(h => h.exchange === "OKX")?.amount || 0) * currentBtcPrice;
      if (hkBtcVal > 0) slices.push({ name: "BTC (Hashkey)", value: hkBtcVal, color: "#c67d2e" });
      if (okxBtcVal > 0) slices.push({ name: "BTC (OKX)", value: okxBtcVal, color: "#a0631f" });
    }

    // ETH
    if (combinedEth * currentEthPrice > 0) {
      slices.push({ name: "ETH", value: combinedEth * currentEthPrice, color: "#627eea" });
    }

    // SOL
    if (combinedSol * currentSolPrice > 0) {
      slices.push({ name: "SOL", value: combinedSol * currentSolPrice, color: "#9945ff" });
    }

    return slices;
  }, [portfolioValue, combinedBtc, totalBtc, currentBtcPrice, combinedEth, currentEthPrice, combinedSol, currentSolPrice]);

  // Update portfolio value when prices change
  useEffect(() => {
    if (combinedBtc === 0 && combinedEth === 0 && combinedSol === 0) return;

    const btcVal = combinedBtc * currentBtcPrice;
    const ethVal = combinedEth * currentEthPrice;
    const solVal = combinedSol * currentSolPrice;
    const totalVal = btcVal + ethVal + solVal;
    setPortfolioValue(totalVal);

    const totalCost = combinedBtcCost + totalAltCost;
    const pnl = totalVal - totalCost;
    setPnlUsd(pnl);

    const pnlPct = totalCost > 0 ? (pnl / totalCost) * 100 : 0;
    setPnlPercent(pnlPct);
  }, [currentBtcPrice, currentEthPrice, currentSolPrice, combinedBtc, combinedBtcCost, combinedEth, combinedEthCost, combinedSol, combinedSolCost, totalAltCost]);

  const isProfitable = pnlUsd >= 0;

  // DCA Plan calculations
  const nextBuyDate = getNextMonday(new Date());
  const daysToNext = daysUntil(nextBuyDate);
  const totalWeeksBuying = useMemo(() => {
    if (buyPoints.length === 0) return 0;
    const first = new Date(buyPoints[0].date);
    const now = new Date();
    return Math.ceil((now.getTime() - first.getTime()) / (7 * 24 * 60 * 60 * 1000));
  }, [buyPoints]);

  // ---- Transaction table logic ----
  const handleTxSort = (field: SortField) => {
    if (txSortField === field) {
      setTxSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setTxSortField(field);
      setTxSortDir(field === "date" ? "desc" : "asc");
    }
    setTxPage(0);
  };

  const handleTxFilterChange = (field: SortField, value: string) => {
    setTxFilters((prev) => ({ ...prev, [field]: value }));
    setTxPage(0);
  };

  const filteredSortedTxns = useMemo(() => {
    let result = [...transactions];

    // Apply filters
    if (txFilters.date) {
      const q = txFilters.date.toLowerCase();
      result = result.filter((t) => t.date.toLowerCase().includes(q));
    }
    if (txFilters.method) {
      const q = txFilters.method.toLowerCase();
      result = result.filter((t) => t.method.toLowerCase().includes(q));
    }
    if (txFilters.amount) {
      const q = txFilters.amount.toLowerCase();
      result = result.filter((t) => t.amount.toString().includes(q));
    }
    if (txFilters.currency) {
      const q = txFilters.currency.toLowerCase();
      result = result.filter((t) => t.currency.toLowerCase().includes(q));
    }
    if (txFilters.status) {
      const q = txFilters.status.toLowerCase();
      result = result.filter((t) => t.status.toLowerCase().includes(q));
    }

    // Sort
    result.sort((a, b) => {
      let cmp = 0;
      switch (txSortField) {
        case "date":
          cmp = new Date(a.date).getTime() - new Date(b.date).getTime();
          break;
        case "method":
          cmp = a.method.localeCompare(b.method);
          break;
        case "amount":
          cmp = a.amount - b.amount;
          break;
        case "currency":
          cmp = a.currency.localeCompare(b.currency);
          break;
        case "status":
          cmp = a.status.localeCompare(b.status);
          break;
      }
      return txSortDir === "asc" ? cmp : -cmp;
    });

    return result;
  }, [transactions, txFilters, txSortField, txSortDir]);

  const txTotalPages = Math.max(1, Math.ceil(filteredSortedTxns.length / TX_PER_PAGE));
  const pagedTxns = filteredSortedTxns.slice(txPage * TX_PER_PAGE, (txPage + 1) * TX_PER_PAGE);

  const hasActiveFilters = Object.values(txFilters).some((v) => v !== "");

  // Sort icon helper
  const SortIcon = ({ field }: { field: SortField }) => {
    if (txSortField !== field) return <ArrowUpDown size={12} className="text-gray-600 ml-1 inline" />;
    return txSortDir === "asc"
      ? <ArrowUp size={12} className="text-[#f7931a] ml-1 inline" />
      : <ArrowDown size={12} className="text-[#f7931a] ml-1 inline" />;
  };

  // Range button styling
  const rangeBtn = (range: ChartRange) => {
    const active = chartRange === range;
    return (
      <button
        key={range}
        onClick={() => setChartRange(range)}
        className={`px-2.5 sm:px-3 py-1 rounded-md text-[10px] sm:text-xs font-medium transition-all ${
          active
            ? "bg-[#f7931a] text-black shadow-sm"
            : "bg-[#2d3139] text-gray-400 hover:bg-[#3d4149] hover:text-white"
        }`}
      >
        {range === "ALL" ? "All" : range}
      </button>
    );
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#0b0e11] to-[#1e2329] text-white">
      {/* Header */}
      <header className="border-b border-[#2d3139] bg-[#0b0e11] sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-3 sm:px-4 py-3 sm:py-4 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg bg-gradient-to-br from-[#f7931a] to-[#f9a825] flex items-center justify-center font-bold text-sm sm:text-lg flex-shrink-0">
              B
            </div>
            <h1 className="text-lg sm:text-2xl font-bold truncate">BTC Portfolio</h1>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            {transactions.length > 0 && (
              <Button
                onClick={() => fileInputRef.current?.click()}
                className="bg-[#2d3139] hover:bg-[#3d4149] text-white text-xs sm:text-sm px-2 sm:px-3 py-1.5 sm:py-2"
              >
                <Upload size={14} className="mr-1" />
                <span className="hidden sm:inline">Update CSV</span>
                <span className="sm:hidden">CSV</span>
              </Button>
            )}
            {/* Cloud Sync Indicator */}
            <button
              onClick={() => loadFromCloud()}
              title={lastSyncTime ? `Last synced: ${lastSyncTime.toLocaleTimeString()}` : "Cloud sync"}
              className={`flex items-center gap-1 px-2 py-1.5 rounded-lg transition-colors ${
                cloudStatus === "synced" ? "bg-[#00b96b]/10 text-[#00b96b] hover:bg-[#00b96b]/20" :
                cloudStatus === "error" ? "bg-[#f6465d]/10 text-[#f6465d] hover:bg-[#f6465d]/20" :
                cloudStatus === "syncing" || cloudStatus === "loading" ? "bg-[#f7931a]/10 text-[#f7931a]" :
                "bg-[#1e2329] text-gray-500 hover:bg-[#2d3139] hover:text-gray-300"
              }`}
            >
              {cloudStatus === "syncing" || cloudStatus === "loading" ? (
                <RefreshCw size={14} className="animate-spin" />
              ) : cloudStatus === "synced" ? (
                <Cloud size={14} />
              ) : cloudStatus === "error" ? (
                <CloudOff size={14} />
              ) : (
                <Cloud size={14} />
              )}
              <span className="text-[10px] sm:text-xs hidden sm:inline">
                {cloudStatus === "syncing" ? "Syncing..." :
                 cloudStatus === "loading" ? "Loading..." :
                 cloudStatus === "synced" ? "Synced" :
                 cloudStatus === "error" ? "Offline" :
                 "Cloud"}
              </span>
            </button>
            <button
              onClick={() => fetchBtcPrice()}
              className="flex items-center gap-1 sm:gap-2 px-2 sm:px-4 py-1.5 sm:py-2 rounded-lg bg-[#1e2329] hover:bg-[#2d3139] transition-colors"
            >
              <RefreshCw size={16} />
              <span className="text-xs sm:text-sm hidden sm:inline">Refresh</span>
            </button>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv"
            onChange={handleFileUpload}
            className="hidden"
          />
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-3 sm:px-4 py-4 sm:py-8">
        {/* Upload Section - only show if no data (but manual holdings always exist) */}
        {transactions.length === 0 && MANUAL_HOLDINGS.length === 0 ? (
          <div className="mb-8">
            {cloudStatus === "loading" ? (
              <div className="border-2 border-dashed border-[#2d3139] rounded-lg p-6 sm:p-12 text-center">
                <RefreshCw size={48} className="mx-auto mb-4 text-[#f7931a] animate-spin" />
                <h2 className="text-xl font-semibold mb-2">Loading from Cloud...</h2>
                <p className="text-gray-400">Fetching your portfolio data from Supabase</p>
              </div>
            ) : (
              <div
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed border-[#2d3139] rounded-lg p-6 sm:p-12 text-center cursor-pointer hover:border-[#f7931a] transition-colors"
              >
                <Upload size={48} className="mx-auto mb-4 text-[#f7931a]" />
                <h2 className="text-xl font-semibold mb-2">Upload Transaction Report</h2>
                <p className="text-gray-400 mb-2">Drag and drop your CSV file or click to browse</p>
                {cloudStatus === "error" && (
                  <p className="text-[#f6465d] text-sm mb-2">Could not load from cloud — upload a CSV to get started</p>
                )}
                <Button className="bg-[#f7931a] hover:bg-[#f9a825] text-black font-semibold">
                  Select CSV File
                </Button>
              </div>
            )}
          </div>
        ) : (
          <>
            {/* DCA Plan Section */}
            <Card className="bg-[#1e2329] border-[#2d3139] p-3 sm:p-5 mb-4 sm:mb-8">
              <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-6">
                {/* DCA Plan Title & Badge */}
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-gradient-to-br from-[#f7931a]/20 to-[#f9a825]/10 border border-[#f7931a]/30 flex items-center justify-center flex-shrink-0">
                    <Repeat size={20} className="text-[#f7931a]" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-sm sm:text-base font-semibold text-white">DCA Plan</h3>
                      <span className="px-2 py-0.5 rounded-full bg-[#00b96b]/15 text-[#00b96b] text-[10px] sm:text-xs font-medium border border-[#00b96b]/30">
                        Active
                      </span>
                    </div>
                    <p className="text-xs sm:text-sm text-gray-400 mt-0.5">
                      <span className="text-[#f7931a] font-semibold">$500</span> every Monday
                    </p>
                  </div>
                </div>

                {/* Divider */}
                <div className="hidden sm:block w-px h-10 bg-[#2d3139]" />

                {/* Stats Row */}
                <div className="flex items-center gap-3 sm:gap-6 flex-1 overflow-x-auto">
                  {/* Next Buy */}
                  <div className="flex items-center gap-2 min-w-0 flex-shrink-0">
                    <Calendar size={14} className="text-gray-500 flex-shrink-0" />
                    <div className="min-w-0">
                      <p className="text-[10px] sm:text-xs text-gray-500">Next Buy</p>
                      <p className="text-xs sm:text-sm font-medium text-white truncate">
                        {formatDate(nextBuyDate)}
                      </p>
                    </div>
                  </div>

                  {/* Countdown */}
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <div className="min-w-0">
                      <p className="text-[10px] sm:text-xs text-gray-500">Countdown</p>
                      <p className="text-xs sm:text-sm font-medium text-white">
                        {daysToNext === 0 ? (
                          <span className="text-[#00b96b]">Today!</span>
                        ) : daysToNext === 1 ? (
                          <span className="text-[#f7931a]">Tomorrow</span>
                        ) : (
                          <span>{daysToNext} days</span>
                        )}
                      </p>
                    </div>
                  </div>

                  {/* Weekly Amount */}
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <DollarSign size={14} className="text-gray-500 flex-shrink-0" />
                    <div className="min-w-0">
                      <p className="text-[10px] sm:text-xs text-gray-500">Weekly</p>
                      <p className="text-xs sm:text-sm font-medium text-[#f7931a]">$500</p>
                    </div>
                  </div>

                  {/* Monthly Estimate */}
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <div className="min-w-0">
                      <p className="text-[10px] sm:text-xs text-gray-500">Monthly</p>
                      <p className="text-xs sm:text-sm font-medium text-white">~$2,167</p>
                    </div>
                  </div>

                  {/* Streak */}
                  {totalWeeksBuying > 0 && (
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <div className="min-w-0">
                        <p className="text-[10px] sm:text-xs text-gray-500">Streak</p>
                        <p className="text-xs sm:text-sm font-medium text-white">{totalWeeksBuying}w</p>
                      </div>
                    </div>
                  )}
                </div>

                {/* Progress Bar (visual indicator) */}
                <div className="sm:ml-auto flex-shrink-0 w-full sm:w-32">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] text-gray-500">Week progress</span>
                    <span className="text-[10px] text-gray-400">{7 - daysToNext}/7</span>
                  </div>
                  <div className="h-1.5 bg-[#2d3139] rounded-full overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-[#f7931a] to-[#f9a825] rounded-full transition-all duration-500"
                      style={{ width: `${((7 - daysToNext) / 7) * 100}%` }}
                    />
                  </div>
                </div>
              </div>
            </Card>

            {/* Dashboard Cards */}
            <div className="grid grid-cols-2 md:grid-cols-2 lg:grid-cols-3 gap-2 sm:gap-4 mb-4 sm:mb-8">
              {/* Total BTC (all sources) */}
              <Card className="bg-[#1e2329] border-[#2d3139] p-3 sm:p-6">
                <p className="text-gray-400 text-xs sm:text-sm mb-1 sm:mb-2">Total BTC</p>
                <p className="text-lg sm:text-3xl font-bold text-[#f7931a] mb-1">{combinedBtc.toFixed(6)}</p>
                <p className="text-xs text-gray-500 hidden sm:block">OSL + Hashkey + OKX</p>
              </Card>

              {/* Average Cost (weighted across all BTC) */}
              <Card className="bg-[#1e2329] border-[#2d3139] p-3 sm:p-6">
                <p className="text-gray-400 text-xs sm:text-sm mb-1 sm:mb-2">Avg Cost/BTC</p>
                <p className="text-lg sm:text-3xl font-bold text-white mb-1">{fmtUsd(combinedAvgCostBtc)}</p>
                <p className="text-xs text-gray-500 hidden sm:block">Weighted avg all sources</p>
              </Card>

              {/* Current BTC Price */}
              <Card className="bg-[#1e2329] border-[#2d3139] p-3 sm:p-6">
                <p className="text-gray-400 text-xs sm:text-sm mb-1 sm:mb-2">BTC Price</p>
                <p className="text-lg sm:text-3xl font-bold text-white mb-1">{fmtUsd(currentBtcPrice)}</p>
                <p className="text-xs text-gray-500 hidden sm:block">Real-time CoinGecko</p>
              </Card>

              {/* Total Cost Basis */}
              <Card className="bg-[#1e2329] border-[#2d3139] p-3 sm:p-6">
                <p className="text-gray-400 text-xs sm:text-sm mb-1 sm:mb-2">Total Cost Basis</p>
                <p className="text-lg sm:text-3xl font-bold text-white mb-1">{fmtUsd(combinedBtcCost + totalAltCost)}</p>
                <p className="text-xs text-gray-500 hidden sm:block">All assets, all exchanges</p>
              </Card>

              {/* Portfolio Value (all assets) */}
              <Card className="bg-[#1e2329] border-[#2d3139] p-3 sm:p-6">
                <p className="text-gray-400 text-xs sm:text-sm mb-1 sm:mb-2">Portfolio Value</p>
                <p className="text-lg sm:text-3xl font-bold text-white mb-1">{fmtUsd(portfolioValue)}</p>
                <p className="text-xs text-gray-500 hidden sm:block">All assets combined</p>
              </Card>

              {/* P&L */}
              <Card className={`${isProfitable ? "bg-[#1e3a2b]" : "bg-[#3a1e1e]"} border-[#2d3139] p-3 sm:p-6 col-span-2 lg:col-span-1`}>
                <p className="text-gray-400 text-xs sm:text-sm mb-1 sm:mb-2">Unrealized P&L</p>
                <div className="flex items-center gap-2">
                  {isProfitable ? (
                    <TrendingUp size={20} className="text-[#00b96b] flex-shrink-0" />
                  ) : (
                    <TrendingDown size={20} className="text-[#f6465d] flex-shrink-0" />
                  )}
                  <div className="min-w-0">
                    <p className={`text-lg sm:text-3xl font-bold ${isProfitable ? "text-[#00b96b]" : "text-[#f6465d]"} truncate`}>
                      {isProfitable ? "+" : "-"}{fmtUsd(Math.abs(pnlUsd))}
                    </p>
                    <p className={`text-xs ${isProfitable ? "text-[#00b96b]" : "text-[#f6465d]"}`}>
                      {isProfitable ? "+" : "-"}{Math.abs(pnlPercent).toFixed(2)}%
                    </p>
                  </div>
                </div>
              </Card>
            </div>

            {/* P&L Breakdown by Currency */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-2 sm:gap-4 mb-4 sm:mb-8">
              <Card className="bg-[#1e2329] border-[#2d3139] p-3 sm:p-6">
                <h3 className="text-sm sm:text-lg font-semibold mb-3 sm:mb-4">P&L by Currency</h3>
                <div className="space-y-3">
                  {/* BTC P&L */}
                  {(() => {
                    const btcVal = combinedBtc * currentBtcPrice;
                    const btcPnl = btcVal - combinedBtcCost;
                    const btcPnlPct = combinedBtcCost > 0 ? (btcPnl / combinedBtcCost) * 100 : 0;
                    const btcUp = btcPnl >= 0;
                    return (
                      <div className="p-2.5 sm:p-3 rounded-lg bg-[#0b0e11] border border-[#2d3139]">
                        <div className="flex items-center justify-between mb-1">
                          <div className="flex items-center gap-2">
                            <div className="w-7 h-7 rounded-lg bg-[#f7931a]/15 flex items-center justify-center text-[10px] font-bold text-[#f7931a]">BTC</div>
                            <div>
                              <p className="text-xs sm:text-sm font-medium text-white">{combinedBtc.toFixed(6)} BTC</p>
                              <p className="text-[10px] text-gray-500">Cost: {fmtUsd(combinedBtcCost)}</p>
                            </div>
                          </div>
                          <div className="text-right">
                            <p className="text-xs sm:text-sm font-semibold text-white">{fmtUsd(btcVal)}</p>
                            <p className={`text-[10px] sm:text-xs font-medium ${btcUp ? "text-[#00b96b]" : "text-[#f6465d]"}`}>
                              {btcUp ? "+" : "-"}{fmtUsd(Math.abs(btcPnl))} ({btcUp ? "+" : "-"}{Math.abs(btcPnlPct).toFixed(2)}%)
                            </p>
                          </div>
                        </div>
                      </div>
                    );
                  })()}
                  {/* ETH P&L */}
                  {(() => {
                    const ethPnl = ethValue - combinedEthCost;
                    const ethPnlPct = combinedEthCost > 0 ? (ethPnl / combinedEthCost) * 100 : 0;
                    const ethUp = ethPnl >= 0;
                    return (
                      <div className="p-2.5 sm:p-3 rounded-lg bg-[#0b0e11] border border-[#2d3139]">
                        <div className="flex items-center justify-between mb-1">
                          <div className="flex items-center gap-2">
                            <div className="w-7 h-7 rounded-lg bg-[#627eea]/15 flex items-center justify-center text-[10px] font-bold text-[#627eea]">ETH</div>
                            <div>
                              <p className="text-xs sm:text-sm font-medium text-white">{combinedEth.toFixed(4)} ETH</p>
                              <p className="text-[10px] text-gray-500">Cost: {fmtUsd(combinedEthCost)}</p>
                            </div>
                          </div>
                          <div className="text-right">
                            <p className="text-xs sm:text-sm font-semibold text-white">{fmtUsd(ethValue)}</p>
                            <p className={`text-[10px] sm:text-xs font-medium ${ethUp ? "text-[#00b96b]" : "text-[#f6465d]"}`}>
                              {ethUp ? "+" : "-"}{fmtUsd(Math.abs(ethPnl))} ({ethUp ? "+" : "-"}{Math.abs(ethPnlPct).toFixed(2)}%)
                            </p>
                          </div>
                        </div>
                      </div>
                    );
                  })()}
                  {/* SOL P&L */}
                  {(() => {
                    const solPnl = solValue - combinedSolCost;
                    const solPnlPct = combinedSolCost > 0 ? (solPnl / combinedSolCost) * 100 : 0;
                    const solUp = solPnl >= 0;
                    return (
                      <div className="p-2.5 sm:p-3 rounded-lg bg-[#0b0e11] border border-[#2d3139]">
                        <div className="flex items-center justify-between mb-1">
                          <div className="flex items-center gap-2">
                            <div className="w-7 h-7 rounded-lg bg-[#9945ff]/15 flex items-center justify-center text-[10px] font-bold text-[#9945ff]">SOL</div>
                            <div>
                              <p className="text-xs sm:text-sm font-medium text-white">{combinedSol.toFixed(4)} SOL</p>
                              <p className="text-[10px] text-gray-500">Cost: {fmtUsd(combinedSolCost)}</p>
                            </div>
                          </div>
                          <div className="text-right">
                            <p className="text-xs sm:text-sm font-semibold text-white">{fmtUsd(solValue)}</p>
                            <p className={`text-[10px] sm:text-xs font-medium ${solUp ? "text-[#00b96b]" : "text-[#f6465d]"}`}>
                              {solUp ? "+" : "-"}{fmtUsd(Math.abs(solPnl))} ({solUp ? "+" : "-"}{Math.abs(solPnlPct).toFixed(2)}%)
                            </p>
                          </div>
                        </div>
                      </div>
                    );
                  })()}
                  {/* Total */}
                  <div className="flex items-center justify-between pt-2 border-t border-[#2d3139]">
                    <p className="text-xs text-gray-400">Total P&L</p>
                    <p className={`text-xs sm:text-sm font-semibold ${isProfitable ? "text-[#00b96b]" : "text-[#f6465d]"}`}>
                      {isProfitable ? "+" : "-"}{fmtUsd(Math.abs(pnlUsd))} ({isProfitable ? "+" : "-"}{Math.abs(pnlPercent).toFixed(2)}%)
                    </p>
                  </div>
                </div>
              </Card>

              {/* P&L by Exchange */}
              <Card className="bg-[#1e2329] border-[#2d3139] p-3 sm:p-6">
                <h3 className="text-sm sm:text-lg font-semibold mb-3 sm:mb-4">P&L by Exchange</h3>
                <div className="space-y-3">
                  {/* OSL */}
                  {(() => {
                    const oslBtcVal = totalBtc * currentBtcPrice;
                    const oslEthVal = csvEth * currentEthPrice;
                    const oslSolVal = csvSol * currentSolPrice;
                    const oslVal = oslBtcVal + oslEthVal + oslSolVal;
                    const oslCost = totalUsdSpent + csvEthCost + csvSolCost;
                    const oslPnl = oslVal - oslCost;
                    const oslPnlPct = oslCost > 0 ? (oslPnl / oslCost) * 100 : 0;
                    const oslUp = oslPnl >= 0;
                    return (
                      <div className="p-2.5 sm:p-3 rounded-lg bg-[#0b0e11] border border-[#2d3139]">
                        <div className="flex items-center justify-between mb-1">
                          <div className="flex items-center gap-2">
                            <div className="w-7 h-7 rounded bg-[#f7931a]/15 flex items-center justify-center text-[9px] font-bold text-[#f7931a]">OSL</div>
                            <div>
                              <p className="text-xs sm:text-sm font-medium text-white">OSL</p>
                              <p className="text-[10px] text-gray-500">Cost: {fmtUsd(oslCost)}</p>
                            </div>
                          </div>
                          <div className="text-right">
                            <p className="text-xs sm:text-sm font-semibold text-white">{fmtUsd(oslVal)}</p>
                            <p className={`text-[10px] sm:text-xs font-medium ${oslUp ? "text-[#00b96b]" : "text-[#f6465d]"}`}>
                              {oslUp ? "+" : "-"}{fmtUsd(Math.abs(oslPnl))} ({oslUp ? "+" : "-"}{Math.abs(oslPnlPct).toFixed(2)}%)
                            </p>
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-1.5 mt-1.5">
                          <span className="text-[9px] px-1.5 py-0.5 rounded bg-[#f7931a]/10 text-[#f7931a]">{totalBtc.toFixed(6)} BTC</span>
                          {csvEth > 0 && <span className="text-[9px] px-1.5 py-0.5 rounded bg-[#627eea]/10 text-[#627eea]">{csvEth.toFixed(4)} ETH</span>}
                          {csvSol > 0 && <span className="text-[9px] px-1.5 py-0.5 rounded bg-[#9945ff]/10 text-[#9945ff]">{csvSol.toFixed(4)} SOL</span>}
                        </div>
                      </div>
                    );
                  })()}
                  {/* Hashkey */}
                  {(() => {
                    const hkBtc = MANUAL_HOLDINGS.find(h => h.exchange === "Hashkey" && h.asset === "BTC");
                    const hkEth = MANUAL_HOLDINGS.find(h => h.exchange === "Hashkey" && h.asset === "ETH");
                    const hkBtcVal = (hkBtc?.amount || 0) * currentBtcPrice;
                    const hkEthVal = (hkEth?.amount || 0) * currentEthPrice;
                    const hkVal = hkBtcVal + hkEthVal;
                    const hkCost = (hkBtc?.amount || 0) * (hkBtc?.avgCostUsd || 0) + (hkEth?.amount || 0) * (hkEth?.avgCostUsd || 0);
                    const hkPnl = hkVal - hkCost;
                    const hkPnlPct = hkCost > 0 ? (hkPnl / hkCost) * 100 : 0;
                    const hkUp = hkPnl >= 0;
                    return (
                      <div className="p-2.5 sm:p-3 rounded-lg bg-[#0b0e11] border border-[#2d3139]">
                        <div className="flex items-center justify-between mb-1">
                          <div className="flex items-center gap-2">
                            <div className="w-7 h-7 rounded bg-[#00b96b]/15 flex items-center justify-center text-[9px] font-bold text-[#00b96b]">HK</div>
                            <div>
                              <p className="text-xs sm:text-sm font-medium text-white">Hashkey</p>
                              <p className="text-[10px] text-gray-500">Cost: {fmtUsd(hkCost)}</p>
                            </div>
                          </div>
                          <div className="text-right">
                            <p className="text-xs sm:text-sm font-semibold text-white">{fmtUsd(hkVal)}</p>
                            <p className={`text-[10px] sm:text-xs font-medium ${hkUp ? "text-[#00b96b]" : "text-[#f6465d]"}`}>
                              {hkUp ? "+" : "-"}{fmtUsd(Math.abs(hkPnl))} ({hkUp ? "+" : "-"}{Math.abs(hkPnlPct).toFixed(2)}%)
                            </p>
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-1.5 mt-1.5">
                          <span className="text-[9px] px-1.5 py-0.5 rounded bg-[#f7931a]/10 text-[#f7931a]">{hkBtc?.amount || 0} BTC</span>
                          <span className="text-[9px] px-1.5 py-0.5 rounded bg-[#627eea]/10 text-[#627eea]">{hkEth?.amount || 0} ETH</span>
                        </div>
                      </div>
                    );
                  })()}
                  {/* OKX */}
                  {(() => {
                    const okxBtc = MANUAL_HOLDINGS.find(h => h.exchange === "OKX" && h.asset === "BTC");
                    const okxEth = MANUAL_HOLDINGS.find(h => h.exchange === "OKX" && h.asset === "ETH");
                    const okxSol = MANUAL_HOLDINGS.find(h => h.exchange === "OKX" && h.asset === "SOL");
                    const okxBtcVal = (okxBtc?.amount || 0) * currentBtcPrice;
                    const okxEthVal = (okxEth?.amount || 0) * currentEthPrice;
                    const okxSolVal = (okxSol?.amount || 0) * currentSolPrice;
                    const okxVal = okxBtcVal + okxEthVal + okxSolVal;
                    const okxCost = (okxBtc?.amount || 0) * (okxBtc?.avgCostUsd || 0) + (okxEth?.amount || 0) * (okxEth?.avgCostUsd || 0) + (okxSol?.amount || 0) * (okxSol?.avgCostUsd || 0);
                    const okxPnl = okxVal - okxCost;
                    const okxPnlPct = okxCost > 0 ? (okxPnl / okxCost) * 100 : 0;
                    const okxUp = okxPnl >= 0;
                    return (
                      <div className="p-2.5 sm:p-3 rounded-lg bg-[#0b0e11] border border-[#2d3139]">
                        <div className="flex items-center justify-between mb-1">
                          <div className="flex items-center gap-2">
                            <div className="w-7 h-7 rounded bg-white/10 flex items-center justify-center text-[9px] font-bold text-white">OKX</div>
                            <div>
                              <p className="text-xs sm:text-sm font-medium text-white">OKX</p>
                              <p className="text-[10px] text-gray-500">Cost: {fmtUsd(okxCost)}</p>
                            </div>
                          </div>
                          <div className="text-right">
                            <p className="text-xs sm:text-sm font-semibold text-white">{fmtUsd(okxVal)}</p>
                            <p className={`text-[10px] sm:text-xs font-medium ${okxUp ? "text-[#00b96b]" : "text-[#f6465d]"}`}>
                              {okxUp ? "+" : "-"}{fmtUsd(Math.abs(okxPnl))} ({okxUp ? "+" : "-"}{Math.abs(okxPnlPct).toFixed(2)}%)
                            </p>
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-1.5 mt-1.5">
                          <span className="text-[9px] px-1.5 py-0.5 rounded bg-[#f7931a]/10 text-[#f7931a]">{okxBtc?.amount || 0} BTC</span>
                          <span className="text-[9px] px-1.5 py-0.5 rounded bg-[#627eea]/10 text-[#627eea]">{okxEth?.amount || 0} ETH</span>
                          <span className="text-[9px] px-1.5 py-0.5 rounded bg-[#9945ff]/10 text-[#9945ff]">{okxSol?.amount || 0} SOL</span>
                        </div>
                      </div>
                    );
                  })()}
                  {/* Total */}
                  <div className="flex items-center justify-between pt-2 border-t border-[#2d3139]">
                    <p className="text-xs text-gray-400">Total P&L</p>
                    <p className={`text-xs sm:text-sm font-semibold ${isProfitable ? "text-[#00b96b]" : "text-[#f6465d]"}`}>
                      {isProfitable ? "+" : "-"}{fmtUsd(Math.abs(pnlUsd))} ({isProfitable ? "+" : "-"}{Math.abs(pnlPercent).toFixed(2)}%)
                    </p>
                  </div>
                </div>
              </Card>
            </div>

            {/* Portfolio Allocation Pie Chart - Donut */}
            <Card className="bg-[#1e2329] border-[#2d3139] p-3 sm:p-6 mb-4 sm:mb-8">
              <h3 className="text-sm sm:text-lg font-semibold mb-1">Portfolio Allocation</h3>
              <p className="text-[10px] sm:text-xs text-gray-500 mt-0.5 mb-4">Distribution by asset and exchange</p>
              {portfolioValue > 0 ? (
                <div className="flex flex-col sm:flex-row items-center gap-4 sm:gap-8">
                  {/* Donut chart */}
                  <div className="relative">
                    <ResponsiveContainer width={180} height={180}>
                      <PieChart>
                        <Pie
                          data={allocationData}
                          cx="50%"
                          cy="50%"
                          innerRadius={55}
                          outerRadius={80}
                          paddingAngle={2}
                          dataKey="value"
                        >
                          {allocationData.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.color} />
                          ))}
                        </Pie>
                        <Tooltip
                          contentStyle={{ backgroundColor: "#1e2329", border: "1px solid #2d3139", fontSize: 12, borderRadius: 8 }}
                          formatter={(value: any, name: string) => [
                            fmtUsd(value),
                            name,
                          ]}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                    {/* Center label */}
                    <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                      <span className="text-[10px] text-gray-400">Total</span>
                      <span className="text-sm font-bold text-white">{fmtUsdInt(portfolioValue)}</span>
                    </div>
                  </div>

                  {/* Legend */}
                  <div className="flex-1 w-full space-y-2">
                    {allocationData.map((entry) => {
                      const pct = portfolioValue > 0 ? ((entry.value / portfolioValue) * 100).toFixed(1) : "0.0";
                      return (
                        <div key={entry.name} className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: entry.color }} />
                            <span className="text-xs text-gray-300">{entry.name}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-medium text-white">{fmtUsdInt(entry.value)}</span>
                            <span className="text-[10px] text-gray-500 w-12 text-right">{pct}%</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-center h-[140px] text-gray-500 text-sm">
                  No portfolio data yet. Import a CSV to see allocation.
                </div>
              )}
            </Card>

            {/* BTC Price Trend Chart with Buy Markers - Full Width */}
            <Card className="bg-[#1e2329] border-[#2d3139] p-3 sm:p-6 mb-4 sm:mb-8">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-2 sm:mb-4">
                <div>
                  <h3 className="text-sm sm:text-lg font-semibold">BTC Price & Your Buys</h3>
                  <p className="text-[10px] sm:text-xs text-gray-500 mt-0.5">
                    Price history with buy markers — larger dots = bigger buys
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {/* Range filter buttons */}
                  <div className="flex items-center gap-1 bg-[#0b0e11] rounded-lg p-1">
                    {(["1M", "3M", "6M", "ALL"] as ChartRange[]).map((r) => rangeBtn(r))}
                  </div>
                  {buyPoints.length > 0 && (
                    <div className="flex items-center gap-1.5 text-[10px] sm:text-xs text-gray-400 ml-1">
                      <span className="inline-block w-2.5 h-2.5 rounded-full bg-[#f7931a]" />
                      <span>{visibleBuys} buys</span>
                    </div>
                  )}
                </div>
              </div>
              {priceHistoryLoading ? (
                <div className="flex items-center justify-center h-[280px] sm:h-[400px]">
                  <div className="flex items-center gap-2 text-gray-400">
                    <RefreshCw size={16} className="animate-spin" />
                    <span className="text-sm">Loading price data...</span>
                  </div>
                </div>
              ) : priceTrendData.length > 0 ? (
                <ResponsiveContainer width="100%" height={isMobile ? 300 : 420}>
                  <ComposedChart data={priceTrendData} margin={{ top: 20, right: 10, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="priceGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#f7931a" stopOpacity={0.15} />
                        <stop offset="100%" stopColor="#f7931a" stopOpacity={0.01} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#2d3139" />
                    <XAxis
                      dataKey="date"
                      stroke="#888"
                      fontSize={10}
                      tickFormatter={(val: string) => {
                        const parts = val.split("-");
                        return `${parts[1]}/${parts[2]}`;
                      }}
                      interval="preserveStartEnd"
                      minTickGap={40}
                    />
                    <YAxis
                      stroke="#888"
                      fontSize={10}
                      domain={["auto", "auto"]}
                      tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`}
                    />
                    <Tooltip content={<PriceTrendTooltip />} />
                    <Area
                      type="monotone"
                      dataKey="price"
                      fill="url(#priceGradient)"
                      stroke="none"
                    />
                    <Line
                      type="monotone"
                      dataKey="price"
                      stroke="#f7931a"
                      dot={false}
                      strokeWidth={2}
                      name="BTC Price"
                    />
                    <Line
                      type="monotone"
                      dataKey="buyPrice"
                      stroke="none"
                      dot={<BuyMarkerDot />}
                      name="Buy"
                      connectNulls={false}
                      legendType="none"
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              ) : (
                <div className="flex items-center justify-center h-[280px] sm:h-[400px] text-gray-500 text-sm">
                  Unable to load price data. Try refreshing.
                </div>
              )}
            </Card>

            {/* Charts Section */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-8 mb-4 sm:mb-8">
              {/* Cumulative BTC Chart with Avg Cost line */}
              <Card className="bg-[#1e2329] border-[#2d3139] p-3 sm:p-6">
                <h3 className="text-sm sm:text-lg font-semibold mb-2 sm:mb-4">BTC Holdings & Avg Cost</h3>
                <ResponsiveContainer width="100%" height={250}>
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#2d3139" />
                    <XAxis dataKey="date" stroke="#888" fontSize={11} />
                    <YAxis yAxisId="btc" stroke="#f7931a" fontSize={11} />
                    <YAxis yAxisId="cost" orientation="right" stroke="#8884d8" fontSize={11}
                      tickFormatter={(v: number) => fmtUsdInt(v)} />
                    <Tooltip
                      contentStyle={{ backgroundColor: "#1e2329", border: "1px solid #2d3139", fontSize: 12 }}
                      formatter={(value: any, name: string) => {
                        if (name === "BTC Holdings") return value.toFixed(6);
                        if (name === "Avg Cost/BTC") return fmtUsd(value);
                        return value;
                      }}
                    />
                    <Legend />
                    <Line
                      yAxisId="btc"
                      type="monotone"
                      dataKey="cumulativeBtc"
                      stroke="#f7931a"
                      dot={false}
                      name="BTC Holdings"
                      strokeWidth={2}
                    />
                    <Line
                      yAxisId="cost"
                      type="monotone"
                      dataKey="avgCost"
                      stroke="#8884d8"
                      dot={false}
                      name="Avg Cost/BTC"
                      strokeWidth={2}
                      strokeDasharray="5 5"
                    />
                  </LineChart>
                </ResponsiveContainer>
              </Card>


            </div>

            {/* Monthly Breakdown Table */}
            <Card className="bg-[#1e2329] border-[#2d3139] p-3 sm:p-6 mb-4 sm:mb-8">
              <h3 className="text-sm sm:text-lg font-semibold mb-2 sm:mb-4">Monthly Breakdown</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[#2d3139]">
                      <th className="text-left py-2 sm:py-3 px-2 sm:px-4 text-gray-400 text-xs sm:text-sm">Month</th>
                      <th className="text-right py-2 sm:py-3 px-2 sm:px-4 text-gray-400 text-xs sm:text-sm">BTC</th>
                      <th className="text-right py-2 sm:py-3 px-2 sm:px-4 text-gray-400 text-xs sm:text-sm">Cost</th>
                      <th className="text-right py-2 sm:py-3 px-2 sm:px-4 text-gray-400 text-xs sm:text-sm">Value</th>
                      <th className="text-right py-2 sm:py-3 px-2 sm:px-4 text-gray-400 text-xs sm:text-sm">P&L</th>
                      <th className="text-right py-2 sm:py-3 px-2 sm:px-4 text-gray-400 text-xs sm:text-sm hidden sm:table-cell">Avg Price</th>
                      <th className="text-right py-2 sm:py-3 px-2 sm:px-4 text-gray-400 text-xs sm:text-sm hidden sm:table-cell">Cumulative</th>
                    </tr>
                  </thead>
                  <tbody>
                    {monthlyData.map((row, idx) => {
                      const monthValue = row.btcBought * currentBtcPrice;
                      const monthPnl = monthValue - row.totalCost;
                      const monthPnlPct = row.totalCost > 0 ? (monthPnl / row.totalCost) * 100 : 0;
                      const pnlUp = monthPnl >= 0;
                      return (
                        <tr key={idx} className="border-b border-[#2d3139] hover:bg-[#2d3139] transition-colors">
                          <td className="py-2 sm:py-3 px-2 sm:px-4 text-xs sm:text-sm">{row.month}</td>
                          <td className="text-right py-2 sm:py-3 px-2 sm:px-4 text-[#f7931a] text-xs sm:text-sm">{row.btcBought.toFixed(4)}</td>
                          <td className="text-right py-2 sm:py-3 px-2 sm:px-4 text-xs sm:text-sm">{fmtUsd(row.totalCost)}</td>
                          <td className={`text-right py-2 sm:py-3 px-2 sm:px-4 text-xs sm:text-sm ${pnlUp ? "text-[#00b96b]" : "text-[#f6465d]"}`}>{fmtUsd(monthValue)}</td>
                          <td className={`text-right py-2 sm:py-3 px-2 sm:px-4 text-xs sm:text-sm ${pnlUp ? "text-[#00b96b]" : "text-[#f6465d]"}`}>{pnlUp ? "+" : "-"}{Math.abs(monthPnlPct).toFixed(1)}%</td>
                          <td className="text-right py-2 sm:py-3 px-2 sm:px-4 text-xs sm:text-sm hidden sm:table-cell">{fmtUsd(row.avgPrice)}</td>
                          <td className="text-right py-2 sm:py-3 px-2 sm:px-4 font-semibold text-xs sm:text-sm hidden sm:table-cell">{row.cumulativeBtc.toFixed(6)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>

            {/* DCA Performance Chart */}
            <Card className="bg-[#1e2329] border-[#2d3139] p-3 sm:p-6 mb-4 sm:mb-8">
              <h3 className="text-sm sm:text-lg font-semibold mb-1">DCA Performance</h3>
              <p className="text-[10px] sm:text-xs text-gray-500 mt-0.5 mb-4">
                Each buy — P&L % over time vs BTC price at time of buy.
              </p>
              {dcaPerformanceData.length > 0 ? (
                <>
                  <div className="flex items-center gap-2 mb-4">
                    <div className="flex items-center gap-1 bg-[#0b0e11] rounded-lg p-1">
                      <button
                        onClick={() => setDcaChartView("pnl")}
                        className={`px-3 py-1 rounded text-[10px] sm:text-xs font-medium transition-colors ${
                          dcaChartView === "pnl"
                            ? "bg-[#f7931a] text-black"
                            : "text-gray-400 hover:text-white"
                        }`}
                      >
                        P&L % Over Time
                      </button>
                      <button
                        onClick={() => setDcaChartView("scatter")}
                        className={`px-3 py-1 rounded text-[10px] sm:text-xs font-medium transition-colors ${
                          dcaChartView === "scatter"
                            ? "bg-[#f7931a] text-black"
                            : "text-gray-400 hover:text-white"
                        }`}
                      >
                        Entry vs Return
                      </button>
                    </div>
                  </div>
                  {dcaChartView === "pnl" ? (
                    <ResponsiveContainer width="100%" height={isMobile ? 300 : 380}>
                      <ComposedChart data={dcaPerformanceData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#2d3139" />
                        <XAxis
                          dataKey="date"
                          stroke="#888"
                          fontSize={9}
                          tickFormatter={(val: string) => {
                            const parts = val.split("-");
                            return `${parts[1]}/${parts[2]}`;
                          }}
                          interval="preserveStartEnd"
                          minTickGap={40}
                        />
                        <YAxis
                          stroke="#888"
                          fontSize={10}
                          tickFormatter={(v: number) => `${v.toFixed(0)}%`}
                        />
                        <Tooltip
                          contentStyle={{ backgroundColor: "#1e2329", border: "1px solid #2d3139", fontSize: 12, borderRadius: 8 }}
                          formatter={(value: any, name: string) => {
                            if (name === "P&L %") return [`${value.toFixed(1)}%`, "P&L %"];
                            if (name === "BTC Price ($)") return [`$${value.toLocaleString("en-US", { minimumFractionDigits: 0 })}`, "BTC Price ($)"];
                            return [value, name];
                          }}
                        />
                        <Legend />
                        <Line
                          type="monotone"
                          dataKey="pnlPct"
                          stroke="#00b96b"
                          strokeWidth={2}
                          dot={{ fill: "#00b96b", r: 3 }}
                          activeDot={{ r: 5 }}
                          name="P&L %"
                        />
                        <Line
                          type="monotone"
                          dataKey="price"
                          stroke="#f7931a"
                          strokeWidth={1.5}
                          strokeDasharray="4 3"
                          dot={false}
                          activeDot={{ r: 4 }}
                          name="BTC Price ($)"
                        />
                      </ComposedChart>
                    </ResponsiveContainer>
                  ) : (
                    <ResponsiveContainer width="100%" height={isMobile ? 300 : 380}>
                      <ScatterChart margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#2d3139" />
                        <XAxis
                          dataKey="price"
                          stroke="#888"
                          fontSize={10}
                          name="Entry Price"
                          tickFormatter={(v: number) => `$${(v / 1000).toFixed(0)}k`}
                          type="number"
                          domain={["auto", "auto"]}
                        />
                        <YAxis
                          dataKey="pnlPct"
                          stroke="#888"
                          fontSize={10}
                          name="P&L %"
                          tickFormatter={(v: number) => `${v.toFixed(0)}%`}
                        />
                        <Tooltip
                          contentStyle={{ backgroundColor: "#1e2329", border: "1px solid #2d3139", fontSize: 12, borderRadius: 8 }}
                          formatter={(value: any, name: string) => {
                            if (name === "Entry Price") return [`$${value.toLocaleString("en-US")}`, "Entry Price"];
                            if (name === "P&L %") return [`${value.toFixed(1)}%`, "P&L %"];
                            if (name === "BTC Amount") return [`${value.toFixed(4)} BTC`, "BTC Amount"];
                            return [value, name];
                          }}
                          payload={dcaPerformanceData.map((d) => ({ payload: d }))}
                        />
                        <Scatter
                          data={dcaPerformanceData}
                          fill="#f7931a"
                          name="Buy"
                        >
                          {dcaPerformanceData.map((entry, index) => (
                            <Cell
                              key={`cell-${index}`}
                              fill={entry.pnlPct >= 0 ? "#00b96b" : "#f6465d"}
                              fillOpacity={0.75}
                            />
                          ))}
                        </Scatter>
                      </ScatterChart>
                    </ResponsiveContainer>
                  )}
                </>
              ) : (
                <div className="flex items-center justify-center h-[260px] text-gray-500 text-sm">
                  No buy data yet. Import a CSV to see DCA performance.
                </div>
              )}
              {/* Best / Worst buys summary */}
              {dcaPerformanceData.length > 0 && (() => {
                const sorted = [...dcaPerformanceData].sort((a, b) => b.pnlPct - a.pnlPct);
                const best = sorted[0];
                const worst = sorted[sorted.length - 1];
                return (
                  <div className="flex flex-col sm:flex-row gap-3 mt-4 pt-4 border-t border-[#2d3139]">
                    <div className="flex-1 p-3 rounded-lg bg-[#0b0e11] border border-[#2d3139]">
                      <p className="text-[10px] text-gray-500 mb-1">Best Entry</p>
                      <p className="text-xs font-semibold text-white">{best.date}</p>
                      <p className="text-[10px] text-[#00b96b] mt-0.5">
                        +{best.pnlPct.toFixed(1)}% · {best.btcAmount.toFixed(4)} BTC
                      </p>
                    </div>
                    <div className="flex-1 p-3 rounded-lg bg-[#0b0e11] border border-[#2d3139]">
                      <p className="text-[10px] text-gray-500 mb-1">Worst Entry</p>
                      <p className="text-xs font-semibold text-white">{worst.date}</p>
                      <p className={`text-[10px] mt-0.5 ${worst.pnlPct >= 0 ? "text-[#00b96b]" : "text-[#f6465d]"}`}>
                        {worst.pnlPct >= 0 ? "+" : ""}{worst.pnlPct.toFixed(1)}% · {worst.btcAmount.toFixed(4)} BTC
                      </p>
                    </div>
                  </div>
                );
              })()}
            </Card>

            {/* Transaction Table */}
            <Card className="bg-[#1e2329] border-[#2d3139] p-3 sm:p-6">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3 sm:mb-4">
                <div>
                  <h3 className="text-sm sm:text-lg font-semibold">All Transactions</h3>
                  <p className="text-[10px] sm:text-xs text-gray-500 mt-0.5">
                    {filteredSortedTxns.length} of {transactions.length} transactions
                    {hasActiveFilters && " (filtered)"}
                  </p>
                </div>
                {hasActiveFilters && (
                  <button
                    onClick={() => {
                      setTxFilters({ date: "", method: "", amount: "", currency: "", status: "" });
                      setTxPage(0);
                    }}
                    className="flex items-center gap-1 text-[10px] sm:text-xs text-gray-400 hover:text-white transition-colors"
                  >
                    <X size={12} />
                    Clear filters
                  </button>
                )}
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    {/* Sort headers */}
                    <tr className="border-b border-[#2d3139]">
                      <th
                        className="text-left py-2 sm:py-3 px-2 sm:px-4 text-gray-400 text-xs sm:text-sm cursor-pointer hover:text-white transition-colors select-none"
                        onClick={() => handleTxSort("date")}
                      >
                        Date <SortIcon field="date" />
                      </th>
                      <th
                        className="text-left py-2 sm:py-3 px-2 sm:px-4 text-gray-400 text-xs sm:text-sm cursor-pointer hover:text-white transition-colors select-none"
                        onClick={() => handleTxSort("method")}
                      >
                        Method <SortIcon field="method" />
                      </th>
                      <th
                        className="text-right py-2 sm:py-3 px-2 sm:px-4 text-gray-400 text-xs sm:text-sm cursor-pointer hover:text-white transition-colors select-none"
                        onClick={() => handleTxSort("amount")}
                      >
                        Amount <SortIcon field="amount" />
                      </th>
                      <th
                        className="text-left py-2 sm:py-3 px-2 sm:px-4 text-gray-400 text-xs sm:text-sm cursor-pointer hover:text-white transition-colors select-none"
                        onClick={() => handleTxSort("currency")}
                      >
                        Currency <SortIcon field="currency" />
                      </th>
                      <th
                        className="text-left py-2 sm:py-3 px-2 sm:px-4 text-gray-400 text-xs sm:text-sm cursor-pointer hover:text-white transition-colors select-none hidden sm:table-cell"
                        onClick={() => handleTxSort("status")}
                      >
                        Status <SortIcon field="status" />
                      </th>
                    </tr>
                    {/* Filter row */}
                    <tr className="border-b border-[#2d3139] bg-[#0b0e11]/50">
                      <td className="py-1.5 px-2 sm:px-4">
                        <div className="relative">
                          <Search size={10} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-600" />
                          <input
                            type="text"
                            value={txFilters.date}
                            onChange={(e) => handleTxFilterChange("date", e.target.value)}
                            placeholder="Filter..."
                            className="w-full bg-[#1e2329] border border-[#2d3139] rounded px-2 py-1 pl-6 text-[10px] sm:text-xs text-white placeholder-gray-600 focus:border-[#f7931a] focus:outline-none transition-colors"
                          />
                        </div>
                      </td>
                      <td className="py-1.5 px-2 sm:px-4">
                        <div className="relative">
                          <Search size={10} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-600" />
                          <input
                            type="text"
                            value={txFilters.method}
                            onChange={(e) => handleTxFilterChange("method", e.target.value)}
                            placeholder="Filter..."
                            className="w-full bg-[#1e2329] border border-[#2d3139] rounded px-2 py-1 pl-6 text-[10px] sm:text-xs text-white placeholder-gray-600 focus:border-[#f7931a] focus:outline-none transition-colors"
                          />
                        </div>
                      </td>
                      <td className="py-1.5 px-2 sm:px-4">
                        <div className="relative">
                          <Search size={10} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-600" />
                          <input
                            type="text"
                            value={txFilters.amount}
                            onChange={(e) => handleTxFilterChange("amount", e.target.value)}
                            placeholder="Filter..."
                            className="w-full bg-[#1e2329] border border-[#2d3139] rounded px-2 py-1 pl-6 text-[10px] sm:text-xs text-white placeholder-gray-600 focus:border-[#f7931a] focus:outline-none transition-colors"
                          />
                        </div>
                      </td>
                      <td className="py-1.5 px-2 sm:px-4">
                        <div className="relative">
                          <Search size={10} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-600" />
                          <input
                            type="text"
                            value={txFilters.currency}
                            onChange={(e) => handleTxFilterChange("currency", e.target.value)}
                            placeholder="Filter..."
                            className="w-full bg-[#1e2329] border border-[#2d3139] rounded px-2 py-1 pl-6 text-[10px] sm:text-xs text-white placeholder-gray-600 focus:border-[#f7931a] focus:outline-none transition-colors"
                          />
                        </div>
                      </td>
                      <td className="py-1.5 px-2 sm:px-4 hidden sm:table-cell">
                        <div className="relative">
                          <Search size={10} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-600" />
                          <input
                            type="text"
                            value={txFilters.status}
                            onChange={(e) => handleTxFilterChange("status", e.target.value)}
                            placeholder="Filter..."
                            className="w-full bg-[#1e2329] border border-[#2d3139] rounded px-2 py-1 pl-6 text-[10px] sm:text-xs text-white placeholder-gray-600 focus:border-[#f7931a] focus:outline-none transition-colors"
                          />
                        </div>
                      </td>
                    </tr>
                  </thead>
                  <tbody>
                    {pagedTxns.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="text-center py-8 text-gray-500 text-sm">
                          No transactions match your filters.
                        </td>
                      </tr>
                    ) : (
                      pagedTxns.map((tx, idx) => {
                        const isPositive = tx.amount > 0;
                        const isBtc = tx.currency === "BTC";
                        return (
                          <tr key={`${tx.date}-${idx}`} className="border-b border-[#2d3139] hover:bg-[#2d3139]/60 transition-colors">
                            <td className="py-2 sm:py-3 px-2 sm:px-4 text-[10px] sm:text-xs text-gray-300 whitespace-nowrap">
                              {tx.date.split(" ")[0]}
                              <span className="text-gray-600 ml-1 hidden sm:inline">{tx.date.split(" ")[1]}</span>
                            </td>
                            <td className="py-2 sm:py-3 px-2 sm:px-4 text-[10px] sm:text-xs text-gray-300">
                              {tx.method}
                            </td>
                            <td className={`text-right py-2 sm:py-3 px-2 sm:px-4 text-[10px] sm:text-xs font-mono ${
                              isBtc ? "text-[#f7931a]" : isPositive ? "text-[#00b96b]" : "text-[#f6465d]"
                            }`}>
                              {isPositive ? "+" : ""}{isBtc ? tx.amount.toFixed(8) : tx.amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </td>
                            <td className="py-2 sm:py-3 px-2 sm:px-4 text-[10px] sm:text-xs">
                              <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[9px] sm:text-[10px] font-medium ${
                                tx.currency === "BTC" ? "bg-[#f7931a]/15 text-[#f7931a]" :
                                tx.currency === "USD" ? "bg-green-900/30 text-green-400" :
                                tx.currency === "HKD" ? "bg-blue-900/30 text-blue-400" :
                                tx.currency === "ETH" ? "bg-purple-900/30 text-purple-400" :
                                "bg-gray-800 text-gray-400"
                              }`}>
                                {tx.currency}
                              </span>
                            </td>
                            <td className="py-2 sm:py-3 px-2 sm:px-4 text-[10px] sm:text-xs hidden sm:table-cell">
                              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] sm:text-[10px] font-medium bg-[#00b96b]/15 text-[#00b96b]">
                                {tx.status}
                              </span>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

              {/* Pagination */}
              {txTotalPages > 1 && (
                <div className="flex items-center justify-between mt-3 pt-3 border-t border-[#2d3139]">
                  <p className="text-[10px] sm:text-xs text-gray-500">
                    Page {txPage + 1} of {txTotalPages}
                  </p>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => setTxPage(0)}
                      disabled={txPage === 0}
                      className="px-2 py-1 rounded text-[10px] sm:text-xs bg-[#2d3139] text-gray-400 hover:bg-[#3d4149] hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    >
                      First
                    </button>
                    <button
                      onClick={() => setTxPage((p) => Math.max(0, p - 1))}
                      disabled={txPage === 0}
                      className="px-2 py-1 rounded text-[10px] sm:text-xs bg-[#2d3139] text-gray-400 hover:bg-[#3d4149] hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    >
                      Prev
                    </button>
                    <button
                      onClick={() => setTxPage((p) => Math.min(txTotalPages - 1, p + 1))}
                      disabled={txPage >= txTotalPages - 1}
                      className="px-2 py-1 rounded text-[10px] sm:text-xs bg-[#2d3139] text-gray-400 hover:bg-[#3d4149] hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    >
                      Next
                    </button>
                    <button
                      onClick={() => setTxPage(txTotalPages - 1)}
                      disabled={txPage >= txTotalPages - 1}
                      className="px-2 py-1 rounded text-[10px] sm:text-xs bg-[#2d3139] text-gray-400 hover:bg-[#3d4149] hover:text-white disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    >
                      Last
                    </button>
                  </div>
                </div>
              )}
            </Card>
          </>
        )}
      </main>
    </div>
  );
}
