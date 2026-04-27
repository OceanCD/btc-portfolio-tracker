import { useState, useEffect, useRef } from "react";
import { Upload, TrendingUp, TrendingDown, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";

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

const HKD_TO_USD = 7.8;

// Format USD with thousand separators and 2 decimal places
const fmtUsd = (value: number) =>
  "$" + value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Format USD for large numbers (no decimals)
const fmtUsdInt = (value: number) =>
  "$" + Math.round(value).toLocaleString("en-US");

export default function Home() {
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

  // Auto-refresh BTC price every 30 seconds
  useEffect(() => {
    fetchBtcPrice();
    const interval = setInterval(fetchBtcPrice, 30000);
    return () => clearInterval(interval);
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
    // so we only count USD/HKD costs that are paired with BTC buys
    const btcBuyTimestamps = new Set<string>();
    sorted.forEach((tx) => {
      if (tx.currency === "BTC" && tx.amount > 0) {
        btcBuyTimestamps.add(tx.date);
      }
    });

    let cumulativeBtc = 0;
    let cumulativeCost = 0;

    sorted.forEach((tx) => {
      const date = new Date(tx.date);
      const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;

      if (tx.currency === "BTC" && tx.amount > 0) {
        btc += tx.amount;
        cumulativeBtc += tx.amount;

        if (!monthlyMap.has(monthKey)) {
          monthlyMap.set(monthKey, { btc: 0, cost: 0 });
        }
        const monthly = monthlyMap.get(monthKey)!;
        monthly.btc += tx.amount;

        // Add chart data point after each BTC buy (with running avg cost)
        cumulativeData.push({
          date: tx.date.split(" ")[0],
          cumulativeBtc: cumulativeBtc,
          costBasis: cumulativeCost,
          avgCost: cumulativeBtc > 0 ? cumulativeCost / cumulativeBtc : 0,
        });
      } else if ((tx.currency === "USD" || tx.currency === "HKD") && tx.amount < 0) {
        // Only count this cost if it's paired with a BTC purchase at the same timestamp
        // All HKD amounts are converted to USD
        if (btcBuyTimestamps.has(tx.date)) {
          const usdAmount = tx.currency === "HKD" ? Math.abs(tx.amount) / HKD_TO_USD : Math.abs(tx.amount);
          usdSpent += usdAmount;
          cumulativeCost += usdAmount;

          if (!monthlyMap.has(monthKey)) {
            monthlyMap.set(monthKey, { btc: 0, cost: 0 });
          }
          const monthly = monthlyMap.get(monthKey)!;
          monthly.cost += usdAmount;
        }
      }
    });

    setTotalBtc(btc);
    setTotalUsdSpent(usdSpent);

    const avgCost = btc > 0 ? usdSpent / btc : 0;
    setAvgCostPerBtc(avgCost);

    // Calculate monthly breakdown
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

    // Calculate cumulative BTC for each month
    let cumBtc = 0;
    monthlyArray.forEach((m) => {
      cumBtc += m.btcBought;
      m.cumulativeBtc = cumBtc;
    });

    setMonthlyData(monthlyArray);
    setChartData(cumulativeData);

    // Save portfolio to localStorage so it persists
    localStorage.setItem("btc_portfolio", JSON.stringify({
      transactions: txns,
      totalBtc: btc,
      totalUsdSpent: usdSpent,
      avgCostPerBtc: avgCost,
      monthlyData: monthlyArray,
      chartData: cumulativeData,
    }));
  };

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

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#0b0e11] to-[#1e2329] text-white">
      {/* Header */}
      <header className="border-b border-[#2d3139] bg-[#0b0e11] sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-[#f7931a] to-[#f9a825] flex items-center justify-center font-bold text-lg">
              ₿
            </div>
            <h1 className="text-2xl font-bold">BTC Portfolio Tracker</h1>
          </div>
          <div className="flex items-center gap-3">
            {transactions.length > 0 && (
              <Button
                onClick={() => fileInputRef.current?.click()}
                className="bg-[#2d3139] hover:bg-[#3d4149] text-white text-sm"
              >
                <Upload size={16} className="mr-1" />
                Update CSV
              </Button>
            )}
            <button
              onClick={() => fetchBtcPrice()}
              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#1e2329] hover:bg-[#2d3139] transition-colors"
            >
              <RefreshCw size={18} />
              <span className="text-sm">Refresh Price</span>
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

      <main className="max-w-7xl mx-auto px-4 py-8">
        {/* Upload Section - only show if no data */}
        {transactions.length === 0 ? (
          <div className="mb-8">
            <div
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed border-[#2d3139] rounded-lg p-12 text-center cursor-pointer hover:border-[#f7931a] transition-colors"
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
            {/* Dashboard Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
              {/* Total BTC */}
              <Card className="bg-[#1e2329] border-[#2d3139] p-6">
                <p className="text-gray-400 text-sm mb-2">Total BTC Accumulated</p>
                <p className="text-3xl font-bold text-white mb-1">{totalBtc.toFixed(6)}</p>
                <p className="text-xs text-gray-500">₿ Bitcoin</p>
              </Card>

              {/* Average Cost */}
              <Card className="bg-[#1e2329] border-[#2d3139] p-6">
                <p className="text-gray-400 text-sm mb-2">Average Cost per BTC</p>
                <p className="text-3xl font-bold text-white mb-1">{fmtUsd(avgCostPerBtc)}</p>
                <p className="text-xs text-gray-500">All amounts converted to USD</p>
              </Card>

              {/* Current Price */}
              <Card className="bg-[#1e2329] border-[#2d3139] p-6">
                <p className="text-gray-400 text-sm mb-2">Current BTC Price</p>
                <p className="text-3xl font-bold text-white mb-1">{fmtUsd(currentBtcPrice)}</p>
                <p className="text-xs text-gray-500">Real-time from CoinGecko</p>
              </Card>

              {/* Total Spent */}
              <Card className="bg-[#1e2329] border-[#2d3139] p-6">
                <p className="text-gray-400 text-sm mb-2">Total USD Spent</p>
                <p className="text-3xl font-bold text-white mb-1">{fmtUsd(totalUsdSpent)}</p>
                <p className="text-xs text-gray-500">Cost Basis (HKD converted at {HKD_TO_USD})</p>
              </Card>

              {/* Portfolio Value */}
              <Card className="bg-[#1e2329] border-[#2d3139] p-6">
                <p className="text-gray-400 text-sm mb-2">Portfolio Value</p>
                <p className="text-3xl font-bold text-white mb-1">{fmtUsd(portfolioValue)}</p>
                <p className="text-xs text-gray-500">Current Market Value</p>
              </Card>

              {/* P&L */}
              <Card className={`${isProfitable ? "bg-[#1e3a2b]" : "bg-[#3a1e1e]"} border-[#2d3139] p-6`}>
                <p className="text-gray-400 text-sm mb-2">Unrealized P&L</p>
                <div className="flex items-center gap-2">
                  {isProfitable ? (
                    <TrendingUp size={24} className="text-[#00b96b]" />
                  ) : (
                    <TrendingDown size={24} className="text-[#f6465d]" />
                  )}
                  <div>
                    <p className={`text-3xl font-bold ${isProfitable ? "text-[#00b96b]" : "text-[#f6465d]"}`}>
                      {isProfitable ? "+" : "-"}{fmtUsd(Math.abs(pnlUsd))}
                    </p>
                    <p className={`text-xs ${isProfitable ? "text-[#00b96b]" : "text-[#f6465d]"}`}>
                      {isProfitable ? "+" : "-"}{Math.abs(pnlPercent).toFixed(2)}%
                    </p>
                  </div>
                </div>
              </Card>
            </div>

            {/* Charts Section */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
              {/* Cumulative BTC Chart with Avg Cost line */}
              <Card className="bg-[#1e2329] border-[#2d3139] p-6">
                <h3 className="text-lg font-semibold mb-4">Cumulative BTC Holdings & Avg Cost</h3>
                <ResponsiveContainer width="100%" height={300}>
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
              <Card className="bg-[#1e2329] border-[#2d3139] p-6">
                <h3 className="text-lg font-semibold mb-4">Cost Basis vs Current Value</h3>
                <ResponsiveContainer width="100%" height={300}>
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
            <Card className="bg-[#1e2329] border-[#2d3139] p-6">
              <h3 className="text-lg font-semibold mb-4">Monthly Breakdown</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[#2d3139]">
                      <th className="text-left py-3 px-4 text-gray-400">Month</th>
                      <th className="text-right py-3 px-4 text-gray-400">BTC Bought</th>
                      <th className="text-right py-3 px-4 text-gray-400">Total Cost (USD)</th>
                      <th className="text-right py-3 px-4 text-gray-400">Avg Price/BTC</th>
                      <th className="text-right py-3 px-4 text-gray-400">Cumulative BTC</th>
                    </tr>
                  </thead>
                  <tbody>
                    {monthlyData.map((row, idx) => (
                      <tr key={idx} className="border-b border-[#2d3139] hover:bg-[#2d3139] transition-colors">
                        <td className="py-3 px-4">{row.month}</td>
                        <td className="text-right py-3 px-4 text-[#f7931a]">{row.btcBought.toFixed(6)}</td>
                        <td className="text-right py-3 px-4">{fmtUsd(row.totalCost)}</td>
                        <td className="text-right py-3 px-4">{fmtUsd(row.avgPrice)}</td>
                        <td className="text-right py-3 px-4 font-semibold">{row.cumulativeBtc.toFixed(6)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </>
        )}
      </main>
    </div>
  );
}
