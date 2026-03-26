import React, { useState, useEffect } from 'react';
import { 
  Shield, 
  Zap, 
  Wallet,
  TrendingUp, 
  AlertTriangle, 
  Settings, 
  Activity, 
  Target, 
  BarChart3, 
  Ghost,
  CheckCircle2,
  XCircle,
  Bell,
  RefreshCw,
  Search,
  ExternalLink,
  Cpu,
  Users,
  Twitter,
  Send,
  Lock,
  Database,
  Brain,
  Globe,
  Key,
  History,
  Save,
  Menu,
  X
} from 'lucide-react';
import { GoogleGenAI } from "@google/genai";
import { motion, AnimatePresence } from 'motion/react';
import { formatDistanceToNow } from 'date-fns';
import { 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  AreaChart,
  Area
} from 'recharts';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// --- Types ---
interface Token {
  id: string;
  symbol: string;
  name: string;
  chain: string;
  address: string;
  boost_level: number;
  liquidity: number;
  buy_pressure: number;
  nana_score: number;
  rug_risk_score: number;
  insider_probability: number;
  wallet_risk: number;
  market_cap: number;
  cto_status: number;
  call_price: number;
  current_price: number;
  ath_price: number;
  created_at: number;
  sentiment_score: number;
  dev_activity_score: number;
  ai_rug_verdict?: string;
  ai_rug_risk_level?: string;
  ai_social_verdict?: string;
  last_security_check?: number;
  website?: string;
  twitter?: string;
  raw_risks?: string;
}

interface Config {
  chat_id: string;
  telegram_group_id: string;
  alerts_enabled: string;
  scanning_active: string;
  scanned_chains: string;
  min_boost: string;
  min_nana_score: string;
  min_liquidity: string;
  risk_mode: string;
  risk_tolerance: string;
  profit_target: string;
  ai_provider: string;
  ai_switch_mode: string;
}

interface User {
  id: string;
  email: string;
  created_at: string;
}

// --- Components ---

const Card: React.FC<{ children?: React.ReactNode, className?: string, title?: React.ReactNode, icon?: any }> = ({ children, className, title, icon: Icon }) => (
  <div className={cn("bg-[#151619] border border-white/5 rounded-xl overflow-hidden shadow-2xl", className)}>
    {title && (
      <div className="px-4 py-3 border-b border-white/5 flex items-center justify-between bg-white/2">
        <div className="flex items-center gap-2">
          {Icon && <Icon className="w-4 h-4 text-emerald-400" />}
          <span className="text-xs font-mono uppercase tracking-wider text-white/60">{title}</span>
        </div>
      </div>
    )}
    <div className="p-4">{children}</div>
  </div>
);

const Badge = ({ children, variant = 'default' }: { children: React.ReactNode, variant?: 'default' | 'success' | 'danger' | 'warning' | 'info' }) => {
  const variants = {
    default: 'bg-white/10 text-white/70',
    success: 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20',
    danger: 'bg-rose-500/10 text-rose-400 border border-rose-500/20',
    warning: 'bg-amber-500/10 text-amber-400 border border-amber-500/20',
    info: 'bg-indigo-500/10 text-indigo-400 border border-indigo-500/20',
  };
  return (
    <span className={cn("px-2 py-0.5 rounded text-[10px] font-mono uppercase tracking-tight", variants[variant])}>
      {children}
    </span>
  );
};

// --- Helpers ---
function formatCurrency(value: number): string {
  if (value >= 1000000) {
    return `${(value / 1000000).toFixed(1).replace(/\.0$/, '')}m$`;
  }
  if (value >= 1000) {
    return `${(value / 1000).toFixed(1).replace(/\.0$/, '')}k$`;
  }
  return `${(value || 0).toFixed(2)}$`;
}

