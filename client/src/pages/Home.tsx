import { useState, useEffect, useRef, useMemo } from "react";
import { Upload, TrendingUp, TrendingDown, RefreshCw, Calendar, Repeat, DollarSign, ArrowUpDown, ArrowUp, ArrowDown, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, ComposedChart, Scatter, Area,
} from "recharts";
import { useIsMobile } from "@/hooks/useMobile";

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

const HKD_TO_USD = 7.8;

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
  const [txSortField, setTxSortField] = useState<SortField>("date");
  const [txSortDir, setTxSortDir] = useState<SortDir>("desc");
  const [txFilters, setTxFilters] = useState<Record<SortField, string>>({
    date: "", method: "", amount: "", currency: "", status: "",
  });
  const [txPage, setTxPage] = useState(0);
  const TX_PER_PAGE = 20;

  // Load saved portfolio from localStorage on mount
  useEffect(() => {
    const saved = localStorage.getItem("btc_portfolio");
    if (saved) {
      try {
        const data = JSON.parse(saved);
        setTransactions(data.transactions || []);
        setTotalBtc(data.totalBtc || 0);
        setTotalUsdSpent(data.totalUsdSpent || 0);
        setAvgCostPerBtc(data.avgCostPerBtc || 0);
        setMonthlyData(data.monthlyData || []);
        setChartData(data.chartData || []);
        if (data.buyPoints) setBuyPoints(data.buyPoints);
      } catch (e) {
        console.error("Error loading saved portfolio:", e);
      }
    }
  }, []);

  // Fetch BTC price from CoinGecko
  const fetchBtcPrice = async () => {
    try {
      const response = await fetch(
        "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd"
      );
      const data = await response.json();
      const price = data.bitcoin.usd;
      setCurrentBtcPrice(price);
      return price;
    } catch (error) {
      console.error("Error fetching BTC price:", error);
      return currentBtcPrice;
    }
  };

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

  // Auto-refresh BTC price every 30 seconds
  useEffect(() => {
    fetchBtcPrice();
    const interval = setInterval(fetchBtcPrice, 30000);
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
    const monthlyMap = new Map<string, { btc: number; cost: number }>();
    const cumulativeData: any[] = [];

    // Sort by date
    const sorted = [...txns].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

    // Build a set of timestamps that have BTC purchases
    const btcBuyTimestamps = new Set<string>();
    sorted.forEach((tx) => {
      if (tx.currency === "BTC" && tx.amount > 0) {
        btcBuyTimestamps.add(tx.date);
      }
    });

    // Build buy points for the price trend chart
    const buyByTimestamp = new Map<string, { btc: number; cost: number }>();

    let cumulativeBtc = 0;
    let cumulativeCost = 0;

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

        cumulativeData.push({
          date: tx.date.split(" ")[0],
          cumulativeBtc: cumulativeBtc,
          costBasis: cumulativeCost,
          avgCost: cumulativeBtc > 0 ? cumulativeCost / cumulativeBtc : 0,
        });
      } else if ((tx.currency === "USD" || tx.currency === "HKD") && tx.amount < 0) {
        if (btcBuyTimestamps.has(tx.date)) {
          const usdAmount = tx.currency === "HKD" ? Math.abs(tx.amount) / HKD_TO_USD : Math.abs(tx.amount);
          usdSpent += usdAmount;
          cumulativeCost += usdAmount;

          if (!monthlyMap.has(monthKey)) {
            monthlyMap.set(monthKey, { btc: 0, cost: 0 });
          }
          const monthly = monthlyMap.get(monthKey)!;
          monthly.cost += usdAmount;

          if (!buyByTimestamp.has(tx.date)) {
            buyByTimestamp.set(tx.date, { btc: 0, cost: 0 });
          }
          buyByTimestamp.get(tx.date)!.cost += usdAmount;
        }
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

    localStorage.setItem("btc_portfolio", JSON.stringify({
      transactions: txns,
      totalBtc: btc,
      totalUsdSpent: usdSpent,
      avgCostPerBtc: avgCost,
      monthlyData: monthlyArray,
      chartData: cumulativeData,
      buyPoints: extractedBuyPoints,
    }));
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

  // Update portfolio value when price changes
  useEffect(() => {
    if (totalBtc === 0) return;
    const value = totalBtc * currentBtcPrice;
    setPortfolioValue(value);

    const pnl = value - totalUsdSpent;
    setPnlUsd(pnl);

    const pnlPct = totalUsdSpent > 0 ? (pnl / totalUsdSpent) * 100 : 0;
    setPnlPercent(pnlPct);
  }, [currentBtcPrice, totalBtc, totalUsdSpent]);

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
        {/* Upload Section - only show if no data */}
        {transactions.length === 0 ? (
          <div className="mb-8">
            <div
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed border-[#2d3139] rounded-lg p-6 sm:p-12 text-center cursor-pointer hover:border-[#f7931a] transition-colors"
            >
              <Upload size={48} className="mx-auto mb-4 text-[#f7931a]" />
              <h2 className="text-xl font-semibold mb-2">Upload Transaction Report</h2>
              <p className="text-gray-400 mb-4">Drag and drop your CSV file or click to browse</p>
              <Button className="bg-[#f7931a] hover:bg-[#f9a825] text-black font-semibold">
                Select CSV File
              </Button>
            </div>
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
              {/* Total BTC */}
              <Card className="bg-[#1e2329] border-[#2d3139] p-3 sm:p-6">
                <p className="text-gray-400 text-xs sm:text-sm mb-1 sm:mb-2">Total BTC</p>
                <p className="text-lg sm:text-3xl font-bold text-white mb-1">{totalBtc.toFixed(6)}</p>
                <p className="text-xs text-gray-500 hidden sm:block">B Bitcoin</p>
              </Card>

              {/* Average Cost */}
              <Card className="bg-[#1e2329] border-[#2d3139] p-3 sm:p-6">
                <p className="text-gray-400 text-xs sm:text-sm mb-1 sm:mb-2">Avg Cost/BTC</p>
                <p className="text-lg sm:text-3xl font-bold text-white mb-1">{fmtUsd(avgCostPerBtc)}</p>
                <p className="text-xs text-gray-500 hidden sm:block">All amounts in USD</p>
              </Card>

              {/* Current Price */}
              <Card className="bg-[#1e2329] border-[#2d3139] p-3 sm:p-6">
                <p className="text-gray-400 text-xs sm:text-sm mb-1 sm:mb-2">BTC Price</p>
                <p className="text-lg sm:text-3xl font-bold text-white mb-1">{fmtUsd(currentBtcPrice)}</p>
                <p className="text-xs text-gray-500 hidden sm:block">Real-time CoinGecko</p>
              </Card>

              {/* Total Spent */}
              <Card className="bg-[#1e2329] border-[#2d3139] p-3 sm:p-6">
                <p className="text-gray-400 text-xs sm:text-sm mb-1 sm:mb-2">Total Spent</p>
                <p className="text-lg sm:text-3xl font-bold text-white mb-1">{fmtUsd(totalUsdSpent)}</p>
                <p className="text-xs text-gray-500 hidden sm:block">HKD converted at {HKD_TO_USD}</p>
              </Card>

              {/* Portfolio Value */}
              <Card className="bg-[#1e2329] border-[#2d3139] p-3 sm:p-6">
                <p className="text-gray-400 text-xs sm:text-sm mb-1 sm:mb-2">Portfolio Value</p>
                <p className="text-lg sm:text-3xl font-bold text-white mb-1">{fmtUsd(portfolioValue)}</p>
                <p className="text-xs text-gray-500 hidden sm:block">Current Market Value</p>
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

              {/* Cost Basis vs Current Value */}
              <Card className="bg-[#1e2329] border-[#2d3139] p-3 sm:p-6">
                <h3 className="text-sm sm:text-lg font-semibold mb-2 sm:mb-4">Cost Basis vs Current Value</h3>
                <ResponsiveContainer width="100%" height={250}>
                  <BarChart data={[
                    {
                      name: "Portfolio",
                      "Cost Basis": totalUsdSpent,
                      "Current Value": portfolioValue,
                    },
                  ]}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#2d3139" />
                    <XAxis dataKey="name" stroke="#888" />
                    <YAxis stroke="#888" tickFormatter={(v: number) => fmtUsdInt(v)} />
                    <Tooltip
                      contentStyle={{ backgroundColor: "#1e2329", border: "1px solid #2d3139" }}
                      formatter={(value: any) => fmtUsd(value)}
                    />
                    <Legend />
                    <Bar dataKey="Cost Basis" fill="#888" />
                    <Bar dataKey="Current Value" fill={isProfitable ? "#00b96b" : "#f6465d"} />
                  </BarChart>
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
                      <th className="text-right py-2 sm:py-3 px-2 sm:px-4 text-gray-400 text-xs sm:text-sm">Avg Price</th>
                      <th className="text-right py-2 sm:py-3 px-2 sm:px-4 text-gray-400 text-xs sm:text-sm hidden sm:table-cell">Cumulative</th>
                    </tr>
                  </thead>
                  <tbody>
                    {monthlyData.map((row, idx) => (
                      <tr key={idx} className="border-b border-[#2d3139] hover:bg-[#2d3139] transition-colors">
                        <td className="py-2 sm:py-3 px-2 sm:px-4 text-xs sm:text-sm">{row.month}</td>
                        <td className="text-right py-2 sm:py-3 px-2 sm:px-4 text-[#f7931a] text-xs sm:text-sm">{row.btcBought.toFixed(4)}</td>
                        <td className="text-right py-2 sm:py-3 px-2 sm:px-4 text-xs sm:text-sm">{fmtUsd(row.totalCost)}</td>
                        <td className="text-right py-2 sm:py-3 px-2 sm:px-4 text-xs sm:text-sm">{fmtUsd(row.avgPrice)}</td>
                        <td className="text-right py-2 sm:py-3 px-2 sm:px-4 font-semibold text-xs sm:text-sm hidden sm:table-cell">{row.cumulativeBtc.toFixed(6)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
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