export default function App() {
  const [tokens, setTokens] = useState<Token[]>([]);
  const [historyTokens, setHistoryTokens] = useState<Token[]>([]);
  const [rugs, setRugs] = useState<any[]>([]);
  const [neuralWeights, setNeuralWeights] = useState<any[]>([]);
  const [insights, setInsights] = useState<any[]>([]);
  const [config, setConfig] = useState<Config | null>(null);
  const [stats, setStats] = useState({ totalCalls: 0, avgScore: 0, avgSentiment: 0, explosive: 0, winRate: 0, rugPrevention: 0 });
  const [historyStats, setHistoryStats] = useState({ totalCalls: 0, avgScore: 0, avgSentiment: 0, explosive: 0, winRate: 0, rugPrevention: 0 });
  const [performanceTokens, setPerformanceTokens] = useState<Token[]>([]);
  const [activeTab, setActiveTab] = useState<'live' | 'performance' | 'simulation' | 'social' | 'history' | 'config'>('live');
  const [hasAiKey, setHasAiKey] = useState(false);
  const [analyzingIds, setAnalyzingIds] = useState<Set<string>>(new Set());
  const [aiThrottledUntil, setAiThrottledUntil] = useState<number>(0);
  const [aiQuotaExhausted, setAiQuotaExhausted] = useState(false);
  const [isSavingConfig, setIsSavingConfig] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  // --- AI Analysis Logic (Frontend Only) ---
  const getAI = () => {
    // Use platform-provided GEMINI_API_KEY or API_KEY (from selection dialog)
    let apiKey = '';
    try {
      // @ts-ignore
      apiKey = (typeof process !== 'undefined' && process.env?.GEMINI_API_KEY) || 
               // @ts-ignore
               (typeof process !== 'undefined' && process.env?.API_KEY) ||
               (window as any).GEMINI_API_KEY || 
               (window as any).API_KEY;
    } catch (e) {
      console.warn("Error accessing process.env:", e);
    }

    if (!apiKey) return null;

    try {
      return new GoogleGenAI({ apiKey });
    } catch (e) {
      console.error("AI Engine Init Error:", e);
      return null;
    }
  };

  const callAI = async (prompt: string, options: { useSearch?: boolean, useUrl?: boolean } = {}) => {
    const provider = config?.ai_provider || 'gemini';
    const switchMode = config?.ai_switch_mode || 'auto';

    const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

    const tryGemini = async (retries = 3) => {
      const ai = getAI();
      if (!ai) throw new Error("Gemini not initialized (API Key missing)");
      
      // If we are throttled, we still throw but the caller will catch and try DeepSeek
      if (Date.now() < aiThrottledUntil) {
        throw new Error("AI_THROTTLED");
      }
      
      for (let i = 0; i <= retries; i++) {
        try {
          const response = await ai.models.generateContent({
            model: options.useSearch || options.useUrl ? "gemini-3.1-pro-preview" : "gemini-3-flash-preview", 
            contents: { parts: [{ text: prompt }] },
            config: { 
              responseMimeType: "application/json",
              tools: [
                ...(options.useSearch ? [{ googleSearch: {} }] : []),
                ...(options.useUrl ? [{ urlContext: {} }] : [])
              ]
            }
          });
          setAiQuotaExhausted(false);
          return response.text;
        } catch (e: any) {
          const errorText = JSON.stringify(e);
          const isRateLimit = errorText.includes("429") || 
                             errorText.includes("RESOURCE_EXHAUSTED") || 
                             e.status === 429 || 
                             e.message?.includes("429") ||
                             e.message?.includes("quota");
          
          const isNetworkError = errorText.includes("Rpc failed") || 
                                errorText.includes("xhr error") || 
                                errorText.includes("error code: 6") ||
                                e.message?.includes("Failed to fetch");

          if (isRateLimit) {
            if (i < retries) {
              const backoff = Math.pow(2, i) * 2000; 
              console.warn(`Gemini Rate Limited (429). Retrying in ${backoff}ms... (Attempt ${i + 1}/${retries})`);
              await sleep(backoff);
              continue;
            } else {
              // Silent log if we have fallback, otherwise warn
              if (switchMode === 'auto') {
                console.info("Gemini Quota Exhausted, falling back to DeepSeek.");
              } else {
                console.warn("Gemini Quota Exhausted. No fallback available.");
              }
              setAiQuotaExhausted(true);
              setAiThrottledUntil(Date.now() + 2 * 60 * 1000); // 2 minute cooldown
              throw new Error("QUOTA_EXHAUSTED");
            }
          }

          if (isNetworkError) {
            if (i < retries) {
              console.warn(`Gemini Network Error (RPC/XHR). Retrying in 2s... (Attempt ${i + 1}/${retries})`);
              await sleep(2000);
              continue;
            } else {
              console.error("Gemini Persistent Network Error:", e);
              throw new Error("GEMINI_NETWORK_FAILURE");
            }
          }
          
          console.error("Gemini API Call Error:", e);
          throw e;
        }
      }
    };

    const tryDeepSeek = async (retries = 3) => {
      for (let i = 0; i <= retries; i++) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 50000); // 50s timeout

        try {
          const response = await fetch("/api/ai/deepseek", {
            method: "POST",
            headers: {
              "Content-Type": "application/json"
            },
            body: JSON.stringify({ prompt }),
            signal: controller.signal
          });
          
          clearTimeout(timeoutId);
          
          if (!response.ok) {
            const text = await response.text();
            let errMessage = response.statusText;
            try {
              if (text.trim().startsWith('{')) {
                const errData = JSON.parse(text);
                errMessage = errData.error || errData.message || errMessage;
              }
            } catch (parseErr) {}
            
            // If it's a 504 (Gateway Timeout) or 503 (Service Unavailable), retry
            if ((response.status === 504 || response.status === 503) && i < retries) {
              console.warn(`DeepSeek Server Busy (${response.status}). Retrying...`);
              await sleep(2000 * (i + 1));
              continue;
            }
            
            throw new Error(`DeepSeek Server Error (${response.status}): ${errMessage}`);
          }
          
          const contentType = response.headers.get('content-type');
          if (contentType && contentType.includes('application/json')) {
            const data = await response.json();
            return data.content;
          } else {
            const text = await response.text();
            throw new Error(`DeepSeek returned non-JSON response: ${text.slice(0, 100)}...`);
          }
        } catch (e: any) {
          clearTimeout(timeoutId);
          
          if (e.name === 'AbortError') {
            console.error(`DeepSeek Request Timed Out (Attempt ${i + 1}/${retries + 1})`);
            if (i < retries) {
              await sleep(1000);
              continue;
            }
            throw new Error("DeepSeek Connection Timeout: The server took too long to respond.");
          }

          console.error(`DeepSeek API Call Error (Attempt ${i + 1}/${retries + 1}):`, e);
          
          if (i < retries) {
            const backoff = 1000 * (i + 1);
            console.warn(`DeepSeek Request Failed. Retrying in ${backoff}ms...`);
            await sleep(backoff);
            continue;
          }
          
          if (e.message?.includes("fetch") || e.name === 'TypeError') {
            throw new Error(`DeepSeek Connection Error: The server is unreachable or the request was blocked. Please check if the backend is running.`);
          }
          throw e;
        }
      }
    };

    const cleanJsonResponse = (text: string) => {
      try {
        // Remove markdown code blocks if present
        const cleaned = text.replace(/```json\n?|```/g, "").trim();
        return cleaned;
      } catch (e) {
        return text;
      }
    };

    if (provider === 'gemini') {
      const isGeminiThrottled = Date.now() < aiThrottledUntil;
      if (isGeminiThrottled && switchMode === 'auto') {
        console.warn("Gemini is throttled, using DeepSeek fallback immediately");
        try {
          const res = await tryDeepSeek();
          return cleanJsonResponse(res || "");
        } catch (e) {
          throw e;
        }
      }
      
      try {
        const res = await tryGemini();
        return cleanJsonResponse(res || "");
      } catch (e: any) {
        if (switchMode === 'auto') {
          console.warn(`Gemini failed (${e.message}), switching to DeepSeek fallback`);
          const res = await tryDeepSeek();
          return cleanJsonResponse(res || "");
        }
        throw e;
      }
    } else {
      try {
        const res = await tryDeepSeek();
        return cleanJsonResponse(res || "");
      } catch (e) {
        if (switchMode === 'auto') {
          console.warn("DeepSeek failed, switching to Gemini fallback");
          const res = await tryGemini();
          return cleanJsonResponse(res || "");
        }
        throw e;
      }
    }
  };

  const checkAiKeyStatus = async () => {
    const provider = config?.ai_provider || 'gemini';
    const switchMode = config?.ai_switch_mode || 'auto';
    
    if (provider === 'deepseek' || switchMode === 'auto') {
      // DeepSeek is always "connected" via server-side proxy
      setHasAiKey(true);
      return;
    }

    // First check if we have a hardcoded or env key
    if (getAI() !== null) {
      setHasAiKey(true);
      return;
    }

    // @ts-ignore
    if (window.aistudio?.hasSelectedApiKey) {
      try {
        // @ts-ignore
        const hasKey = await window.aistudio.hasSelectedApiKey();
        setHasAiKey(hasKey);
      } catch (e) {
        setHasAiKey(getAI() !== null);
      }
    } else {
      setHasAiKey(getAI() !== null);
    }
  };

  const neuralRugAnalysis = async (address: string, risks: any[], score: number) => {
    try {
      const riskSummary = risks.map(r => `${r.name}: ${r.description} (Level: ${r.level})`).join("\n");
      const prompt = `
        You are a high-level on-chain security analyst. 
        Analyze the following risk report for a new token on Solana.
        Token Address: ${address}
        RugCheck Base Score: ${score}
        Risks Detected:
        ${riskSummary || "No specific risks detected by base scanner."}

        Provide a final "Neural Security Score" (0-100, where 100 is extremely dangerous) and a short verdict.
        Return JSON: { "neuralScore": number, "verdict": "string", "riskLevel": "LOW|MEDIUM|HIGH|CRITICAL" }
      `;

      const text = await callAI(prompt, { useSearch: true });
      return JSON.parse(text || "{}");
    } catch (e: any) {
      console.error("Neural Rug Analysis Error:", e);
      return null;
    }
  };

  const analyzeSocials = async (symbol: string, website: string, twitter: string) => {
    try {
      const prompt = `
        Perform a deep social intelligence analysis for the crypto project: ${symbol}.
        
        Website: ${website || "N/A"}
        Twitter: ${twitter || "N/A"}
        
        Use the provided URLs and Google Search to evaluate:
        1. Community Sentiment: Is the community organic or bot-driven?
        2. Developer Transparency: Are the developers active and communicative?
        3. Hype vs. Substance: Is there actual development or just marketing hype?
        4. Recent News: Any recent partnerships, launches, or red flags?
        
        Return a JSON object with:
        - legitimacyScore (0-100)
        - hypeRiskScore (0-100)
        - sentimentScore (0-100)
        - devActivityScore (0-100)
        - verdict (A concise 1-sentence summary of the social health)
      `;

      const text = await callAI(prompt, { useSearch: true, useUrl: true });
      return JSON.parse(text || "{}");
    } catch (e: any) {
      console.error("Social Analysis Error:", e);
      return null;
    }
  };

  const processTokenAnalysis = async (token: Token) => {
    if (analyzingIds.has(token.id)) return;
    setAnalyzingIds(prev => new Set(prev).add(token.id));

    try {
      const risks = token.raw_risks ? JSON.parse(token.raw_risks) : [];
      
      let neural = null;
      let social = null;
      let errorOccurred = false;

      try {
        neural = await neuralRugAnalysis(token.address, risks, token.rug_risk_score * 10);
      } catch (e) {
        console.error("Neural analysis failed:", e);
        errorOccurred = true;
      }

      try {
        social = await analyzeSocials(token.symbol, token.website || "", token.twitter || "");
      } catch (e) {
        console.error("Social analysis failed:", e);
        errorOccurred = true;
      }

      if (neural || social || errorOccurred) {
        const payload = {
          id: token.id,
          ai_rug_verdict: neural?.verdict || (errorOccurred ? "Analysis Throttled" : token.ai_rug_verdict),
          ai_rug_risk_level: neural?.riskLevel || (errorOccurred ? "UNKNOWN" : token.ai_rug_risk_level),
          ai_social_verdict: social?.verdict || (errorOccurred ? "Social Data Unavailable" : token.ai_social_verdict),
          sentiment_score: social?.sentimentScore || token.sentiment_score,
          dev_activity_score: social?.devActivityScore || token.dev_activity_score,
          nana_score: token.nana_score
        };

        await fetch('/api/tokens/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
      }
    } catch (e) {
      console.error(`Analysis failed for ${token.symbol}:`, e);
    } finally {
      setAnalyzingIds(prev => {
        const next = new Set(prev);
        next.delete(token.id);
        return next;
      });
    }
  };

  useEffect(() => {
    const processAllPending = async () => {
      const switchMode = config?.ai_switch_mode || 'auto';
      // Only block if Gemini is throttled AND we can't switch to DeepSeek
      if (Date.now() < aiThrottledUntil && switchMode !== 'auto') return;
      
      const pending = tokens.filter(t => t.ai_rug_verdict === 'Pending Neural Analysis' || t.ai_rug_verdict === 'PENDING');
      if (pending.length > 0 && hasAiKey) {
        // Process in small batches to avoid "Failed to fetch" or rate limits
        const batchSize = 1; // Reduced to 1 for maximum safety
        for (let i = 0; i < pending.length; i += batchSize) {
          // Re-check throttle in loop
          if (Date.now() < aiThrottledUntil && switchMode !== 'auto') break;
          
          const batch = pending.slice(i, i + batchSize);
          await Promise.all(batch.map(t => processTokenAnalysis(t)));
          
          // Add a longer delay between batches to respect rate limits
          if (i + batchSize < pending.length) {
            await new Promise(resolve => setTimeout(resolve, 10000)); // 10s delay
          }
        }
      }
    };
    
    processAllPending();
  }, [tokens, hasAiKey, aiThrottledUntil, config?.ai_switch_mode]);

  useEffect(() => {
    const processPendingInsights = async () => {
      const switchMode = config?.ai_switch_mode || 'auto';
      if (Date.now() < aiThrottledUntil && switchMode !== 'auto') return;
      
      const pending = insights.filter(i => i.pattern_type === 'pending_ai');
      if (pending.length > 0 && hasAiKey) {
        for (const item of pending) {
          if (Date.now() < aiThrottledUntil && switchMode !== 'auto') break;
          
          try {
            const prompt = `As a crypto trading neural engine, analyze this success pattern and provide a one-sentence technical insight for future scans: "${item.insight}"`;
            const aiResponse = await callAI(prompt);
            if (aiResponse) {
              await fetch('/api/insights/update', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id: item.id, insight: aiResponse })
              });
            }
            // Add delay between insight processing
            await new Promise(resolve => setTimeout(resolve, 5000));
          } catch (e) {
            console.error("Failed to process pending insight:", e);
          }
        }
      }
    };
    processPendingInsights();
  }, [insights, hasAiKey, aiThrottledUntil, config?.ai_switch_mode]);

  const [simulationTrades, setSimulationTrades] = useState<any[]>([]);
  const [simulationStats, setSimulationStats] = useState<any>({ balances: [], totalProfit: 0 });
  const [portfolio, setPortfolio] = useState<any[]>([]);
  const [portfolioValue, setPortfolioValue] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<User | null>(null);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authMode, setAuthMode] = useState<'login' | 'signup'>('login');
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authError, setAuthError] = useState('');

  const [historyChainFilter, setHistoryChainFilter] = useState<string>('all');
  const [historyWinFilter, setHistoryWinFilter] = useState<'all' | 'winners' | 'losers'>('all');
  const [historyDateFilter, setHistoryDateFilter] = useState<string>('');

  const [lastScanTime, setLastScanTime] = useState<string>('Never');

  useEffect(() => {
    if (config) {
      checkAiKeyStatus();
    }
  }, [config?.ai_provider, config?.ai_switch_mode]);

  const fetchData = async () => {
    try {
      await checkAiKeyStatus();
      
      // First check health to see if server is up
      const healthRes = await fetch('/api/health').catch(() => null);
      if (healthRes && healthRes.ok) {
        const contentType = healthRes.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
          const healthData = await healthRes.json();
          if (healthData.lastScan) {
            setLastScanTime(new Date(healthData.lastScan).toLocaleTimeString());
          }
        }
      } else {
        console.warn("Server health check failed, retrying...");
        return;
      }

      const configUrl = user ? `/api/config?userId=${user.id}` : '/api/config';
      const userQueryOnly = user ? `?userId=${user.id}` : '';
      
      const results = await Promise.all([
        fetch(`/api/tokens${userQueryOnly}`),
        fetch(configUrl),
        fetch('/api/stats'),
        fetch('/api/stats?scope=history'),
        fetch('/api/rugs'),
        fetch('/api/insights'),
        fetch(`/api/simulation/trades${userQueryOnly}`),
        fetch(`/api/simulation/stats${userQueryOnly}`),
        fetch(`/api/simulation/portfolio${userQueryOnly}`),
        fetch('/api/neural/weights'),
        fetch(`/api/tokens/history?since=${new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()}`), // For performance (24h)
        fetch(`/api/tokens/history?chain=${historyChainFilter}&winLoss=${historyWinFilter}&date=${historyDateFilter}`)
      ]);

      const safeJson = async (res: Response) => {
        if (!res.ok) return null;
        const contentType = res.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
          return res.json();
        }
        return null;
      };

      const [tokensData, configData, statsData, historyStatsData, rugsData, insightsData, simTradesData, simStatsData, portfolioData, weightsData, performanceData, historyData] = await Promise.all(
        results.map(res => safeJson(res))
      );

      if (tokensData) setTokens(Array.isArray(tokensData) ? tokensData : []);
      if (configData) setConfig(configData);
      if (statsData) setStats(statsData);
      if (historyStatsData) setHistoryStats(historyStatsData);
      if (rugsData) setRugs(Array.isArray(rugsData) ? rugsData : []);
      if (insightsData) setInsights(Array.isArray(insightsData) ? insightsData : []);
      if (simTradesData) setSimulationTrades(Array.isArray(simTradesData) ? simTradesData : []);
      if (simStatsData) setSimulationStats(simStatsData);
      if (portfolioData) {
        setPortfolio(Array.isArray(portfolioData.portfolio) ? portfolioData.portfolio : []);
        setPortfolioValue(portfolioData.totalValue || 0);
      }
      if (weightsData) setNeuralWeights(Array.isArray(weightsData) ? weightsData : []);
      if (performanceData) setPerformanceTokens(Array.isArray(performanceData) ? performanceData : []);
      if (historyData && Array.isArray(historyData)) {
        setHistoryTokens(historyData);
        console.log(`[History] Loaded ${historyData.length} tokens.`);
      }

      // Check AI status from test endpoint
      const testRes = await fetch('/api/test');
      const testData = await safeJson(testRes);
      // Removed incorrect override of hasAiKey from testData.ai
    } catch (e: any) {
      if (e.name === 'TypeError' && e.message === 'Failed to fetch') {
        // Silent fail for network issues to avoid console spam during startup
      } else {
        console.error("Fetch error:", e);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 10000);
    return () => clearInterval(interval);
  }, [user, historyChainFilter, historyWinFilter, historyDateFilter]);

  const updateConfig = async (key: string, value: string) => {
    // Optimistic update
    if (config) {
      setConfig({ ...config, [key]: value });
    }
    
    try {
      const res = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, value, userId: user?.id })
      });
      if (res.ok) {
        fetchData();
      }
    } catch (e) {
      console.error("Update config error:", e);
    }
  };

  const saveAllConfig = async () => {
    setIsSavingConfig(true);
    try {
      // Since updateConfig already updates the backend for each field,
      // this button is more for user peace of mind and final confirmation.
      // We'll trigger a manual scan to "obey" the command immediately.
      await fetch('/api/scan', { method: 'POST' });
      
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (e) {
      console.error("Save config error:", e);
    } finally {
      setIsSavingConfig(false);
    }
  };

  const toggleScanning = async () => {
    try {
      const url = user ? `/api/toggle-scanning?userId=${user.id}` : '/api/toggle-scanning';
      const res = await fetch(url, { method: 'POST' });
      if (res.ok && res.headers.get('content-type')?.includes('application/json')) {
        const data = await res.json();
        if (data.success) {
          fetchData();
        }
      }
    } catch (e) {
      console.error("Toggle scanning error:", e);
    }
  };

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    const endpoint = authMode === 'login' ? '/api/login' : '/api/signup';
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: authEmail, password: authPassword })
      });
      
      if (res.ok) {
        const contentType = res.headers.get('content-type');
        if (contentType && contentType.includes('application/json')) {
          const data = await res.json();
          if (data.success) {
            setUser(data.user);
            setShowAuthModal(false);
            localStorage.setItem('degenics_user', JSON.stringify(data.user));
            // Reset to live tab on login to refresh data with user's created_at
            setActiveTab('live');
            fetchData();
          } else {
            setAuthError(data.error);
          }
        } else {
          setAuthError('Server returned invalid response format');
        }
      } else {
        setAuthError('Server error or invalid response');
      }
    } catch (e) {
      setAuthError('Connection failed');
    }
  };

  const handleManualBuy = async (address: string, chain: string, amount_usd: number, reason: string) => {
    try {
      const res = await fetch('/api/simulation/manual-buy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address, chain, amount_usd, reason, userId: user?.id })
      });
      const data = await res.json();
      if (data.success) {
        fetchData();
      } else {
        alert(data.error || "Manual buy failed");
      }
    } catch (e) {
      console.error("Manual buy error:", e);
    }
  };

  const handleManualSell = async (address: string, chain: string, percent: number, reason: string) => {
    try {
      const res = await fetch('/api/simulation/manual-sell', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address, chain, percent, reason, userId: user?.id })
      });
      const data = await res.json();
      if (data.success) {
        fetchData();
      } else {
        alert(data.error || "Manual sell failed");
      }
    } catch (e) {
      console.error("Manual sell error:", e);
    }
  };

  const handleOpenKeySelector = async () => {
    // @ts-ignore
    if (window.aistudio) {
      // @ts-ignore
      await window.aistudio.openSelectKey();
      setHasAiKey(true);
      fetchData();
    } else {
      alert("AI Key selector is only available in the AI Studio environment.");
    }
  };

  useEffect(() => {
    const savedUser = localStorage.getItem('degenics_user');
    if (savedUser) {
      try {
        setUser(JSON.parse(savedUser));
      } catch (e) {
        console.error("Failed to parse saved user:", e);
        localStorage.removeItem('degenics_user');
      }
    }
  }, []);

  return (
    <div className="min-h-screen bg-[#0a0a0c] text-white font-sans selection:bg-emerald-500/30">
      {/* Header */}
      <header className="border-b border-white/5 bg-[#0a0a0c]/80 backdrop-blur-xl sticky top-0 z-50">
        <div className="max-w-[1600px] mx-auto px-4 md:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2 md:gap-3">
            <div className="w-8 h-8 md:w-10 md:h-10 bg-emerald-500 rounded-lg flex items-center justify-center shadow-[0_0_20px_rgba(16,185,129,0.3)]">
              <Shield className="w-5 h-5 md:w-6 md:h-6 text-black" />
            </div>
            <div>
              <h1 className="text-sm md:text-lg font-bold tracking-tighter uppercase italic">Degenics Angel</h1>
              <div className="flex items-center gap-2">
                <span className="w-1 h-1 md:w-1.5 md:h-1.5 bg-emerald-500 rounded-full animate-pulse" />
                <span className="text-[8px] md:text-[10px] font-mono text-white/40 uppercase tracking-widest">On-Chain Intelligence v2.1</span>
              </div>
            </div>
          </div>

          <nav className="hidden xl:flex items-center gap-1 bg-white/5 p-1 rounded-lg">
            {(['live', 'performance', 'simulation', 'social', 'history', 'config'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => {
                  if (tab !== 'live' && !user) {
                    setAuthMode('login');
                    setShowAuthModal(true);
                    return;
                  }
                  setActiveTab(tab);
                }}
                className={cn(
                  "px-4 py-1.5 rounded-md text-xs font-mono uppercase tracking-wider transition-all",
                  activeTab === tab ? "bg-emerald-500 text-black font-bold" : "text-white/40 hover:text-white/80",
                  tab !== 'live' && !user && "opacity-50"
                )}
              >
                {tab === 'live' ? tab : (
                  <div className="flex items-center gap-1.5">
                    {tab}
                    {!user && <Lock className="w-3 h-3" />}
                  </div>
                )}
              </button>
            ))}
          </nav>

            <div className="flex items-center gap-2 md:gap-4">
              <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 bg-white/2 rounded-lg border border-white/5">
                <div className={cn(
                  "w-1.5 h-1.5 rounded-full animate-pulse",
                  config?.scanning_active === 'true' ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" : "bg-red-500"
                )} />
                <span className="text-[10px] font-mono uppercase text-white/40">
                  {lastScanTime}
                </span>
              </div>
              <button 
                onClick={toggleScanning}
              className={cn(
                "px-2 md:px-3 py-1.5 rounded-lg text-[10px] font-mono uppercase font-bold transition-all flex items-center gap-2",
                config?.scanning_active === 'true' 
                  ? "bg-rose-500/10 text-rose-400 border border-rose-500/20 hover:bg-rose-500/20" 
                  : "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20"
              )}
            >
              {config?.scanning_active === 'true' ? (
                <><XCircle className="w-3 h-3" /><span className="hidden sm:inline">Pause Bot</span></>
              ) : (
                <><Activity className="w-3 h-3" /><span className="hidden sm:inline">Start Bot</span></>
              )}
            </button>

            {user ? (
              <div className="hidden sm:flex items-center gap-2 bg-white/5 px-3 py-1.5 rounded-lg border border-white/10">
                <div className="w-2 h-2 bg-emerald-500 rounded-full" />
                <span className="text-[10px] font-mono text-white/60 uppercase">{user.email.split('@')[0]}</span>
                <button 
                  onClick={() => { setUser(null); localStorage.removeItem('degenics_user'); }}
                  className="text-[10px] font-mono text-white/20 hover:text-rose-400 ml-2"
                >
                  Logout
                </button>
              </div>
            ) : (
              <button 
                onClick={() => { setAuthMode('login'); setShowAuthModal(true); }}
                className="px-3 md:px-4 py-1.5 bg-white text-black rounded-lg text-xs font-bold hover:bg-white/90 transition-all"
              >
                Sign In
              </button>
            )}

            <button onClick={fetchData} className="p-2 hover:bg-white/5 rounded-lg transition-colors hidden sm:block">
              <RefreshCw className="w-4 h-4 text-white/40" />
            </button>
            
            <button 
              onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
              className="xl:hidden p-2 hover:bg-white/5 rounded-lg transition-colors"
            >
              {isMobileMenuOpen ? <X className="w-5 h-5 text-white" /> : <Menu className="w-5 h-5 text-white" />}
            </button>
          </div>
        </div>

        {/* Mobile Menu */}
        <AnimatePresence>
          {isMobileMenuOpen && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="xl:hidden border-t border-white/5 bg-[#0a0a0c] overflow-hidden"
            >
              <div className="p-4 space-y-2">
                {(['live', 'performance', 'simulation', 'social', 'history', 'config'] as const).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => {
                      if (tab !== 'live' && !user) {
                        setAuthMode('login');
                        setShowAuthModal(true);
                        setIsMobileMenuOpen(false);
                        return;
                      }
                      setActiveTab(tab);
                      setIsMobileMenuOpen(false);
                    }}
                    className={cn(
                      "w-full px-4 py-3 rounded-xl text-sm font-mono uppercase tracking-wider transition-all flex items-center justify-between",
                      activeTab === tab ? "bg-emerald-500 text-black font-bold" : "bg-white/5 text-white/60 hover:text-white/80",
                      tab !== 'live' && !user && "opacity-50"
                    )}
                  >
                    {tab}
                    {tab !== 'live' && !user && <Lock className="w-4 h-4" />}
                  </button>
                ))}
                
                {user && (
                  <button 
                    onClick={() => { setUser(null); localStorage.removeItem('degenics_user'); setIsMobileMenuOpen(false); }}
                    className="w-full px-4 py-3 rounded-xl text-sm font-mono uppercase tracking-wider bg-rose-500/10 text-rose-400 border border-rose-500/20 mt-4"
                  >
                    Logout
                  </button>
                )}
                
                <div className="pt-4 border-t border-white/5 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className={cn(
                      "w-1.5 h-1.5 rounded-full animate-pulse",
                      config?.scanning_active === 'true' ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" : "bg-red-500"
                    )} />
                    <span className="text-[10px] font-mono uppercase text-white/40">
                      Heartbeat: {lastScanTime}
                    </span>
                  </div>
                  <button onClick={fetchData} className="p-2 bg-white/5 rounded-lg">
                    <RefreshCw className="w-4 h-4 text-white/40" />
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </header>

      <main className="max-w-[1600px] mx-auto px-4 md:px-6 py-6 md:py-8">
        {aiQuotaExhausted && (
          <div className="mb-8 p-4 bg-rose-500/10 border border-rose-500/20 rounded-xl flex items-center justify-between animate-pulse">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-rose-500/20 rounded-lg flex items-center justify-center">
                <AlertTriangle className="w-5 h-5 text-rose-500" />
              </div>
              <div>
                <h4 className="font-bold text-rose-500 uppercase tracking-tighter">Neural Engine Throttled</h4>
                <p className="text-xs text-rose-500/60">
                  {config?.ai_switch_mode === 'auto' 
                    ? "Gemini quota exhausted. Neural Engine has automatically switched to DeepSeek fallback." 
                    : "AI analysis is temporarily paused due to Gemini rate limits. It will resume automatically in a few minutes."}
                </p>
                <p className="text-[10px] text-rose-500/40 mt-1 italic">
                  Note: DeepSeek fallback may be slower during high traffic.
                </p>
              </div>
            </div>
            <div className="flex flex-col items-end gap-2">
              <div className="text-[10px] font-mono text-rose-500/40 uppercase">
                Cooldown: {Math.max(0, Math.ceil((aiThrottledUntil - Date.now()) / 1000))}s
              </div>
              <button 
                onClick={() => {
                  setAiThrottledUntil(0);
                  setAiQuotaExhausted(false);
                  fetchData();
                }}
                className="px-3 py-1 bg-rose-500/20 hover:bg-rose-500/30 border border-rose-500/30 rounded text-[10px] font-mono text-rose-500 uppercase transition-colors"
              >
                Force Retry
              </button>
            </div>
          </div>
        )}

        {!hasAiKey && !aiQuotaExhausted && (
          <div className="mb-8 p-4 bg-amber-500/10 border border-amber-500/20 rounded-xl flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-amber-500/20 rounded-lg flex items-center justify-center">
                <Cpu className="w-5 h-5 text-amber-500" />
              </div>
              <div>
                <h4 className="font-bold text-amber-500">Neural Engine Disabled</h4>
                <p className="text-xs text-amber-500/60">Connect your Gemini API key to enable AI-powered rug detection and social analysis.</p>
              </div>
            </div>
            <button 
              onClick={handleOpenKeySelector}
              className="px-4 py-2 bg-amber-500 text-black font-bold rounded-lg text-xs uppercase hover:bg-amber-400 transition-colors"
            >
              Connect AI
            </button>
          </div>
        )}

        {activeTab === 'simulation' && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6">
              <Card className="bg-gradient-to-br from-emerald-500/5 to-transparent relative group">
                <p className="text-[10px] font-mono text-white/40 uppercase mb-1">Total Simulation Profit</p>
                <h3 className={cn(
                  "text-2xl md:text-3xl font-bold tracking-tighter",
                  (simulationStats?.totalProfit || 0) >= 0 ? "text-emerald-400" : "text-red-400"
                )}>
                  {(simulationStats?.totalProfit || 0) >= 0 ? '+' : ''}${(simulationStats?.totalProfit || 0).toFixed(2)}
                </h3>
                <button 
                  onClick={async () => {
                    if (confirm('Reset all simulation balances to $100?')) {
                      const res = await fetch('/api/simulation/reset-balances', { 
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ userId: user?.id })
                      });
                      if (res.ok) fetchData();
                    }
                  }}
                  className="absolute top-2 right-2 p-1 bg-red-500/20 hover:bg-red-500/40 rounded text-[8px] font-mono text-red-400 uppercase transition-all"
                >
                  Reset
                </button>
              </Card>
              <Card className="bg-gradient-to-br from-indigo-500/5 to-transparent">
                <p className="text-[10px] font-mono text-white/40 uppercase mb-1">Portfolio Value</p>
                <h3 className="text-2xl md:text-3xl font-bold tracking-tighter text-indigo-400">
                  ${(portfolioValue || 0).toFixed(2)}
                </h3>
              </Card>
              {(simulationStats?.balances || []).map((b: any, i: number) => (
                <Card key={b.chain || i}>
                  <p className="text-[10px] font-mono text-white/40 uppercase mb-1">{b.chain || 'Unknown'} Balance</p>
                  <h3 className="text-xl font-bold tracking-tighter">${(b.balance || 0).toFixed(2)}</h3>
                  <p className="text-[8px] font-mono text-white/20 uppercase mt-1">Persistent Simulation Balance</p>
                </Card>
              ))}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2 space-y-6">
                <Card title="Current Portfolio" icon={Wallet}>
                  <div className="overflow-x-auto -mx-4 px-4">
                    <table className="w-full text-left border-collapse min-w-[600px]">
                      <thead>
                        <tr className="border-b border-white/5">
                          <th className="py-3 px-4 text-[10px] font-mono text-white/30 uppercase">Token</th>
                          <th className="py-3 px-4 text-[10px] font-mono text-white/30 uppercase">Quantity</th>
                          <th className="py-3 px-4 text-[10px] font-mono text-white/30 uppercase">Avg Price</th>
                          <th className="py-3 px-4 text-[10px] font-mono text-white/30 uppercase">Current Price</th>
                          <th className="py-3 px-4 text-[10px] font-mono text-white/30 uppercase">Value</th>
                          <th className="py-3 px-4 text-[10px] font-mono text-white/30 uppercase">ROI</th>
                          <th className="py-3 px-4 text-[10px] font-mono text-white/30 uppercase">Action</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/5">
                        {portfolio.length === 0 && (
                          <tr>
                            <td colSpan={7} className="py-8 text-center text-white/20 font-mono text-xs uppercase italic">
                              No active holdings
                            </td>
                          </tr>
                        )}
                        {(portfolio || []).map((item: any, i: number) => {
                          const roi = item.avg_buy_price ? ((item.current_price - item.avg_buy_price) / item.avg_buy_price) * 100 : 0;
                          return (
                            <tr key={item.address || i} className="hover:bg-white/2 transition-colors">
                              <td className="py-3 px-4">
                                <div className="flex flex-col">
                                  <span className="font-bold text-sm">{item.symbol || '?'}</span>
                                  <span className="text-[8px] font-mono text-white/20 uppercase">{item.chain || 'unknown'}</span>
                                </div>
                              </td>
                              <td className="py-3 px-4 text-xs font-mono">{(item.quantity || 0).toLocaleString()}</td>
                              <td className="py-3 px-4 text-xs font-mono">${(item.avg_buy_price || 0).toFixed(8)}</td>
                              <td className="py-3 px-4 text-xs font-mono">${(item.current_price || 0).toFixed(8)}</td>
                              <td className="py-3 px-4 text-xs font-mono font-bold">${(item.total_value || 0).toFixed(2)}</td>
                              <td className="py-3 px-4">
                                <span className={cn("text-xs font-mono font-bold", roi >= 0 ? "text-emerald-400" : "text-rose-400")}>
                                  {roi >= 0 ? '+' : ''}{(roi || 0).toFixed(2)}%
                                </span>
                              </td>
                              <td className="py-3 px-4">
                                <button
                                  onClick={() => {
                                    const reason = prompt("Reason for selling?");
                                    if (reason) handleManualSell(item.address, item.chain, 100, reason);
                                  }}
                                  className="px-2 py-1 bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/20 rounded text-[10px] font-mono text-rose-400 uppercase transition-colors"
                                >
                                  Sell All
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </Card>

                <Card title="Simulation Trade History" icon={TrendingUp}>
                  <div className="overflow-x-auto -mx-4 px-4">
                    <table className="w-full text-left border-collapse min-w-[700px]">
                      <thead>
                        <tr className="border-b border-white/5">
                          <th className="py-3 px-4 text-[10px] font-mono text-white/30 uppercase">Time</th>
                          <th className="py-3 px-4 text-[10px] font-mono text-white/30 uppercase">Token</th>
                          <th className="py-3 px-4 text-[10px] font-mono text-white/30 uppercase">Type</th>
                          <th className="py-3 px-4 text-[10px] font-mono text-white/30 uppercase">Amount</th>
                          <th className="py-3 px-4 text-[10px] font-mono text-white/30 uppercase">Price</th>
                          <th className="py-3 px-4 text-[10px] font-mono text-white/30 uppercase">Profit</th>
                          <th className="py-3 px-4 text-[10px] font-mono text-white/30 uppercase">Reason</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/5">
                        {(simulationTrades || []).map((trade: any, i: number) => (
                          <tr key={trade.id || i} className="hover:bg-white/2 transition-colors">
                            <td className="py-3 px-4 text-[10px] font-mono text-white/40">
                              {new Date(trade.timestamp || Date.now()).toLocaleTimeString()}
                            </td>
                            <td className="py-3 px-4">
                              <span className="font-bold text-sm">{trade.symbol || '?'}</span>
                              <span className="ml-2 text-[10px] font-mono text-white/20 uppercase">{trade.chain || 'unknown'}</span>
                            </td>
                            <td className="py-3 px-4">
                              <Badge variant={trade.type === 'buy' ? 'info' : trade.type === 'sell' ? 'success' : 'warning'}>
                                {trade.type || 'unknown'}
                              </Badge>
                            </td>
                            <td className="py-3 px-4 text-xs font-mono">${(trade.amount_usd || 0).toFixed(2)}</td>
                            <td className="py-3 px-4 text-xs font-mono">${(trade.price || 0).toFixed(8)}</td>
                            <td className="py-3 px-4">
                              {trade.type === 'sell' ? (
                                <span className={cn("text-xs font-mono font-bold", (trade.profit_usd || 0) >= 0 ? "text-emerald-400" : "text-rose-400")}>
                                  {(trade.profit_usd || 0) >= 0 ? '+' : ''}{(trade.profit_usd || 0).toFixed(2)}$
                                </span>
                              ) : '-'}
                            </td>
                            <td className="py-3 px-4 text-[10px] font-mono text-white/40 italic">{trade.reason || 'No reason'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Card>
              </div>

              <div className="space-y-6">
                <Card title="Manual Trading" icon={Zap}>
                  <div className="space-y-4">
                    <div className="p-4 bg-white/2 rounded-xl border border-white/5 space-y-4">
                      <h4 className="text-[10px] font-mono text-white/40 uppercase">Quick Buy</h4>
                      <div className="space-y-2">
                        <label className="text-[10px] font-mono text-white/40 uppercase">Token Address</label>
                        <input 
                          id="manual-buy-address"
                          type="text" 
                          placeholder="Address..."
                          className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-emerald-500"
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-2">
                          <label className="text-[10px] font-mono text-white/40 uppercase">Chain</label>
                          <select 
                            id="manual-buy-chain"
                            className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-emerald-500 uppercase"
                          >
                            <option value="solana">Solana</option>
                            <option value="ethereum">Ethereum</option>
                            <option value="base">Base</option>
                            <option value="bsc">BSC</option>
                          </select>
                        </div>
                        <div className="space-y-2">
                          <label className="text-[10px] font-mono text-white/40 uppercase">Amount (USD)</label>
                          <input 
                            id="manual-buy-amount"
                            type="number" 
                            defaultValue="10"
                            className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-emerald-500"
                          />
                        </div>
                      </div>
                      <div className="space-y-2">
                        <label className="text-[10px] font-mono text-white/40 uppercase">Reason</label>
                        <input 
                          id="manual-buy-reason"
                          type="text" 
                          placeholder="Why are you buying?"
                          className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-xs font-mono text-white focus:outline-none focus:border-emerald-500"
                        />
                      </div>
                      <button 
                        onClick={() => {
                          const addr = (document.getElementById('manual-buy-address') as HTMLInputElement).value;
                          const chain = (document.getElementById('manual-buy-chain') as HTMLSelectElement).value;
                          const amount = parseFloat((document.getElementById('manual-buy-amount') as HTMLInputElement).value);
                          const reason = (document.getElementById('manual-buy-reason') as HTMLInputElement).value;
                          if (addr && amount > 0) handleManualBuy(addr, chain, amount, reason || "Manual buy");
                        }}
                        className="w-full py-3 bg-emerald-500 text-black font-bold rounded-xl text-xs uppercase hover:bg-emerald-400 transition-all shadow-[0_0_20px_rgba(16,185,129,0.2)]"
                      >
                        Execute Buy Order
                      </button>
                    </div>

                    <div className="p-4 bg-white/2 rounded-xl border border-white/5 space-y-4">
                      <h4 className="text-[10px] font-mono text-white/40 uppercase">Simulation Intelligence</h4>
                      <p className="text-[10px] text-white/40 leading-relaxed italic">
                        DeepSeek is currently managing the simulation. It analyzes tokens with high Nana Scores and security verdicts to decide on entries and exits.
                      </p>
                      <div className="flex items-center gap-2 p-2 bg-indigo-500/10 border border-indigo-500/20 rounded-lg">
                        <Brain className="w-4 h-4 text-indigo-400" />
                        <span className="text-[10px] font-mono text-indigo-400 uppercase">AI Strategy: Adaptive Learning</span>
                      </div>
                    </div>
                  </div>
                </Card>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'history' && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              <Card title="Total Calls (All Time)" icon={Database}>
                <div className="text-xl md:text-2xl font-bold text-white">{historyStats.totalCalls}</div>
                <div className="text-[10px] font-mono text-white/40 uppercase">Signals Recorded</div>
              </Card>
              <Card title="Neural Sentiment" icon={Brain}>
                <div className="text-xl md:text-2xl font-bold text-emerald-400">{(historyStats.avgSentiment || 0).toFixed(1)}%</div>
                <div className="text-[10px] font-mono text-white/40 uppercase">Average Bullishness</div>
              </Card>
              <Card title="Explosive Hits" icon={Zap}>
                <div className="text-xl md:text-2xl font-bold text-amber-400">{historyStats.explosive}</div>
                <div className="text-[10px] font-mono text-white/40 uppercase">5x+ Multipliers</div>
              </Card>
            </div>

            <Card title="Signal History" icon={History}>
              <div className="p-4 border-b border-white/5 bg-white/2 flex flex-wrap gap-4 items-end">
                <div className="space-y-1 flex-1 min-w-[120px]">
                  <label className="text-[10px] font-mono text-white/40 uppercase">Chain</label>
                  <select 
                    value={historyChainFilter}
                    onChange={(e) => setHistoryChainFilter(e.target.value)}
                    className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-[10px] font-mono text-white focus:outline-none focus:border-indigo-500 uppercase"
                  >
                    <option value="all">All Chains</option>
                    <option value="solana">Solana</option>
                    <option value="ethereum">Ethereum</option>
                    <option value="base">Base</option>
                    <option value="bsc">BSC</option>
                  </select>
                </div>
                <div className="space-y-1 flex-1 min-w-[120px]">
                  <label className="text-[10px] font-mono text-white/40 uppercase">Performance</label>
                  <select 
                    value={historyWinFilter}
                    onChange={(e) => setHistoryWinFilter(e.target.value as any)}
                    className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-[10px] font-mono text-white focus:outline-none focus:border-indigo-500 uppercase"
                  >
                    <option value="all">All Signals</option>
                    <option value="winners">Winners (2x+)</option>
                    <option value="losers">Losers (&lt;1.1x)</option>
                  </select>
                </div>
                <div className="space-y-1 flex-1 min-w-[120px]">
                  <label className="text-[10px] font-mono text-white/40 uppercase">Date</label>
                  <input 
                    type="date"
                    value={historyDateFilter}
                    onChange={(e) => setHistoryDateFilter(e.target.value)}
                    className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-[10px] font-mono text-white focus:outline-none focus:border-indigo-500"
                  />
                </div>
                <button 
                  onClick={() => {
                    setHistoryChainFilter('all');
                    setHistoryWinFilter('all');
                    setHistoryDateFilter('');
                  }}
                  className="px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-[10px] font-mono uppercase hover:bg-white/10 transition-all"
                >
                  Reset
                </button>
              </div>
              <div className="overflow-x-auto -mx-4 px-4">
                <table className="w-full text-left border-collapse min-w-[800px]">
                  <thead>
                    <tr className="border-b border-white/5">
                      <th className="p-4 text-[10px] font-mono text-white/40 uppercase">Token</th>
                      <th className="p-4 text-[10px] font-mono text-white/40 uppercase">Chain</th>
                      <th className="p-4 text-[10px] font-mono text-white/40 uppercase">Score</th>
                      <th className="p-4 text-[10px] font-mono text-white/40 uppercase">Security</th>
                      <th className="p-4 text-[10px] font-mono text-white/40 uppercase">Sentiment</th>
                      <th className="p-4 text-[10px] font-mono text-white/40 uppercase">ATH</th>
                      <th className="p-4 text-[10px] font-mono text-white/40 uppercase">Mult</th>
                      <th className="p-4 text-[10px] font-mono text-white/40 uppercase">Time</th>
                      <th className="p-4 text-[10px] font-mono text-white/40 uppercase">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(historyTokens || []).length === 0 && (
                      <tr>
                        <td colSpan={7} className="p-12 text-center">
                          <div className="flex flex-col items-center gap-2 text-white/20">
                            <History className="w-8 h-8 opacity-20" />
                            <p className="text-xs font-mono uppercase italic">No historical signals found in database</p>
                          </div>
                        </td>
                      </tr>
                    )}
                    {(historyTokens || [])
                      .sort((a, b) => (b.ath_price / b.call_price) - (a.ath_price / a.call_price))
                      .map((token, i) => (
                        <tr key={token.id || token.address || i} className="border-b border-white/2 hover:bg-white/2 transition-colors">
                        <td className="p-4">
                          <div className="flex items-center gap-2">
                            <span className="font-bold">{token.symbol}</span>
                            <span className="text-[10px] text-white/20 font-mono truncate max-w-[100px]">{token.address}</span>
                          </div>
                        </td>
                        <td className="p-4 text-[10px] font-mono text-white/60 uppercase">{token.chain}</td>
                        <td className="p-4">
                          <span className={cn(
                            "font-mono font-bold",
                            token.nana_score > 80 ? "text-emerald-400" : "text-amber-400"
                          )}>
                            {(token.nana_score || 0).toFixed(1)}
                          </span>
                        </td>
                        <td className="p-4">
                          <Badge variant={token.ai_rug_risk_level === 'LOW' ? 'success' : token.ai_rug_risk_level === 'MEDIUM' ? 'warning' : 'danger'}>
                            {token.ai_rug_risk_level || 'N/A'}
                          </Badge>
                        </td>
                        <td className="p-4 text-xs font-mono">{(token.sentiment_score || 0).toFixed(0)}%</td>
                        <td className="p-4 text-[10px] font-mono text-white/60">${(token.ath_price || 0).toFixed(6)}</td>
                        <td className="p-4">
                          <span className={cn(
                            "text-[10px] font-mono font-bold",
                            (token.ath_price / token.call_price) >= 2 ? "text-emerald-400" : "text-white/40"
                          )}>
                            {(token.ath_price / token.call_price).toFixed(1)}x
                          </span>
                        </td>
                        <td className="p-4 text-[10px] font-mono text-white/40">
                          {formatDistanceToNow(token.created_at)} ago
                        </td>
                        <td className="p-4">
                          <a 
                            href={`https://dexscreener.com/${token.chain}/${token.address}`} 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="text-[10px] font-mono text-emerald-500 hover:underline"
                          >
                            DEX
                          </a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          </div>
        )}

        {activeTab === 'social' && (
          <div className="max-w-2xl mx-auto space-y-6">
            <Card title="Degenics Community" icon={Users}>
              <div className="space-y-4 p-4">
                <p className="text-sm text-white/60 leading-relaxed">
                  Join the most advanced intelligence network in the trenches. Follow our official channels for updates, community calls, and neural engine insights.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <a 
                    href="https://x.com/degenic_uni?s=20" 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="flex items-center justify-center gap-3 p-6 bg-white/5 hover:bg-white/10 border border-white/10 rounded-2xl transition-all group"
                  >
                    <Twitter className="w-8 h-8 text-white group-hover:scale-110 transition-transform" />
                    <div className="text-left">
                      <p className="text-xs font-bold uppercase tracking-widest">Follow on X</p>
                      <p className="text-[10px] font-mono text-white/40">@degenic_uni</p>
                    </div>
                  </a>
                  <a 
                    href="https://t.me/degenicxz" 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="flex items-center justify-center gap-3 p-6 bg-white/5 hover:bg-white/10 border border-white/10 rounded-2xl transition-all group"
                  >
                    <Send className="w-8 h-8 text-sky-400 group-hover:scale-110 transition-transform" />
                    <div className="text-left">
                      <p className="text-xs font-bold uppercase tracking-widest">Join Telegram</p>
                      <p className="text-[10px] font-mono text-white/40">t.me/degenicxz</p>
                    </div>
                  </a>
                </div>
              </div>
            </Card>
          </div>
        )}
        {activeTab === 'live' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 md:gap-6">
            {/* Stats Overview */}
            <div className="col-span-12 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6 mb-2">
              <Card className="bg-gradient-to-br from-emerald-500/5 to-transparent">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-[10px] font-mono text-white/40 uppercase mb-1">Total Calls</p>
                    <h3 className="text-2xl md:text-3xl font-bold tracking-tighter">{stats.totalCalls}</h3>
                  </div>
                  <Target className="w-6 h-6 md:w-8 md:h-8 text-emerald-500/20" />
                </div>
              </Card>
              <Card className="bg-gradient-to-br from-indigo-500/5 to-transparent">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-[10px] font-mono text-white/40 uppercase mb-1">Neural Sentiment</p>
                    <h3 className="text-2xl md:text-3xl font-bold tracking-tighter">{(stats.avgSentiment || 0).toFixed(1)}%</h3>
                  </div>
                  <Globe className="w-6 h-6 md:w-8 md:h-8 text-indigo-500/20" />
                </div>
              </Card>
              <Card className="bg-gradient-to-br from-amber-500/5 to-transparent">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-[10px] font-mono text-white/40 uppercase mb-1">Explosive Hits</p>
                    <h3 className="text-2xl md:text-3xl font-bold tracking-tighter">{stats.explosive}</h3>
                  </div>
                  <Zap className="w-6 h-6 md:w-8 md:h-8 text-amber-500/20" />
                </div>
              </Card>
              <Card className="bg-gradient-to-br from-rose-500/5 to-transparent">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-[10px] font-mono text-white/40 uppercase mb-1">Rug Prevention</p>
                    <h3 className="text-2xl md:text-3xl font-bold tracking-tighter">{stats.rugPrevention}%</h3>
                  </div>
                  <Shield className="w-6 h-6 md:w-8 md:h-8 text-rose-500/20" />
                </div>
              </Card>
            </div>

            {/* Live Feed */}
            <div className="col-span-12 lg:col-span-8 overflow-hidden">
              <Card 
                title={
                  <div className="flex items-center gap-2">
                    <span>Live Intelligence Feed</span>
                    <div className="flex items-center gap-1 px-1.5 py-0.5 bg-emerald-500/10 border border-emerald-500/20 rounded text-[8px] font-mono text-emerald-400 animate-pulse">
                      <div className="w-1 h-1 bg-emerald-500 rounded-full" />
                      LIVE
                    </div>
                  </div>
                } 
                icon={Activity}
              >
                <div className="space-y-4">
                  <AnimatePresence>
                    {tokens.map((token, i) => (
                      <motion.div
                        key={token.id || token.address || i}
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, scale: 0.95 }}
                        className="group bg-white/2 hover:bg-white/[0.04] border border-white/5 rounded-xl p-3 md:p-4 transition-all"
                      >
                        <div className="flex flex-col sm:flex-row items-start justify-between gap-4">
                          <div className="flex gap-3 md:gap-4 w-full sm:w-auto">
                            <div className="w-10 h-10 md:w-12 md:h-12 bg-white/5 rounded-lg flex items-center justify-center text-lg font-bold flex-shrink-0">
                              {token.symbol[0]}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2 mb-1 flex-wrap">
                                <h4 className="font-bold text-base md:text-lg leading-none truncate">{token.symbol}</h4>
                                <Badge variant={token.cto_status ? 'success' : 'default'}>
                                  {token.cto_status ? 'CTO' : 'DEV'}
                                </Badge>
                                <span className="text-[10px] font-mono text-white/30 uppercase">{token.chain}</span>
                              </div>
                              <p className="text-[10px] md:text-xs text-white/40 font-mono truncate max-w-full sm:max-w-[200px]">{token.address}</p>
                            </div>
                          </div>

                          <div className="flex flex-wrap sm:flex-nowrap gap-4 md:gap-8 text-left sm:text-right w-full sm:w-auto">
                            <div className="flex-1 sm:flex-none">
                              <p className="text-[10px] font-mono text-white/30 uppercase mb-1">Current Price</p>
                              <div className="flex items-center sm:justify-end gap-1.5">
                                <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
                                <p className="font-bold text-white text-xs md:text-base">${(token.current_price || 0).toFixed(8)}</p>
                              </div>
                            </div>
                            <div className="flex-1 sm:flex-none">
                              <p className="text-[10px] font-mono text-white/30 uppercase mb-1">Call Price</p>
                              <p className="font-bold text-white/60 text-xs md:text-base sm:text-right">${(token.call_price || 0).toFixed(8)}</p>
                            </div>
                            <div className="w-full sm:w-auto">
                              <p className="text-[10px] font-mono text-white/30 uppercase mb-1 sm:text-right">Nana Score</p>
                              <div className="flex items-center sm:justify-end gap-2">
                                <div className="w-12 h-1.5 bg-white/10 rounded-full overflow-hidden">
                                  <div 
                                    className={cn(
                                      "h-full rounded-full",
                                      token.nana_score > 80 ? "bg-emerald-500" : "bg-amber-500"
                                    )} 
                                    style={{ width: `${token.nana_score}%` }} 
                                  />
                                </div>
                                <span className="font-bold text-sm">{(token.nana_score || 0).toFixed(0)}</span>
                              </div>
                            </div>
                          </div>
                        </div>

                        <div className="mt-4 pt-4 border-t border-white/5 grid grid-cols-2 sm:grid-cols-3 gap-3 md:gap-4">
                          <div className="flex items-center gap-1.5">
                            <TrendingUp className="w-3 h-3 text-emerald-400" />
                            <span className="text-[10px] font-mono text-white/60 uppercase">ATH: {token.call_price ? (token.ath_price / token.call_price).toFixed(2) : '0.00'}x</span>
                            {token.ath_price >= token.call_price * 2 && (
                              <Badge variant="success">2X</Badge>
                            )}
                          </div>
                          <div className="flex items-center gap-1.5">
                            <span className="text-[10px] font-mono text-white/30 uppercase">MC:</span>
                            <span className="text-[10px] font-mono text-white/60">{formatCurrency(token.market_cap)}</span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <span className="text-[10px] font-mono text-white/30 uppercase">Liq:</span>
                            <span className="text-[10px] font-mono text-white/60">{formatCurrency(token.liquidity)}</span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <AlertTriangle className="w-3 h-3 text-rose-400" />
                            <span className="text-[10px] font-mono text-white/60 uppercase truncate">Risk: {(token.rug_risk_score || 0).toFixed(0)}%</span>
                            {token.ai_rug_risk_level && (
                              <Badge variant={token.ai_rug_risk_level === 'LOW' ? 'success' : token.ai_rug_risk_level === 'MEDIUM' ? 'warning' : 'danger'}>
                                {token.ai_rug_risk_level[0]}
                              </Badge>
                            )}
                          </div>
                          <div className="flex items-center gap-1.5">
                            <Ghost className="w-3 h-3 text-indigo-400" />
                            <span className="text-[10px] font-mono text-white/60 uppercase truncate">Insider: {(token.insider_probability || 0).toFixed(0)}%</span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <Users className="w-3 h-3 text-sky-400" />
                            <span className="text-[10px] font-mono text-white/60 uppercase truncate">Sent: {(token.sentiment_score || 0).toFixed(0)}%</span>
                          </div>
                        </div>

                        {token.ai_social_verdict && (
                          <div className="mt-3 p-2 bg-sky-500/5 border border-sky-500/10 rounded-lg">
                            <div className="flex items-center gap-1.5 mb-1">
                              <Globe className="w-2.5 h-2.5 text-sky-400" />
                              <span className="text-[8px] font-mono text-sky-400 uppercase font-bold">Social Intelligence</span>
                            </div>
                            <p className="text-[9px] font-mono text-white/60 leading-tight italic">"{token.ai_social_verdict}"</p>
                          </div>
                        )}

                        <div className="mt-3 flex items-center justify-between">
                          <div className="flex flex-wrap gap-2">
                            <Badge variant={token.insider_probability > 40 ? 'danger' : 'success'}>
                              {token.insider_probability > 40 ? 'High Insider Risk' : 'Organic Holders'}
                            </Badge>
                            <Badge variant={token.buy_pressure > 0.8 ? 'success' : 'default'}>
                              {token.buy_pressure > 0.8 ? 'Strong Buy Pressure' : 'Neutral Pressure'}
                            </Badge>
                            {token.ai_rug_verdict && (
                              <div className="text-[10px] font-mono text-white/40 italic flex items-center gap-1">
                                <Shield className="w-2 h-2 text-emerald-400" />
                                {token.ai_rug_verdict}
                              </div>
                            )}
                          </div>
                          <div className="flex gap-2">
                            <button 
                              onClick={() => window.open(`https://rugcheck.xyz/tokens/${token.address}`, '_blank')}
                              className="px-3 py-1 bg-white/5 hover:bg-white/10 rounded text-[10px] font-mono uppercase transition-colors flex items-center gap-1"
                            >
                              <Search className="w-3 h-3" /> Scan
                            </button>
                            <a 
                              href={`https://dexscreener.com/${token.chain}/${token.address}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="px-3 py-1 bg-emerald-500 text-black font-bold rounded text-[10px] font-mono uppercase hover:bg-emerald-400 transition-colors flex items-center gap-1"
                            >
                              <ExternalLink className="w-3 h-3" /> Dex
                            </a>
                          </div>
                        </div>
                      </motion.div>
                    ))}
                  </AnimatePresence>
                  {tokens.length > 0 && (
                    <div className="pt-4 mt-4 border-t border-white/5 text-center">
                      <button 
                        onClick={() => setActiveTab('history')}
                        className="text-[10px] font-mono text-white/40 uppercase hover:text-emerald-400 transition-colors flex items-center gap-2 mx-auto"
                      >
                        <History className="w-3 h-3" /> View All Signal History
                      </button>
                    </div>
                  )}
                  {tokens.length === 0 && (
                    <div className="py-20 text-center space-y-4">
                      <div className="w-12 h-12 bg-white/5 rounded-full flex items-center justify-center mx-auto border border-white/10">
                        <Activity className="w-6 h-6 text-white/20" />
                      </div>
                      <div>
                        <p className="text-sm font-bold">No signals detected yet</p>
                        <p className="text-xs text-white/40 font-mono mt-1 uppercase">Angel is scanning the trenches...</p>
                      </div>
                      <button 
                        onClick={fetchData}
                        className="px-4 py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-[10px] font-mono uppercase transition-all"
                      >
                        Refresh Feed
                      </button>
                    </div>
                  )}
                </div>
              </Card>
            </div>

            {/* Sidebar */}
            <div className="lg:col-span-4 space-y-6">
              <Card title="Learning Insights" icon={Cpu}>
                <div className="space-y-3">
                  {(insights || []).length > 0 ? (insights || []).map((insight, i) => (
                    <div key={i} className="p-3 bg-indigo-500/5 border border-indigo-500/10 rounded-lg">
                      <div className="flex items-center gap-2 mb-1">
                        <Cpu className="w-4 h-4 text-indigo-500" />
                        <span className="text-xs font-bold text-indigo-500 uppercase">PATTERN LEARNED</span>
                      </div>
                      <p className="text-[10px] font-mono text-white/80">{insight.insight}</p>
                      <div className="mt-2 flex items-center justify-between">
                        <span className="text-[10px] font-mono text-white/30 uppercase">Weight Adj:</span>
                        <span className="text-[10px] font-mono text-emerald-400">+{insight.weight_adjustment * 100}%</span>
                      </div>
                    </div>
                  )) : (
                    <p className="text-[10px] font-mono text-white/30 text-center py-4 italic">Accumulating data for neural training...</p>
                  )}
                </div>
              </Card>

              <Card title="Rug Intelligence" icon={Ghost}>
                <div className="space-y-3">
                  {(rugs || []).length > 0 ? (rugs || []).map((rug, i) => (
                    <div key={i} className="p-3 bg-rose-500/5 border border-rose-500/10 rounded-lg">
                      <div className="flex items-center gap-2 mb-1">
                        <XCircle className="w-4 h-4 text-rose-500" />
                        <span className="text-xs font-bold text-rose-500 uppercase">RUG DETECTED</span>
                      </div>
                      <p className="text-[10px] font-mono text-white/60 truncate">Addr: {rug.address}</p>
                      <p className="text-[10px] font-mono text-white/40 mt-1">{rug.reason}</p>
                      <button 
                        onClick={() => window.open(`https://rugcheck.xyz/tokens/${rug.address}`, '_blank')}
                        className="mt-2 w-full py-1 bg-white/5 hover:bg-white/10 rounded text-[10px] font-mono uppercase transition-colors flex items-center justify-center gap-1"
                      >
                        <Search className="w-3 h-3" /> Cross Check
                      </button>
                    </div>
                  )) : (
                    <div className="p-3 bg-emerald-500/5 border border-emerald-500/10 rounded-lg">
                      <div className="flex items-center gap-2 mb-1">
                        <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                        <span className="text-xs font-bold text-emerald-500 uppercase">NO RECENT RUGS</span>
                      </div>
                      <p className="text-[10px] font-mono text-white/60">System monitoring active.</p>
                    </div>
                  )}
                </div>
              </Card>

              <Card title="System Status" icon={Settings}>
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-white/40 font-mono uppercase">Telegram Alerts</span>
                    <Badge variant={config?.alerts_enabled === 'true' ? 'success' : 'danger'}>
                      {config?.alerts_enabled === 'true' ? 'Active' : 'Disabled'}
                    </Badge>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-white/40 font-mono uppercase">Min Boost</span>
                    <span className="text-xs font-mono">{config?.min_boost}x</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-white/40 font-mono uppercase">Risk Mode</span>
                    <span className="text-xs font-mono uppercase text-emerald-400">{config?.risk_mode}</span>
                  </div>
                  <div className="pt-2">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] text-white/30 font-mono uppercase">Scanning Velocity</span>
                      <span className="text-[10px] text-emerald-400 font-mono">High</span>
                    </div>
                    <div className="w-full h-1 bg-white/5 rounded-full overflow-hidden">
                      <motion.div 
                        className="h-full bg-emerald-500"
                        animate={{ width: ['20%', '90%', '40%', '70%'] }}
                        transition={{ duration: 4, repeat: Infinity }}
                      />
                    </div>
                  </div>
                </div>
              </Card>
            </div>
          </div>
        )}

        {activeTab === 'performance' && (
          user ? (
            <div className="space-y-6">
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <Card title="Win Rate" className="col-span-1">
                  <div className="flex flex-col items-center justify-center py-8">
                    <div className="relative w-32 h-32 flex items-center justify-center">
                      <svg className="w-full h-full transform -rotate-90">
                        <circle cx="64" cy="64" r="58" stroke="currentColor" strokeWidth="8" fill="transparent" className="text-white/5" />
                        <circle 
                          cx="64" cy="64" r="58" 
                          stroke="currentColor" 
                          strokeWidth="8" 
                          fill="transparent" 
                          strokeDasharray={364} 
                          strokeDashoffset={364 * (1 - stats.winRate / 100)} 
                          className="text-emerald-500 transition-all duration-1000" 
                        />
                      </svg>
                      <span className="absolute text-3xl font-bold">{(stats.winRate || 0).toFixed(1)}%</span>
                    </div>
                    <p className="mt-4 text-[10px] font-mono text-white/40 uppercase tracking-widest text-center">Calls reaching 2x+</p>
                  </div>
                </Card>
                <Card title="Volume Acceleration" className="lg:col-span-2">
                  <div className="h-[200px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={[
                        { time: '12:00', val: 400 },
                        { time: '13:00', val: 300 },
                        { time: '14:00', val: 600 },
                        { time: '15:00', val: 800 },
                        { time: '16:00', val: 500 },
                        { time: '17:00', val: 900 },
                      ]}>
                        <defs>
                          <linearGradient id="colorVal" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#10b981" stopOpacity={0.3}/>
                            <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#ffffff05" vertical={false} />
                        <XAxis dataKey="time" stroke="#ffffff20" fontSize={10} tickLine={false} axisLine={false} />
                        <Tooltip 
                          contentStyle={{ backgroundColor: '#151619', border: '1px solid #ffffff10', borderRadius: '8px' }}
                          itemStyle={{ color: '#10b981' }}
                        />
                        <Area type="monotone" dataKey="val" stroke="#10b981" fillOpacity={1} fill="url(#colorVal)" />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </Card>
              </div>

              <Card title="Call History & ATH Tracking">
                <div className="mb-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 p-4 bg-white/2 rounded-lg border border-white/5">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-mono text-white/30 uppercase">Chain Filter</label>
                    <select 
                      value={historyChainFilter}
                      onChange={(e) => setHistoryChainFilter(e.target.value)}
                      className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:border-emerald-500 transition-colors"
                    >
                      <option value="all">All Chains</option>
                      <option value="solana">Solana</option>
                      <option value="ethereum">Ethereum</option>
                      <option value="base">Base</option>
                      <option value="bsc">BSC</option>
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-mono text-white/30 uppercase">Performance</label>
                    <select 
                      value={historyWinFilter}
                      onChange={(e) => setHistoryWinFilter(e.target.value as any)}
                      className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:border-emerald-500 transition-colors"
                    >
                      <option value="all">All Results</option>
                      <option value="winners">Winners (2x+)</option>
                      <option value="losers">No Pump (&lt;2x)</option>
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-mono text-white/30 uppercase">Date Filter</label>
                    <input 
                      type="date"
                      value={historyDateFilter}
                      onChange={(e) => setHistoryDateFilter(e.target.value)}
                      className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:border-emerald-500 transition-colors"
                    />
                  </div>
                  <div className="flex items-end">
                    <button 
                      onClick={() => {
                        setHistoryChainFilter('all');
                        setHistoryWinFilter('all');
                        setHistoryDateFilter('');
                      }}
                      className="w-full py-1.5 bg-white/5 hover:bg-white/10 rounded-lg text-[10px] font-mono uppercase transition-colors"
                    >
                      Reset Filters
                    </button>
                  </div>
                </div>

                <div className="overflow-x-auto -mx-4 px-4">
                  <table className="w-full text-left border-collapse min-w-[800px]">
                    <thead>
                      <tr className="border-b border-white/5">
                        <th className="pb-4 text-[10px] font-mono text-white/30 uppercase">Token & Time</th>
                        <th className="pb-4 text-[10px] font-mono text-white/30 uppercase">Chain</th>
                        <th className="pb-4 text-[10px] font-mono text-white/30 uppercase">Sentiment</th>
                        <th className="pb-4 text-[10px] font-mono text-white/30 uppercase">Dev Activity</th>
                        <th className="pb-4 text-[10px] font-mono text-white/30 uppercase">Call Price</th>
                        <th className="pb-4 text-[10px] font-mono text-white/30 uppercase">ATH Price</th>
                        <th className="pb-4 text-[10px] font-mono text-white/30 uppercase">Multiplier</th>
                        <th className="pb-4 text-[10px] font-mono text-white/30 uppercase">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {performanceTokens
                        .filter(token => {
                          const chainMatch = historyChainFilter === 'all' || token.chain === historyChainFilter;
                          const winMatch = historyWinFilter === 'all' || 
                            (historyWinFilter === 'winners' ? (token.ath_price / token.call_price >= 2) : (token.ath_price / token.call_price < 2));
                          // Performance tab is already 24h scoped, so we ignore the date filter here
                          return chainMatch && winMatch;
                        })
                        .map((token, i) => (
                        <tr key={token.id || token.address || i} className="group hover:bg-white/[0.02]">
                          <td className="py-4">
                            <div className="flex flex-col">
                              <span className="font-bold">{token.symbol}</span>
                              <span className="text-[10px] font-mono text-white/30">
                                {new Date(token.created_at).toLocaleDateString()} {new Date(token.created_at).toLocaleTimeString()}
                              </span>
                            </div>
                          </td>
                          <td className="py-4">
                            <Badge variant="info">{token.chain}</Badge>
                          </td>
                          <td className="py-4">
                            <div className="flex flex-col gap-1">
                              <div className="flex items-center gap-2">
                                <div className="w-12 h-1 bg-white/5 rounded-full overflow-hidden">
                                  <div className="h-full bg-indigo-500" style={{ width: `${token.sentiment_score}%` }} />
                                </div>
                                <span className="text-[10px] font-mono text-white/60">{(token.sentiment_score || 0).toFixed(0)}%</span>
                              </div>
                              {token.ai_social_verdict && (
                                <span className="text-[8px] font-mono text-white/20 italic truncate max-w-[150px]" title={token.ai_social_verdict}>
                                  {token.ai_social_verdict}
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="py-4">
                            <div className="flex items-center gap-2">
                              <div className="w-12 h-1 bg-white/5 rounded-full overflow-hidden">
                                <div className="h-full bg-amber-500" style={{ width: `${token.dev_activity_score}%` }} />
                              </div>
                              <span className="text-[10px] font-mono text-white/60">{(token.dev_activity_score || 0).toFixed(0)}%</span>
                            </div>
                          </td>
                          <td className="py-4 font-mono text-xs text-white/60">${(token.call_price || 0).toFixed(6)}</td>
                          <td className="py-4 font-mono text-xs text-emerald-400">${(token.ath_price || 0).toFixed(6)}</td>
                          <td className="py-4">
                            <Badge variant={token.call_price && (token.ath_price / token.call_price) >= 2 ? 'success' : 'default'}>
                              {token.call_price ? (token.ath_price / token.call_price).toFixed(2) : '0.00'}x
                            </Badge>
                          </td>
                          <td className="py-4">
                            <span className="text-[10px] font-mono uppercase text-white/40">
                              {(token.ath_price / token.call_price) >= 5 ? 'Explosive' : (token.ath_price / token.call_price) >= 2 ? 'Strong' : 'Weak'}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <div className="w-16 h-16 bg-white/5 rounded-full flex items-center justify-center mb-6 border border-white/10">
                <Lock className="w-8 h-8 text-white/20" />
              </div>
              <h3 className="text-xl font-bold mb-2">History Locked</h3>
              <p className="text-white/40 max-w-sm mb-8">
                You must be signed in to access the neural history and performance tracking engine.
              </p>
              <button 
                onClick={() => {
                  setAuthMode('signup');
                  setShowAuthModal(true);
                }}
                className="px-8 py-3 bg-emerald-500 hover:bg-emerald-600 rounded-xl font-bold transition-all shadow-lg shadow-emerald-500/20"
              >
                Sign Up Now
              </button>
            </div>
          )
        )}

        {activeTab === 'config' && config && (
          user ? (
            <div className="max-w-2xl mx-auto space-y-6">
              <Card title="Scanning Engine" icon={Activity}>
                <div className="space-y-4">
                  <div className="flex items-center justify-between p-4 bg-white/2 rounded-lg border border-white/5">
                    <div>
                      <h4 className="text-sm font-bold">Engine Status</h4>
                      <p className="text-xs text-white/40">Real-time DexScreener & RugCheck scanning</p>
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="flex items-center gap-2">
                        <div className={cn(
                          "w-2 h-2 rounded-full animate-pulse",
                          config.scanning_active === 'true' ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" : "bg-red-500"
                        )} />
                        <span className="text-[10px] font-mono uppercase text-white/60">
                          {config.scanning_active === 'true' ? "Running" : "Paused"}
                        </span>
                      </div>
                      <button 
                        onClick={() => updateConfig('scanning_active', config.scanning_active === 'true' ? 'false' : 'true')}
                        className={cn(
                          "w-12 h-6 rounded-full transition-all relative",
                          config.scanning_active === 'true' ? "bg-emerald-500" : "bg-white/10"
                        )}
                      >
                        <div className={cn(
                          "absolute top-1 w-4 h-4 rounded-full bg-white transition-all",
                          config.scanning_active === 'true' ? "left-7" : "left-1"
                        )} />
                      </button>
                    </div>
                  </div>
                  
                  {config.scanning_active === 'true' && (
                    <div className="p-3 bg-emerald-500/5 border border-emerald-500/10 rounded-lg flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <RefreshCw className="w-3 h-3 text-emerald-400 animate-spin" />
                        <span className="text-[10px] font-mono text-emerald-400 uppercase">Active Polling: 60s Interval</span>
                      </div>
                      <span className="text-[10px] font-mono text-white/20 uppercase">Last Heartbeat: {lastScanTime}</span>
                    </div>
                  )}
                </div>
              </Card>

              <Card title="Neural Engine" icon={Brain}>
                <div className="space-y-4">
                  <div className="flex items-center justify-between p-4 bg-white/2 rounded-lg border border-white/5">
                    <div>
                      <h4 className="text-sm font-bold">AI Connectivity</h4>
                      <p className="text-xs text-white/40">Multi-Model Intelligence Network</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className={cn(
                        "w-2 h-2 rounded-full",
                        hasAiKey ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" : "bg-red-500"
                      )} />
                      <span className="text-[10px] font-mono uppercase text-white/60">
                        {hasAiKey ? "Active" : "Offline"}
                      </span>
                    </div>
                  </div>

                  <div className="space-y-4 p-4 bg-white/2 rounded-lg border border-white/5">
                    <div className="space-y-2">
                      <label className="text-[10px] font-mono text-white/40 uppercase">Primary AI Provider</label>
                      <div className="grid grid-cols-2 gap-2">
                        <button 
                          onClick={() => updateConfig('ai_provider', 'gemini')}
                          className={cn(
                            "py-2 rounded-lg text-[10px] font-mono uppercase border transition-all",
                            config.ai_provider === 'gemini' 
                              ? "bg-indigo-500/20 border-indigo-500 text-white" 
                              : "bg-white/5 border-white/10 text-white/40 hover:bg-white/10"
                          )}
                        >
                          Google Gemini
                        </button>
                        <button 
                          onClick={() => updateConfig('ai_provider', 'deepseek')}
                          className={cn(
                            "py-2 rounded-lg text-[10px] font-mono uppercase border transition-all",
                            config.ai_provider === 'deepseek' 
                              ? "bg-sky-500/20 border-sky-500 text-white" 
                              : "bg-white/5 border-white/10 text-white/40 hover:bg-white/10"
                          )}
                        >
                          DeepSeek V3
                        </button>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <label className="text-[10px] font-mono text-white/40 uppercase">Intelligence Switch Mode</label>
                      <div className="grid grid-cols-2 gap-2">
                        <button 
                          onClick={() => updateConfig('ai_switch_mode', 'auto')}
                          className={cn(
                            "py-2 rounded-lg text-[10px] font-mono uppercase border transition-all",
                            config.ai_switch_mode === 'auto' 
                              ? "bg-emerald-500/20 border-emerald-500 text-white" 
                              : "bg-white/5 border-white/10 text-white/40 hover:bg-white/10"
                          )}
                        >
                          Auto Fallback
                        </button>
                        <button 
                          onClick={() => updateConfig('ai_switch_mode', 'manual')}
                          className={cn(
                            "py-2 rounded-lg text-[10px] font-mono uppercase border transition-all",
                            config.ai_switch_mode === 'manual' 
                              ? "bg-amber-500/20 border-amber-500 text-white" 
                              : "bg-white/5 border-white/10 text-white/40 hover:bg-white/10"
                          )}
                        >
                          Manual Only
                        </button>
                      </div>
                      <p className="text-[8px] font-mono text-white/20 uppercase">
                        {config.ai_switch_mode === 'auto' 
                          ? "Automatically switches to secondary model if primary fails" 
                          : "Strictly uses selected provider; fails if unavailable"}
                      </p>
                    </div>
                  </div>
                  
                  {!hasAiKey && (
                    <button 
                      onClick={handleOpenKeySelector}
                      className="w-full py-2 bg-amber-500 text-black font-bold rounded-lg text-[10px] uppercase hover:bg-amber-400 transition-colors"
                    >
                      Connect AI Key
                    </button>
                  )}
                  
                  {hasAiKey && (
                    <div className="space-y-2">
                      <div className="p-3 bg-emerald-500/5 border border-emerald-500/10 rounded-lg">
                        <p className="text-[10px] font-mono text-emerald-400 uppercase">Status: Optimal</p>
                        <p className="text-[8px] font-mono text-white/20 uppercase mt-1">Using direct integration key</p>
                      </div>
                      <button 
                        onClick={async () => {
                          const btn = document.activeElement as HTMLButtonElement;
                          if (btn) btn.disabled = true;
                          try {
                            const res = await callAI("Respond with 'AI ACTIVE' in JSON format: {\"status\": \"active\"}");
                            const data = JSON.parse(res || "{}");
                            alert(`AI Connection Successful!\nProvider: ${config.ai_provider}\nResponse: ${data.status || res}`);
                          } catch (e: any) {
                            alert(`AI Connection Failed!\nError: ${e.message}\n\nCheck your API key or try switching providers.`);
                          } finally {
                            if (btn) btn.disabled = false;
                          }
                        }}
                        className="w-full py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-[10px] font-mono uppercase transition-all disabled:opacity-50"
                      >
                        Test AI Connection
                      </button>
                    </div>
                  )}

                  <div className="pt-4 border-t border-white/5">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
                        <span className="text-xs font-mono uppercase text-white/60">Engine Status: Active</span>
                      </div>
                      <span className="text-[10px] font-mono text-white/20 uppercase">Learning from {stats.totalCalls} signals</span>
                    </div>

                    <button 
                      onClick={async () => {
                        const res = await fetch('/api/neural/learn', { method: 'POST' });
                        if (res.ok) fetchData();
                      }}
                      className="w-full mb-4 py-2 bg-indigo-500/10 hover:bg-indigo-500/20 border border-indigo-500/20 rounded-lg text-[10px] font-mono text-indigo-400 uppercase transition-all flex items-center justify-center gap-2"
                    >
                      <Brain className="w-3 h-3" /> Trigger Neural Optimization
                    </button>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
                      {(neuralWeights || []).map((w, i) => (
                        <div key={i} className="bg-white/5 p-3 rounded-lg border border-white/5">
                          <div className="flex items-center justify-between mb-2">
                            <p className="text-[10px] font-mono text-white/40 uppercase">{w.factor}</p>
                            <span className="text-[10px] font-mono text-emerald-400 font-bold">{(w.weight || 0).toFixed(2)}</span>
                          </div>
                          <input 
                            type="range"
                            min="0.01"
                            max="1.0"
                            step="0.01"
                            value={w.weight}
                            onChange={async (e) => {
                              const newWeight = parseFloat(e.target.value);
                              const res = await fetch('/api/neural/weights', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ factor: w.factor, weight: newWeight })
                              });
                              if (res.ok) fetchData();
                            }}
                            className="w-full h-1 bg-white/10 rounded-lg appearance-none cursor-pointer accent-emerald-500"
                          />
                        </div>
                      ))}
                    </div>

                    <p className="text-[10px] font-mono text-white/40 uppercase mb-3">Latest Neural Insights</p>
                    <div className="space-y-2">
                      {(insights || []).slice(0, 3).map((ins, i) => (
                        <div key={i} className="flex gap-3 items-start p-2 bg-emerald-500/5 rounded border border-emerald-500/10">
                          <Brain className="w-3 h-3 text-emerald-500 mt-0.5 shrink-0" />
                          <p className="text-[10px] font-mono text-emerald-400/80 leading-relaxed">
                            {ins.insight}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </Card>

              <Card title="Trading Strategy" icon={Target}>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-[10px] font-mono text-white/40 uppercase">Risk Tolerance Multiplier</label>
                      <span className="text-[10px] font-mono text-emerald-400">{config.risk_tolerance}x</span>
                    </div>
                    <input 
                      type="range" 
                      min="0.1" 
                      max="3.0" 
                      step="0.1"
                      value={config.risk_tolerance}
                      onChange={(e) => updateConfig('risk_tolerance', e.target.value)}
                      className="w-full h-1 bg-white/10 rounded-lg appearance-none cursor-pointer accent-emerald-500"
                    />
                    <div className="flex justify-between text-[8px] font-mono text-white/20 uppercase">
                      <span>Conservative</span>
                      <span>Aggressive</span>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <label className="text-[10px] font-mono text-white/40 uppercase">Profit Target (ROI)</label>
                      <span className="text-[10px] font-mono text-emerald-400">{((parseFloat(config?.profit_target || '1.1') - 1) * 100).toFixed(0)}%</span>
                    </div>
                    <input 
                      type="range" 
                      min="1.1" 
                      max="5.0" 
                      step="0.1"
                      value={config.profit_target}
                      onChange={(e) => updateConfig('profit_target', e.target.value)}
                      className="w-full h-1 bg-white/10 rounded-lg appearance-none cursor-pointer accent-emerald-500"
                    />
                    <div className="flex justify-between text-[8px] font-mono text-white/20 uppercase">
                      <span>10% (Scalp)</span>
                      <span>400% (Moonshot)</span>
                    </div>
                  </div>

                  <div className="p-3 bg-white/2 rounded-lg border border-white/5">
                    <p className="text-[8px] font-mono text-white/40 uppercase leading-relaxed">
                      * Risk Tolerance affects the position size of each trade.
                      * Profit Target sets the threshold for initial partial profit taking.
                    </p>
                  </div>
                </div>
              </Card>

              <Card title="Telegram Integration" icon={Bell}>
                <div className="space-y-4">
                  <div className="flex items-center justify-between p-4 bg-white/2 rounded-lg border border-white/5">
                    <div>
                      <h4 className="text-sm font-bold">Enable Alerts</h4>
                      <p className="text-xs text-white/40">Send real-time signals to Telegram</p>
                    </div>
                    <button 
                      onClick={() => updateConfig('alerts_enabled', config.alerts_enabled === 'true' ? 'false' : 'true')}
                      className={cn(
                        "w-12 h-6 rounded-full transition-all relative",
                        config.alerts_enabled === 'true' ? "bg-emerald-500" : "bg-white/10"
                      )}
                    >
                      <div className={cn(
                        "absolute top-1 w-4 h-4 rounded-full bg-white transition-all",
                        config.alerts_enabled === 'true' ? "left-7" : "left-1"
                      )} />
                    </button>
                  </div>

                  <div className="p-4 bg-indigo-500/10 border border-indigo-500/20 rounded-xl space-y-3">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-indigo-500 rounded-lg flex items-center justify-center">
                        <Send className="w-6 h-6 text-white" />
                      </div>
                      <div>
                        <h4 className="text-sm font-bold">Connect to Bot</h4>
                        <p className="text-[10px] font-mono text-indigo-400 uppercase">Official Bot</p>
                      </div>
                    </div>
                    <a 
                      href="https://t.me/degenics_bot"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block w-full py-2 bg-indigo-500 hover:bg-indigo-600 text-white text-center rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-2"
                    >
                      <Send className="w-3 h-3" />
                      Open Telegram Bot
                    </a>

                    <div className="space-y-2 pt-2 border-t border-indigo-500/20">
                      <label className="text-[10px] font-mono text-indigo-400 uppercase">Telegram Group ID</label>
                      <div className="flex gap-2">
                        <input 
                          type="text"
                          value={config.telegram_group_id || ''}
                          onChange={(e) => updateConfig('telegram_group_id', e.target.value)}
                          placeholder="-100..."
                          className="flex-1 bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-[10px] font-mono text-white focus:outline-none focus:border-indigo-500"
                        />
                      </div>
                      <p className="text-[8px] font-mono text-white/20 uppercase">
                        Add the bot to your group and use /config_group or paste the ID here to receive group alerts.
                      </p>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-[10px] font-mono text-white/40 uppercase">Telegram User ID</label>
                    <input 
                      type="text"
                      value={config.chat_id}
                      onChange={(e) => updateConfig('chat_id', e.target.value)}
                      className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2 text-sm focus:outline-none focus:border-emerald-500 transition-colors"
                      placeholder="Enter your Telegram User ID"
                    />
                    <p className="text-[8px] font-mono text-white/20 uppercase">
                      Get your ID from @userinfobot or by using the link above
                    </p>
                  </div>
                  <button 
                    onClick={async () => {
                      try {
                        const res = await fetch('/api/test/bot');
                        const data = await res.json();
                        if (data.success) {
                          alert(`Bot is online! Name: ${data.bot.first_name} (@${data.bot.username})`);
                        } else {
                          alert(`Bot Error: ${data.error}`);
                        }
                      } catch (err) {
                        alert('Failed to test bot connection.');
                      }
                    }}
                    className="w-full py-2 bg-white/5 hover:bg-white/10 text-white rounded-lg text-xs font-bold transition-all border border-white/10"
                  >
                    Test Bot Connection
                  </button>
                </div>
              </Card>

              <Card title="Database Health" icon={Database}>
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="p-4 bg-white/2 rounded-lg border border-white/5">
                      <p className="text-[10px] font-mono text-white/40 uppercase mb-1">Stored Tokens</p>
                      <h4 className="text-xl font-bold">{stats.totalCalls}</h4>
                    </div>
                    <div className="p-4 bg-white/2 rounded-lg border border-white/5">
                      <p className="text-[10px] font-mono text-white/40 uppercase mb-1">Neural Insights</p>
                      <h4 className="text-xl font-bold">{insights.length}</h4>
                    </div>
                  </div>
                  <div className="p-4 bg-emerald-500/5 border border-emerald-500/10 rounded-lg">
                    <p className="text-[10px] font-mono text-emerald-400 uppercase mb-2">Storage Status</p>
                    <div className="flex items-center justify-between text-[10px] font-mono">
                      <span className="text-white/40">Persistence:</span>
                      <span className="text-emerald-400">ACTIVE (SQLite)</span>
                    </div>
                    <div className="flex items-center justify-between text-[10px] font-mono mt-1">
                      <span className="text-white/40">Last Sync:</span>
                      <span className="text-white/60">{new Date().toLocaleTimeString()}</span>
                    </div>
                  </div>
                  <button 
                    onClick={fetchData}
                    className="w-full py-2 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-[10px] font-mono uppercase transition-all"
                  >
                    Force Database Sync
                  </button>
                  <button 
                    onClick={async () => {
                      try {
                        const res = await fetch('/api/simulate-token', { method: 'POST' });
                        if (res.ok) {
                          alert('Simulation triggered! Check the Live Feed.');
                          fetchData();
                        }
                      } catch (e) {
                        console.error(e);
                      }
                    }}
                    className="w-full py-2 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/20 rounded-lg text-[10px] font-mono uppercase text-emerald-400 transition-all mt-2"
                  >
                    Simulate Token Detection
                  </button>
                </div>
              </Card>

              <Card title="Filter Parameters" icon={Target}>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2 col-span-2">
                    <label className="text-[10px] font-mono text-white/40 uppercase">Scanned Chains (None = All)</label>
                    <div className="flex flex-wrap gap-2">
                      {['solana', 'ethereum', 'base', 'bsc', 'arbitrum', 'polygon', 'optimism', 'avalanche'].map((chain) => {
                        const selectedChains = config.scanned_chains ? config.scanned_chains.split(',') : [];
                        const isSelected = selectedChains.includes(chain);
                        return (
                          <button
                            key={chain}
                            onClick={() => {
                              let next;
                              if (isSelected) {
                                next = selectedChains.filter(c => c !== chain);
                              } else {
                                next = [...selectedChains, chain];
                              }
                              updateConfig('scanned_chains', next.join(','));
                            }}
                            className={cn(
                              "px-3 py-1.5 rounded-lg text-[10px] font-mono uppercase border transition-all",
                              isSelected 
                                ? "bg-emerald-500/10 border-emerald-500 text-emerald-400" 
                                : "bg-white/5 border-white/10 text-white/40 hover:border-white/20"
                            )}
                          >
                            {chain}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-mono text-white/40 uppercase">Min Boost</label>
                    <select 
                      value={config.min_boost}
                      onChange={(e) => updateConfig('min_boost', e.target.value)}
                      className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2 text-sm focus:outline-none focus:border-emerald-500 transition-colors"
                    >
                      <option value="150">150x</option>
                      <option value="200">200x</option>
                      <option value="500">500x</option>
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-mono text-white/40 uppercase">Min Nana Score</label>
                    <input 
                      type="number"
                      value={config.min_nana_score}
                      onChange={(e) => updateConfig('min_nana_score', e.target.value)}
                      className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2 text-sm focus:outline-none focus:border-emerald-500 transition-colors"
                    />
                  </div>
                  <div className="space-y-2 col-span-2">
                    <label className="text-[10px] font-mono text-white/40 uppercase">Risk Mode</label>
                    <div className="grid grid-cols-3 gap-2">
                      {['strict', 'balanced', 'aggressive'].map((mode) => (
                        <button
                          key={mode}
                          onClick={() => updateConfig('risk_mode', mode)}
                          className={cn(
                            "py-2 rounded-lg text-[10px] font-mono uppercase border transition-all",
                            config.risk_mode === mode 
                              ? "bg-emerald-500/10 border-emerald-500 text-emerald-400" 
                              : "bg-white/5 border-white/10 text-white/40 hover:border-white/20"
                          )}
                        >
                          {mode}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="mt-6 pt-6 border-t border-white/5 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {saveSuccess && (
                      <motion.div 
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        className="flex items-center gap-2 text-emerald-400 text-[10px] font-mono uppercase"
                      >
                        <CheckCircle2 className="w-3 h-3" />
                        Settings Applied & Bot Synced
                      </motion.div>
                    )}
                  </div>
                  <button
                    onClick={saveAllConfig}
                    disabled={isSavingConfig}
                    className={cn(
                      "px-6 py-2 rounded-lg text-[10px] font-mono uppercase font-bold transition-all flex items-center gap-2",
                      isSavingConfig 
                        ? "bg-white/5 text-white/20 cursor-not-allowed" 
                        : "bg-emerald-500 text-black hover:bg-emerald-400 shadow-lg shadow-emerald-500/20"
                    )}
                  >
                    {isSavingConfig ? (
                      <RefreshCw className="w-3 h-3 animate-spin" />
                    ) : (
                      <Save className="w-3 h-3" />
                    )}
                    {isSavingConfig ? "Applying..." : "Confirm & Apply Changes"}
                  </button>
                </div>
              </Card>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <div className="w-16 h-16 bg-white/5 rounded-full flex items-center justify-center mb-6 border border-white/10">
                <Lock className="w-8 h-8 text-white/20" />
              </div>
              <h3 className="text-xl font-bold mb-2">Configuration Locked</h3>
              <p className="text-white/40 max-w-sm mb-8">
                Bot configuration and Telegram integration are restricted to registered users.
              </p>
              <button 
                onClick={() => {
                  setAuthMode('signup');
                  setShowAuthModal(true);
                }}
                className="px-8 py-3 bg-emerald-500 hover:bg-emerald-600 rounded-xl font-bold transition-all shadow-lg shadow-emerald-500/20"
              >
                Sign Up Now
              </button>
            </div>
          )
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-white/5 py-8 mt-12">
        <div className="max-w-[1600px] mx-auto px-6 flex items-center justify-between">
          <div className="flex items-center gap-4 text-[10px] font-mono text-white/20 uppercase tracking-widest">
            <span>© 2026 Degenics Angel</span>
            <span className="w-1 h-1 bg-white/10 rounded-full" />
            <span>Neural Rug Detection Engine</span>
          </div>
          <div className="flex gap-6">
            <a href="#" className="text-[10px] font-mono text-white/20 hover:text-white/60 uppercase transition-colors">Documentation</a>
            <a href="#" className="text-[10px] font-mono text-white/20 hover:text-white/60 uppercase transition-colors">API Status</a>
            <a href="#" className="text-[10px] font-mono text-white/20 hover:text-white/60 uppercase transition-colors">Twitter</a>
          </div>
        </div>
      </footer>
      {/* Auth Modal */}
      <AnimatePresence>
        {showAuthModal && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowAuthModal(false)}
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-md bg-[#151619] border border-white/10 rounded-2xl p-8 shadow-2xl"
            >
              <h2 className="text-2xl font-bold tracking-tighter mb-2">
                {authMode === 'login' ? 'Welcome Back' : 'Create Account'}
              </h2>
              <p className="text-sm text-white/40 mb-6">
                {authMode === 'login' ? 'Sign in to access your saved calls and history.' : 'Join the Angel network to monitor the trenches.'}
              </p>

              <form onSubmit={handleAuth} className="space-y-4">
                <div className="space-y-2">
                  <label className="text-[10px] font-mono text-white/40 uppercase">Email Address</label>
                  <input 
                    type="email"
                    required
                    value={authEmail}
                    onChange={(e) => setAuthEmail(e.target.value)}
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2 text-sm focus:outline-none focus:border-emerald-500 transition-colors"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-[10px] font-mono text-white/40 uppercase">Password</label>
                  <input 
                    type="password"
                    required
                    value={authPassword}
                    onChange={(e) => setAuthPassword(e.target.value)}
                    className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2 text-sm focus:outline-none focus:border-emerald-500 transition-colors"
                  />
                </div>

                {authError && (
                  <p className="text-xs text-rose-400 font-mono">{authError}</p>
                )}

                <button 
                  type="submit"
                  className="w-full py-3 bg-emerald-500 text-black font-bold rounded-lg hover:bg-emerald-400 transition-all"
                >
                  {authMode === 'login' ? 'Sign In' : 'Sign Up'}
                </button>
              </form>

              <div className="mt-6 pt-6 border-t border-white/5 text-center">
                <button 
                  onClick={() => setAuthMode(authMode === 'login' ? 'signup' : 'login')}
                  className="text-xs text-white/40 hover:text-white transition-colors"
                >
                  {authMode === 'login' ? "Don't have an account? Sign Up" : "Already have an account? Sign In"}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
