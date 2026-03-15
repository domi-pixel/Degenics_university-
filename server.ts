import express from "express";
import { createServer as createViteServer } from "vite";
import Database from "better-sqlite3";
import TelegramBot from "node-telegram-bot-api";
import axios from "axios";
import crypto from "crypto";
import path from "path";
import { formatDistanceToNow } from "date-fns";

// --- Database Setup ---
const db = new Database("degenics.db");

// Initialize tables
db.exec(`
  CREATE TABLE IF NOT EXISTS tokens (
    id TEXT PRIMARY KEY,
    symbol TEXT,
    name TEXT,
    chain TEXT,
    address TEXT,
    boost_level REAL,
    liquidity REAL,
    buy_pressure REAL,
    nana_score REAL,
    rug_risk_score REAL,
    insider_probability REAL,
    wallet_risk REAL,
    market_cap REAL,
    cto_status INTEGER,
    call_price REAL,
    current_price REAL,
    ath_price REAL,
    ath_timestamp INTEGER,
    created_at INTEGER,
    status TEXT DEFAULT 'active',
    sentiment_score REAL DEFAULT 50,
    dev_activity_score REAL DEFAULT 50,
    ai_rug_verdict TEXT,
    ai_rug_risk_level TEXT,
    ai_social_verdict TEXT,
    dev_is_selling INTEGER DEFAULT 0,
    volume_velocity REAL DEFAULT 0,
    last_security_check INTEGER DEFAULT 0,
    website TEXT,
    twitter TEXT,
    raw_risks TEXT
  );
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS rugs (
    address TEXT PRIMARY KEY,
    reason TEXT,
    wallets TEXT, -- JSON array of associated wallets
    timestamp INTEGER
  );

  CREATE TABLE IF NOT EXISTS config (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS user_config (
    user_id TEXT,
    key TEXT,
    value TEXT,
    PRIMARY KEY (user_id, key)
  );

  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE,
    password TEXT,
    created_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS learned_patterns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pattern_type TEXT, -- e.g., 'high_roi_boost', 'low_risk_mint'
    insight TEXT,
    weight_adjustment REAL,
    timestamp INTEGER
  );

  CREATE TABLE IF NOT EXISTS simulation_trades (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token_id TEXT,
    chain TEXT,
    type TEXT, -- 'buy', 'sell', 'buyback'
    amount_usd REAL,
    price REAL,
    tokens_amount REAL,
    profit_usd REAL DEFAULT 0,
    timestamp INTEGER,
    reason TEXT
  );

  CREATE TABLE IF NOT EXISTS simulation_balance (
    chain TEXT PRIMARY KEY,
    balance REAL DEFAULT 100,
    last_funding_timestamp INTEGER
  );

  CREATE TABLE IF NOT EXISTS user_actions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    action_type TEXT, -- 'manual_buy', 'manual_sell'
    token_id TEXT,
    amount_usd REAL,
    percentage REAL,
    timestamp INTEGER
  );

  CREATE TABLE IF NOT EXISTS monitored_wallets (
    address TEXT PRIMARY KEY,
    label TEXT,
    last_activity INTEGER
  );

  CREATE TABLE IF NOT EXISTS neural_weights (
    factor TEXT PRIMARY KEY,
    weight REAL,
    last_updated INTEGER
  );
`);

// Migration for existing databases
try {
  db.exec("ALTER TABLE tokens ADD COLUMN insider_probability REAL DEFAULT 0");
} catch (e) {}
try {
  db.exec("ALTER TABLE tokens ADD COLUMN wallet_risk REAL DEFAULT 0");
} catch (e) {}
try {
  db.exec("ALTER TABLE tokens ADD COLUMN market_cap REAL DEFAULT 0");
} catch (e) {}
try {
  db.exec("ALTER TABLE tokens ADD COLUMN sentiment_score REAL DEFAULT 50");
} catch (e) {}
try {
  db.exec("ALTER TABLE tokens ADD COLUMN dev_activity_score REAL DEFAULT 50");
} catch (e) {}
try {
  db.exec("ALTER TABLE tokens ADD COLUMN ai_rug_verdict TEXT");
} catch (e) {}
try {
  db.exec("ALTER TABLE tokens ADD COLUMN ai_rug_risk_level TEXT");
} catch (e) {}
try {
  db.exec("ALTER TABLE tokens ADD COLUMN last_security_check INTEGER DEFAULT 0");
} catch (e) {}
try {
  db.exec("ALTER TABLE tokens ADD COLUMN website TEXT");
} catch (e) {}
try {
  db.exec("ALTER TABLE tokens ADD COLUMN twitter TEXT");
} catch (e) {}
try {
  db.exec("ALTER TABLE tokens ADD COLUMN raw_risks TEXT");
} catch (e) {}

try {
  db.exec("ALTER TABLE tokens ADD COLUMN dev_is_selling INTEGER DEFAULT 0");
} catch (e) {}

try {
  db.exec("ALTER TABLE tokens ADD COLUMN volume_velocity REAL DEFAULT 0");
} catch (e) {}

// Default config
const setConfig = db.prepare("INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)");
const getConfig = db.prepare("SELECT value FROM config WHERE key = ?");

const setUserConfig = db.prepare("INSERT OR REPLACE INTO user_config (user_id, key, value) VALUES (?, ?, ?)");
const getUserConfig = db.prepare("SELECT value FROM user_config WHERE user_id = ? AND key = ?");
const getAllUserConfigs = db.prepare("SELECT key, value FROM user_config WHERE user_id = ?");

const defaultConfig = {
  telegram_token: "",
  chat_id: "",
  alerts_enabled: "true",
  scanning_active: "true",
  scanned_chains: "solana,ethereum,base", // Default to common chains
  min_boost: "10",
  min_nana_score: "55", // Lowered from 65 for better demo experience
  min_liquidity: "1000", // Lowered from 10000
  risk_mode: "balanced",
  risk_tolerance: "1.0", // Multiplier for risk percentage
  profit_target: "1.3", // ROI threshold for initial profit taking (e.g., 1.3 = 30%)
  ai_provider: "gemini",
  ai_switch_mode: "auto"
};

const defaultWeights = {
  volume: 0.15,
  buy_pressure: 15,
  liquidity: 0.1,
  rug_risk: 0.2,
  social: 0.2,
  insider: 0.2,
  learned: 100
};

Object.entries(defaultConfig).forEach(([key, value]) => {
  if (!getConfig.get(key)) {
    setConfig.run(key, value);
  }
});

const setWeight = db.prepare("INSERT OR REPLACE INTO neural_weights (factor, weight, last_updated) VALUES (?, ?, ?)");
const getWeight = db.prepare("SELECT weight FROM neural_weights WHERE factor = ?");

Object.entries(defaultWeights).forEach(([factor, weight]) => {
  if (!getWeight.get(factor)) {
    setWeight.run(factor, weight, Date.now());
  }
});

// --- Telegram Bot ---
const BOT_TOKEN = process.env.TELEGRAM_TOKEN || "";
let bot: TelegramBot | null = null;
let isInitializingBot = false;

async function initBot() {
  if (isInitializingBot) return;
  isInitializingBot = true;

  const configToken = getConfig.get("telegram_token")?.value;
  const tokenToUse = configToken || BOT_TOKEN;
  const enabled = !!tokenToUse;

  // Stop existing bot if it exists
  if (bot) {
    try {
      console.log("Stopping existing Telegram bot instance...");
      await bot.stopPolling();
      bot = null;
      // Give it a moment to settle
      await new Promise(resolve => setTimeout(resolve, 1000));
    } catch (e: any) {
      console.error("Error stopping bot:", e.message);
    }
  }

  if (enabled) {
    try {
      console.log(`Initializing Telegram Bot with token: ${tokenToUse.substring(0, 5)}...`);
      // Create bot without polling first to clear state
      const tempBot = new TelegramBot(tokenToUse);
      await tempBot.deleteWebHook().catch(e => console.warn("Delete webhook failed:", e.message));
      
      bot = new TelegramBot(tokenToUse, { polling: true });
      const botMe = await bot.getMe();
      const botUsername = botMe.username;
      console.log(`Telegram Bot Polling Started for @${botUsername}`);
      console.log("Telegram Bot Initialized");

      bot.onText(/\/start(@\w+)?/, (msg) => {
        const welcome = `
👼 *DEGENICS ANGEL Activated.* Monitoring the trenches...

Your Telegram User ID: \`${msg.chat.id}\`
(Copy this into the Degenics App Config to receive alerts)

Use /commands to see what I can do.
        `;
        bot?.sendMessage(msg.chat.id, welcome, { parse_mode: "Markdown" });
      });

      bot.onText(/\/chatid(@\w+)?/, (msg) => {
        bot?.sendMessage(msg.chat.id, `Your Telegram User ID: \`${msg.chat.id}\``, { parse_mode: "Markdown" });
      });

      bot.onText(/\/testalert(@\w+)?/, (msg) => {
        bot?.sendMessage(msg.chat.id, "🔔 *Degenics Alert Test:* Connection successful! You are now receiving signals.", { parse_mode: "Markdown" });
      });

      bot.onText(/\/setgroup(@\w+)?/, (msg) => {
        const chatId = msg.chat.id.toString();
        try {
          setConfig.run("chat_id", chatId);
          setConfig.run("alerts_enabled", "true");
          bot?.sendMessage(msg.chat.id, `✅ *Group Linked:* This group (ID: \`${chatId}\`) is now the primary alert channel.`, { parse_mode: "Markdown" });
        } catch (e: any) {
          bot?.sendMessage(msg.chat.id, "❌ *Error:* Failed to link group. Please check dashboard.");
        }
      });

      bot.on('message', (msg) => {
        // Handle being added to a group
        if (msg.new_chat_members) {
          const isBotAdded = msg.new_chat_members.some(member => member.username === botUsername);
          if (isBotAdded) {
            const chatId = msg.chat.id.toString();
            
            // Automatically update global config
            try {
              setConfig.run("chat_id", chatId);
              setConfig.run("alerts_enabled", "true");
              
              bot?.sendMessage(msg.chat.id, `👼 *DEGENICS ANGEL* has joined the trench!
            
✅ *Auto-Configuration Successful*
This group (ID: \`${chatId}\`) has been automatically linked to your Degenics Dashboard. 

Signals and trade updates will now stream here in real-time.

Use /commands to see what I can do.`, { parse_mode: "Markdown" });
              
              console.log(`[Telegram] Auto-configured global chat ID to: ${chatId}`);
            } catch (e: any) {
              console.error(`[Telegram] Failed to auto-configure chat ID: ${e.message}`);
              bot?.sendMessage(msg.chat.id, "👼 *DEGENICS ANGEL* joined, but I encountered an error during auto-configuration. Please manually set the Chat ID in the dashboard.");
            }
          }
        }
      });

      bot.onText(/\/learn\s+(\w+)\s+(.+)/, async (msg, match) => {
        const address = match?.[1];
        const reason = match?.[2] || "Manual ingestion";
        
        if (!address) {
          bot?.sendMessage(msg.chat.id, "❌ *Error:* Please provide a token address. Usage: `/learn <address> <reason>`", { parse_mode: "Markdown" });
          return;
        }

        bot?.sendMessage(msg.chat.id, `🧠 *Neural Engine:* Analyzing ${address}...`, { parse_mode: "Markdown" });

        try {
          const pair = await fetchTokenDetails(address);
          if (!pair) {
            bot?.sendMessage(msg.chat.id, "❌ *Error:* Could not fetch token details from DexScreener.");
            return;
          }

          // Check if token already in DB
          let token = db.prepare("SELECT * FROM tokens WHERE address = ?").get(address) as any;
          if (!token) {
            // Insert temporary token for learning
            const id = `${pair.chainId}-${address}`;
            db.prepare("INSERT INTO tokens (id, symbol, name, chain, address, nana_score, buy_pressure, volume_velocity, insider_probability, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
              .run(id, pair.baseToken.symbol, pair.baseToken.name, pair.chainId, address, 80, 0.8, 50, 5, Date.now());
            token = db.prepare("SELECT * FROM tokens WHERE address = ?").get(address);
          }

          await learnFromSuccess(token.id, pair.baseToken.symbol, pair.chainId, reason);
          bot?.sendMessage(msg.chat.id, `✅ *Learning Complete:* Pattern for ${pair.baseToken.symbol} has been integrated into the Neural Engine.`, { parse_mode: "Markdown" });
        } catch (e: any) {
          bot?.sendMessage(msg.chat.id, `❌ *Error:* ${e.message}`);
        }
      });

      bot.onText(/\/sell\s+(\w+)/, async (msg, match) => {
        const chatId = msg.chat.id;
        const symbol = match![1].toUpperCase();
        
        try {
          const trade = db.prepare(`
            SELECT tk.id as token_id, tk.symbol, tk.current_price,
                   SUM(CASE WHEN t.type IN ('buy', 'buyback') THEN t.tokens_amount ELSE -t.tokens_amount END) as remaining_tokens,
                   AVG(CASE WHEN t.type IN ('buy', 'buyback') THEN t.price ELSE NULL END) as avg_buy_price,
                   tk.chain
            FROM tokens tk
            JOIN simulation_trades t ON tk.id = t.token_id
            WHERE tk.symbol = ?
            GROUP BY tk.id
            HAVING remaining_tokens > 0.000001
          `).get(symbol) as any;

          if (!trade) {
            bot.sendMessage(chatId, `❌ No active simulation trade found for ${symbol}`);
            return;
          }

          const currentPrice = trade.current_price;
          const tokensToSell = trade.remaining_tokens;
          const sellAmountUsd = tokensToSell * currentPrice;
          const costBasis = trade.avg_buy_price * tokensToSell;
          const profitUsd = sellAmountUsd - costBasis;
          const roi = currentPrice / trade.avg_buy_price;

          db.prepare("INSERT INTO simulation_trades (token_id, chain, type, amount_usd, price, tokens_amount, profit_usd, timestamp, reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
            .run(trade.token_id, trade.chain, 'sell', sellAmountUsd, currentPrice, tokensToSell, profitUsd, Date.now(), "Manual User Sell");

          db.prepare("UPDATE simulation_balance SET balance = balance + ? WHERE chain = ?").run(sellAmountUsd, trade.chain);

          // Learn from user pattern
          await learnFromSuccess(trade.token_id, trade.symbol, trade.chain, "Manual User Sell (Pattern Learning)");

          const profitPercent = ((roi - 1) * 100).toFixed(1);
          const emoji = profitUsd >= 0 ? '💰' : '📉';
          
          bot.sendMessage(chatId, `${emoji} *MANUAL SELL EXECUTED:* ${symbol}
ROI: ${profitPercent}% ($${profitUsd.toFixed(2)})
Reason: User manual intervention. Bot is learning from this pattern.`);
          
        } catch (e: any) {
          bot.sendMessage(chatId, `❌ Error executing manual sell: ${e.message}`);
        }
      });

      bot.onText(/\/commands(@\w+)?|\/help(@\w+)?/, (msg) => {
        const helpText = `
👼 *DEGENICS ANGEL COMMANDS*

/status - Check system health and scanning state
/performance - View win rate and ROI stats
/top - See top 5 tokens by Nana Score
/recent - View the 5 most recent signals
/filters - View current scanning parameters
/insights - View latest AI learned patterns
/learn <address> <reason> - Ingest a successful token for pattern learning
/chatid - Get your Telegram User ID
/testalert - Test your alert connection
/set_risk <val> - Set risk tolerance (0.1 - 3.0)
/set_profit <val> - Set profit target ROI (1.1 - 5.0)
/pause - Pause the scanning engine
/resume - Resume the scanning engine
/commands - Show this list
        `;
        bot?.sendMessage(msg.chat.id, helpText, { parse_mode: "Markdown" });
      });

      bot.onText(/\/pause(@\w+)?/, (msg) => {
        setConfig.run("scanning_active", "false");
        bot?.sendMessage(msg.chat.id, "⏸️ *Scanning PAUSED.* The Angel is resting.", { parse_mode: "Markdown" });
      });

      bot.onText(/\/resume(@\w+)?/, (msg) => {
        setConfig.run("scanning_active", "true");
        bot?.sendMessage(msg.chat.id, "▶️ *Scanning RESUMED.* Monitoring the trenches...", { parse_mode: "Markdown" });
      });

      bot.onText(/\/insights(@\w+)?/, (msg) => {
        const insights = db.prepare("SELECT insight FROM learned_patterns ORDER BY timestamp DESC LIMIT 3").all() as any[];
        const weights = db.prepare("SELECT factor, weight FROM neural_weights").all() as any[];
        
        let text = "🧠 *NEURAL ENGINE INSIGHTS:*\n\n";
        
        text += "*Current Factor Weights:*\n";
        weights.forEach(w => {
          text += `• ${w.factor}: ${w.weight.toFixed(3)}\n`;
        });
        
        text += "\n*Latest Patterns Learned:*\n";
        if (insights.length === 0) text += "No patterns learned yet. Need more data.";
        insights.forEach((ins, i) => {
          text += `• ${ins.insight}\n`;
        });
        bot?.sendMessage(msg.chat.id, text, { parse_mode: "Markdown" });
      });

      bot.onText(/\/status(@\w+)?/, (msg) => {
        const active = getConfig.get("scanning_active") ? getConfig.get("scanning_active").value === "true" : true;
        const chains = getConfig.get("scanned_chains") ? getConfig.get("scanned_chains").value || "All" : "All";
        bot?.sendMessage(msg.chat.id, `System Status: ONLINE\nScanning: ${active ? "ACTIVE ▶️" : "PAUSED ⏸️"}\nChains: ${chains}`);
      });

      bot.onText(/\/filters(@\w+)?/, (msg) => {
        const minBoost = getConfig.get("min_boost")?.value;
        const minScore = getConfig.get("min_nana_score")?.value;
        const minLiq = getConfig.get("min_liquidity")?.value;
        bot?.sendMessage(msg.chat.id, `Current Filters:\n- Min Boost: ${minBoost}x\n- Min Nana Score: ${minScore}\n- Min Liquidity: $${minLiq}`);
      });

      bot.onText(/\/performance(@\w+)?/, (msg) => {
        const total = db.prepare("SELECT COUNT(*) as count FROM tokens").get() as any;
        const explosive = db.prepare("SELECT COUNT(*) as count FROM tokens WHERE ath_price / call_price >= 5").get() as any;
        const winners = db.prepare("SELECT COUNT(*) as count FROM tokens WHERE ath_price / call_price >= 2").get() as any;
        const winRate = total.count > 0 ? ((winners.count / total.count) * 100).toFixed(1) : "0";
        bot?.sendMessage(msg.chat.id, `📊 *Performance Stats:*\n- Total Calls: ${total.count}\n- Winners (2x+): ${winners.count}\n- Explosive (5x+): ${explosive.count}\n- Win Rate: ${winRate}%`, { parse_mode: "Markdown" });
      });

      bot.onText(/\/top(@\w+)?/, (msg) => {
        const top = db.prepare("SELECT symbol, nana_score, ath_price/call_price as roi FROM tokens ORDER BY nana_score DESC LIMIT 5").all() as any[];
        let text = "🏆 *Top 5 Tokens (Nana Score):*\n\n";
        top.forEach((t, i) => {
          text += `${i+1}. ${t.symbol} - Score: ${t.nana_score.toFixed(1)} (Max: ${t.roi.toFixed(2)}x)\n`;
        });
        bot?.sendMessage(msg.chat.id, text, { parse_mode: "Markdown" });
      });

      bot.onText(/\/recent(@\w+)?/, (msg) => {
        const recent = db.prepare("SELECT symbol, nana_score, created_at FROM tokens ORDER BY created_at DESC LIMIT 5").all() as any[];
        let text = "🕒 *Recent 5 Calls:*\n\n";
        recent.forEach((t) => {
          const time = new Date(t.created_at).toLocaleTimeString();
          text += `- ${t.symbol} [${time}] - Score: ${t.nana_score.toFixed(1)}\n`;
        });
        bot?.sendMessage(msg.chat.id, text, { parse_mode: "Markdown" });
      });

      bot.onText(/\/help(@\w+)?/, (msg) => {
        const help = `
👼 *DEGENICS ANGEL COMMANDS*

/status - System health check
/filters - View current scan filters
/performance - Win rate and hit stats
/top - Highest rated tokens
/recent - Last 5 signals
/set_boost <val> - Update min boost (e.g. /set_boost 50)
/set_score <val> - Update min score (e.g. /set_score 75)
/set_risk <val> - Update risk tolerance (0.1 - 3.0)
/set_profit <val> - Update profit target ROI (1.1 - 5.0)
/help - Show this menu
        `;
        bot?.sendMessage(msg.chat.id, help, { parse_mode: "Markdown" });
      });

      bot.onText(/\/set_boost(@\w+)? (\d+)/, (msg, match) => {
        const val = match?.[2];
        if (val) {
          setConfig.run("min_boost", val);
          bot?.sendMessage(msg.chat.id, `✅ Min Boost updated to: ${val}x`);
        }
      });

      bot.onText(/\/set_score(@\w+)? (\d+)/, (msg, match) => {
        const val = match?.[2];
        if (val) {
          setConfig.run("min_nana_score", val);
          bot?.sendMessage(msg.chat.id, `✅ Min Nana Score updated to: ${val}`);
        }
      });

      bot.onText(/\/set_risk(@\w+)? ([\d.]+)/, (msg, match) => {
        const val = match?.[2];
        if (val) {
          const num = parseFloat(val);
          if (num >= 0.1 && num <= 3.0) {
            setConfig.run("risk_tolerance", val);
            bot?.sendMessage(msg.chat.id, `✅ Risk Tolerance updated to: ${val}x`);
          } else {
            bot?.sendMessage(msg.chat.id, "❌ Invalid value. Use 0.1 to 3.0");
          }
        }
      });

      bot.onText(/\/set_profit(@\w+)? ([\d.]+)/, (msg, match) => {
        const val = match?.[2];
        if (val) {
          const num = parseFloat(val);
          if (num >= 1.1 && num <= 5.0) {
            setConfig.run("profit_target", val);
            bot?.sendMessage(msg.chat.id, `✅ Profit Target updated to: ${val} ROI (${((num-1)*100).toFixed(0)}%)`);
          } else {
            bot?.sendMessage(msg.chat.id, "❌ Invalid value. Use 1.1 to 5.0");
          }
        }
      });

      bot.on('polling_error', (error: any) => {
        if (error.message.includes("409 Conflict")) {
          console.error(`[Telegram Conflict] 409: ${error.message}. Another instance is active.`);
        } else {
          console.error(`[Telegram Polling Error] ${error.code}: ${error.message}`);
        }
      });
    } catch (e) {
      console.error("Failed to init Telegram Bot", e);
    }
  } else {
    bot = null;
  }
  
  isInitializingBot = false;
}

initBot();

// --- Helpers ---
function formatCurrency(value: number): string {
  if (value >= 1000000) {
    return `${(value / 1000000).toFixed(1).replace(/\.0$/, '')}m$`;
  }
  if (value >= 1000) {
    return `${(value / 1000).toFixed(1).replace(/\.0$/, '')}k$`;
  }
  return `${value.toFixed(2)}$`;
}

async function broadcastToTelegram(message: string, options: any = {}) {
  if (!bot) {
    console.warn("[Telegram Broadcast] Bot not initialized, skipping message.");
    return;
  }
  
  const chatIdsToNotify = new Set<string>();

  // 1. Add registered users who have alerts enabled
  const users = db.prepare("SELECT id FROM users").all() as any[];
  for (const user of users) {
    const userAlertsEnabled = getUserConfig.get(user.id, "alerts_enabled")?.value || getConfig.get("alerts_enabled")?.value;
    if (userAlertsEnabled === "true") {
      const userChatId = getUserConfig.get(user.id, "chat_id")?.value || getConfig.get("chat_id")?.value;
      if (userChatId) chatIdsToNotify.add(userChatId);
    }
  }

  // 2. Add global chat ID if alerts are enabled globally
  const globalAlertsEnabled = getConfig.get("alerts_enabled")?.value === "true";
  const globalChatId = getConfig.get("chat_id")?.value;
  if (globalAlertsEnabled && globalChatId) {
    chatIdsToNotify.add(globalChatId);
  }

  if (chatIdsToNotify.size === 0) {
    console.log("[Telegram Broadcast] No active chat IDs found to notify.");
  }

  for (const chatId of chatIdsToNotify) {
    console.log(`[Telegram Broadcast] Sending message to ${chatId}`);
    try {
      await bot.sendMessage(chatId, message, { parse_mode: "Markdown", ...options });
    } catch (e) {
      console.error(`[Telegram Broadcast] Error sending to chat ID ${chatId}:`, e.message);
    }
  }
}

// --- Neural Learning Engine (Advanced) ---
async function runNeuralEngine() {
  console.log(`[${new Date().toISOString()}] 🧠 Neural Engine: Starting adaptation cycle...`);
  try {
    const allTokens = db.prepare("SELECT * FROM tokens").all() as any[];
    if (allTokens.length < 5) {
      console.log("🧠 [Neural Engine] Insufficient data for adaptation (need at least 5 tokens).");
      return;
    }

    const winners = allTokens.filter(t => (t.ath_price / t.call_price) >= 1.5); // Lowered threshold for learning
    const losers = allTokens.filter(t => (t.ath_price / t.call_price) < 1.1);

    console.log(`🧠 [Neural Engine] Analyzing ${winners.length} winners and ${losers.length} losers.`);

    if (winners.length > 0) {
      const avgWinnerRug = winners.reduce((acc, t) => acc + t.rug_risk_score, 0) / winners.length;
      const avgLoserRug = losers.length > 0 ? losers.reduce((acc, t) => acc + t.rug_risk_score, 0) / losers.length : 100;
      
      const avgWinnerLiq = winners.reduce((acc, t) => acc + t.liquidity, 0) / winners.length;
      const avgLoserLiq = losers.length > 0 ? losers.reduce((acc, t) => acc + t.liquidity, 0) / losers.length : 0;

      const avgWinnerInsider = winners.reduce((acc, t) => acc + t.insider_probability, 0) / winners.length;
      const avgLoserInsider = losers.length > 0 ? losers.reduce((acc, t) => acc + t.insider_probability, 0) / losers.length : 100;

      let adjustments: string[] = [];

      // Safety Adaptation: If winners have significantly lower rug risk than losers
      if (avgWinnerRug < avgLoserRug * 0.8) {
        const curr = getWeight.get("rug_risk")?.weight || 0.2;
        const next = Math.min(0.5, curr * 1.05);
        setWeight.run("rug_risk", next, Date.now());
        adjustments.push(`Increased Rug Risk sensitivity to ${next.toFixed(3)}`);
      }

      // Liquidity Adaptation: If winners have higher liquidity
      if (avgWinnerLiq > avgLoserLiq * 1.2) {
        const curr = getWeight.get("liquidity")?.weight || 0.1;
        const next = Math.min(0.3, curr * 1.05);
        setWeight.run("liquidity", next, Date.now());
        adjustments.push(`Increased Liquidity importance to ${next.toFixed(3)}`);
      }

      // Insider Adaptation: If winners have lower insider prob
      if (avgWinnerInsider < avgLoserInsider * 0.8) {
        const curr = getWeight.get("insider")?.weight || 0.2;
        const next = Math.min(0.5, curr * 1.05);
        setWeight.run("insider", next, Date.now());
        adjustments.push(`Increased Insider penalty to ${next.toFixed(3)}`);
      }

      if (adjustments.length > 0) {
        const insight = `Neural Adaptation: ${adjustments.join(" | ")}`;
        db.prepare("INSERT INTO learned_patterns (pattern_type, insight, weight_adjustment, timestamp) VALUES (?, ?, ?, ?)")
          .run('neural_adaptation', insight, 1.0, Date.now());
        console.log(`🧠 [Neural Engine] ${insight}`);
        
        broadcastToTelegram(`🧠 *NEURAL ENGINE ADAPTED:*
The Angel has analyzed recent trades and refined its scoring weights for better accuracy.

*Adjustments:*
${adjustments.map(a => `• ${a}`).join("\n")}`);
      } else {
        console.log("🧠 [Neural Engine] No significant patterns detected for weight adjustment.");
      }
    }
  } catch (e) {
    console.error("🧠 [Neural Engine] Error:", e.message);
  }
}

// Consolidate learning functions
async function analyzePerformanceAndLearn() {
  return runNeuralEngine();
}

// --- Real Data Integration (DexScreener + RugCheck) ---

async function fetchTokenDetails(address: string) {
  try {
    const response = await axios.get(`https://api.dexscreener.com/latest/dex/tokens/${address}`);
    return response.data.pairs?.[0] || null;
  } catch (e) {
    console.error(`Error fetching details for ${address}:`, e.message);
    return null;
  }
}

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function checkRugRisk(address: string, chain: string) {
  const cleanAddress = address.trim();
  if (chain !== 'solana') return { score: 50, risks: [], aiVerdict: "Only Solana Supported", riskLevel: "UNKNOWN" };
  let apiKey = process.env.RUGCHECK_API_KEY;
  
  if (!apiKey) {
    return { score: 50, risks: [], aiVerdict: "RugCheck API Key Missing", riskLevel: "UNKNOWN" };
  }

  const tryRequest = async (headers: any) => {
    return await axios.get(`https://api.rugcheck.xyz/v1/tokens/${cleanAddress}/report`, { 
      headers, 
      timeout: 10000 
    });
  };

  // Strategy: Try Bearer -> Try Direct -> Try X-API-Key -> Try Public
  const authAttempts = [
    { 'Authorization': `Bearer ${apiKey}` },
    { 'Authorization': apiKey },
    { 'X-API-Key': apiKey },
    {} // Public fallback
  ];

  for (const headers of authAttempts) {
    let retries = 0;
    const maxRetries = 2;

    while (retries <= maxRetries) {
      try {
        const response = await tryRequest(headers);
        const risks = response.data.risks || [];
        const score = response.data.score || 0;
        
        return {
          score: score,
          risks: risks,
          aiVerdict: "Pending Neural Analysis",
          riskLevel: "PENDING"
        };
      } catch (e: any) {
        const status = e.response?.status;
        
        if (status === 429) {
          console.log(`[${new Date().toISOString()}] ⚠️ RugCheck Rate Limited (429). Waiting 2s... (Attempt ${retries + 1})`);
          await delay(2000 * (retries + 1)); // Exponential backoff
          retries++;
          continue;
        }
        
        if (status === 401) {
          break; // Try next auth method
        }

        if (status === 400 || status === 404) {
          // Token not yet indexed or invalid address
          if (headers === authAttempts[authAttempts.length - 1]) {
             console.warn(`[RugCheck] Token ${cleanAddress} not found or not yet indexed (Status ${status})`);
             return { score: 0, risks: [], aiVerdict: "Not Indexed", riskLevel: "PENDING" };
          }
          break; // Try next auth method (though unlikely to help for 400/404)
        }
        
        // If it's not a 401, 429, 400, or 404, it might be a server error
        if (headers === authAttempts[authAttempts.length - 1]) {
          console.error(`RugCheck final error for ${cleanAddress}:`, e.message);
        }
        break;
      }
    }
  }

  return { score: 0, risks: [], aiVerdict: "Scan Failed", riskLevel: "UNKNOWN" };
}

async function getSolanaWalletIntelligence(address: string) {
  let heliusKey = process.env.HELIUS_API_KEY;
  if (!heliusKey || heliusKey === "MY_HELIUS_API_KEY") {
    heliusKey = "83174563-f39b-4f6d-ab05-b31a926650df";
  }

  try {
    // Get top holders via Helius
    const response = await axios.post(`https://mainnet.helius-rpc.com/?api-key=${heliusKey}`, {
      jsonrpc: "2.0",
      id: "my-id",
      method: "getTokenLargestAccounts",
      params: [address]
    });

    const holders = response.data.result?.value || [];
    if (holders.length === 0) return { insiderProb: 0, walletRisk: 0, organicRatio: 100 };

    // Simple heuristic for insider probability: 
    // If top 10 holders own > 30% of supply (excluding known burn/LP addresses)
    let topHoldersSupply = 0;
    holders.slice(0, 10).forEach((h: any) => {
      topHoldersSupply += parseFloat(h.uiAmountString || "0");
    });

    // This is a mock calculation as we don't have total supply here easily without another call
    // But we can estimate based on clustering
    const insiderProb = Math.min(100, (holders.length < 5 ? 80 : 20) + (topHoldersSupply > 0 ? 10 : 0));
    const walletRisk = insiderProb > 50 ? 60 : 20;

    return {
      insiderProb,
      walletRisk,
      organicRatio: 100 - insiderProb
    };
  } catch (e) {
    console.error(`Helius error for ${address}:`, e.message);
    return { insiderProb: 0, walletRisk: 0, organicRatio: 100 };
  }
}

// --- AI Analysis Helpers Removed (Moved to Frontend) ---

let lastScanTimestamp = Date.now();

async function scanBoosts() {
  try {
    if (getConfig.get("scanning_active")?.value !== "true") {
      console.log(`[${new Date().toISOString()}] ⏸️ Scanning is PAUSED.`);
      return;
    }
    lastScanTimestamp = Date.now();
    console.log(`[${new Date().toISOString()}] 💓 Heartbeat: Scanning DexScreener Boosts...`);
    const response = await axios.get('https://api.dexscreener.com/token-boosts/latest/v1', { timeout: 10000 });
    const boosts = response.data || [];
    console.log(`[Scan] Fetched ${boosts.length} boosted tokens.`);

    const minBoost = parseFloat(getConfig.get("min_boost")?.value || "100");
    const minLiquidity = parseFloat(getConfig.get("min_liquidity")?.value || "30000");
    const minScore = parseFloat(getConfig.get("min_nana_score")?.value || "55");
    const scannedChainsRaw = getConfig.get("scanned_chains")?.value || "";
    const scannedChains = scannedChainsRaw ? scannedChainsRaw.split(',') : [];

    for (const boost of boosts) {
      const address = boost.tokenAddress;
      const chainId = boost.chainId;

      if (scannedChains.length > 0 && !scannedChains.includes(chainId)) continue;

      // 24h duplicate check
      const last24h = Date.now() - (24 * 60 * 60 * 1000);
      const existing = db.prepare("SELECT id FROM tokens WHERE address = ? AND created_at > ?").get(address, last24h);
      if (existing) continue;

      const pair = await fetchTokenDetails(address);
      if (!pair) continue;

      const liquidity = pair.liquidity?.usd || 0;
      const price = parseFloat(pair.priceUsd || "0");
      
      const buys = pair.txns?.h1?.buys || 1;
      const sells = pair.txns?.h1?.sells || 1;
      const buyPressure = buys / (buys + sells);

      if (liquidity < minLiquidity) continue;
      if (buyPressure < 0.4) continue;

      const rugData = await checkRugRisk(address, chainId);
      const rugRiskScore = rugData.score / 10;
      
      if (rugRiskScore > 60 || rugData.riskLevel === 'CRITICAL') {
        db.prepare("INSERT OR REPLACE INTO rugs (address, reason, timestamp) VALUES (?, ?, ?)")
          .run(address, `High Risk Score: ${rugData.score} | AI: ${rugData.aiVerdict}`, Date.now());
      }
      
      // Wallet Intelligence (Solana only)
      const walletIntel = chainId === 'solana' ? await getSolanaWalletIntelligence(address) : { insiderProb: 0, walletRisk: 0, organicRatio: 100 };

      // Social Analysis (Metadata only, AI moved to frontend)
      const website = pair.info?.websites?.[0]?.url;
      const twitter = pair.info?.socials?.find((s: any) => s.type === 'twitter')?.url;

      const volumeVelocity = Math.min(100, (pair.volume?.m5 || 0) / 1000); 
      const learnedBonus = getLearnedBonus();
      const nanaScore = getNanaScore({
        volumeVelocity,
        buyPressure,
        liquidity,
        rugRiskScore,
        socialLegitimacy: 50, // Default until background AI analyzes
        insiderProb: walletIntel.insiderProb,
        learnedBonus
      });

      if (nanaScore < minScore) {
        console.log(`[Scan] Boosted Token ${pair.baseToken.symbol} skipped. Score: ${nanaScore.toFixed(1)} < ${minScore}`);
        continue;
      }

      console.log(`[Scan] 💎 NEW BOOSTED TOKEN FOUND: ${pair.baseToken.symbol} on ${chainId} with Score: ${nanaScore.toFixed(1)}`);
      const id = Math.random().toString(36).substring(7);
      const marketCap = pair.fdv || 0;
      try {
        db.prepare(`
          INSERT INTO tokens (id, symbol, name, chain, address, boost_level, liquidity, buy_pressure, nana_score, rug_risk_score, insider_probability, wallet_risk, market_cap, cto_status, call_price, current_price, ath_price, created_at, sentiment_score, dev_activity_score, ai_rug_verdict, ai_rug_risk_level, website, twitter, raw_risks, dev_is_selling, volume_velocity)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          id, pair.baseToken.symbol, pair.baseToken.name, chainId, address, 
          100, liquidity, buyPressure, 
          nanaScore, rugRiskScore, walletIntel.insiderProb, walletIntel.walletRisk, marketCap,
          0, price, price, price, Date.now(),
          50, 50,
          'Pending Neural Analysis', 'MEDIUM',
          website, twitter, JSON.stringify(rugData.risks),
          0, volumeVelocity
        );
        console.log(`[Scan] ✅ Token ${pair.baseToken.symbol} stored in database.`);
      } catch (dbErr) {
        console.error(`[Scan] ❌ Database error storing ${pair.baseToken.symbol}:`, dbErr.message);
      }

      // --- Simulation Trade ---
      await executeSimulationTrade(id, chainId, price, nanaScore, rugRiskScore, buyPressure, walletIntel.insiderProb, 50);

      // --- Send Alerts to All Relevant Users ---
      if (bot) {
        const users = db.prepare("SELECT id FROM users").all() as any[];
        const chatIdsToNotify = new Set<string>();

        // 1. Add registered users who have alerts enabled
        for (const user of users) {
          const userScanningActive = getUserConfig.get(user.id, "scanning_active")?.value || getConfig.get("scanning_active")?.value;
          if (userScanningActive !== "true") continue;

          const userAlertsEnabled = getUserConfig.get(user.id, "alerts_enabled")?.value || getConfig.get("alerts_enabled")?.value;
          if (userAlertsEnabled !== "true") continue;

          const userChatId = getUserConfig.get(user.id, "chat_id")?.value || getConfig.get("chat_id")?.value;
          if (userChatId) {
            const userMinScore = parseFloat(getUserConfig.get(user.id, "min_nana_score")?.value || getConfig.get("min_nana_score")?.value || "55");
            if (nanaScore >= userMinScore) {
              chatIdsToNotify.add(userChatId);
            }
          }
        }

        // 2. Add global chat ID if alerts are enabled globally
        const globalAlertsEnabled = getConfig.get("alerts_enabled")?.value === "true";
        const globalChatId = getConfig.get("chat_id")?.value;
        if (globalAlertsEnabled && globalChatId) {
          const globalMinScore = parseFloat(getConfig.get("min_nana_score")?.value || "55");
          if (nanaScore >= globalMinScore) {
            chatIdsToNotify.add(globalChatId);
          }
        }

        if (chatIdsToNotify.size > 0) {
          console.log(`[Alert] Sending alerts for ${pair.baseToken.symbol} to ${chatIdsToNotify.size} unique chat IDs.`);
          
          const mc = formatCurrency(pair.fdv || 0);
          const liq = formatCurrency(liquidity);
          const message = `
🚀 *NEW SIGNAL:* ${pair.baseToken.symbol}
Chain: ${chainId}
Market Cap: ${mc}
Liquidity: ${liq}
Buy Pressure: ${(buyPressure * 100).toFixed(1)}%

🧠 *Intelligence:*
Rug Risk Score: ${rugRiskScore.toFixed(1)}
🛡️ Security: ${rugData.riskLevel}
Insider Probability: ${walletIntel.insiderProb.toFixed(0)}%
Nana Score: ${nanaScore.toFixed(1)}

⭐ *Verdict:* ${nanaScore > 85 ? "ELITE SETUP 💎" : "STRONG SIGNAL 🔥"}

[View on DexScreener](${pair.url})
          `;

          for (const chatId of chatIdsToNotify) {
            bot.sendMessage(chatId, message, { parse_mode: "Markdown", disable_web_page_preview: false })
              .catch(e => console.error(`[Alert] Error sending to chat ID ${chatId}:`, e.message));
          }
        }
      }
      
      // Add a small delay between scans to avoid rate limits
      await delay(500);
    }
  } catch (e) {
    console.error("Scan error:", e.message);
  }
}

// --- Simulation Logic ---

async function getSimulationBalance(chain: string) {
  let row = db.prepare("SELECT * FROM simulation_balance WHERE chain = ?").get(chain) as any;
  const now = Date.now();

  if (!row) {
    db.prepare("INSERT INTO simulation_balance (chain, balance, last_funding_timestamp) VALUES (?, ?, ?)")
      .run(chain, 100, now);
    return 100;
  }

  // Persistent balance: No more auto-funding every 24h as requested
  return row.balance;
}

// --- Neural Learning Engine ---
async function learnFromSuccess(tokenId: string, symbol: string, chain: string, reason: string) {
  try {
    const token = db.prepare("SELECT * FROM tokens WHERE id = ?").get(tokenId) as any;
    if (!token) return;

    console.log(`[Neural Engine] 🧠 Analyzing success pattern for ${symbol}...`);

    // 1. Record the pattern
    const insight = `Success Pattern: ${symbol} (${chain}) achieved profitability. Key factors: ${reason}. Initial Nana Score: ${token.nana_score}, Buy Pressure: ${token.buy_pressure}, Insider Prob: ${token.insider_probability}%`;
    
    db.prepare("INSERT INTO learned_patterns (pattern_type, insight, weight_adjustment, timestamp) VALUES (?, ?, ?, ?)")
      .run('success_pattern', insight, 1.2, Date.now());

    // 2. Adjust Neural Weights dynamically
    // If a token was successful, we slightly increase the weights of the factors that were strong
    const currentWeights = db.prepare("SELECT * FROM neural_weights").all() as any[];
    
    for (const w of currentWeights) {
      let adjustment = 1.0;
      
      if (w.factor === 'buy_pressure' && token.buy_pressure > 0.7) adjustment = 1.02;
      if (w.factor === 'volume' && token.volume_velocity > 50) adjustment = 1.01;
      if (w.factor === 'insider' && token.insider_probability < 10) adjustment = 1.02;
      if (w.factor === 'social' && (token.website || token.twitter)) adjustment = 1.01;
      
      const newWeight = w.weight * adjustment;
      db.prepare("UPDATE neural_weights SET weight = ?, last_updated = ? WHERE factor = ?")
        .run(newWeight, Date.now(), w.factor);
    }

    // 3. Record pattern for AI processing (Frontend will handle the Gemini call)
    db.prepare("INSERT INTO learned_patterns (pattern_type, insight, weight_adjustment, timestamp) VALUES (?, ?, ?, ?)")
      .run('pending_ai', insight, 1.0, Date.now());

  } catch (e: any) {
    console.error(`[Neural Engine] Learning failed: ${e.message}`);
  }
}

// Removed generateAIInsight from backend to comply with guidelines (Frontend only)

function getLearnedBonus(): number {
  const patterns = db.prepare("SELECT weight_adjustment FROM learned_patterns ORDER BY timestamp DESC LIMIT 10").all() as any[];
  if (patterns.length === 0) return 0;
  
  // Average of recent adjustments
  const sum = patterns.reduce((a, b) => a + b.weight_adjustment, 0);
  const avg = sum / patterns.length;
  return (avg - 1.0) * 10; // Scaled bonus
}

// --- Real Data Integration (DexScreener + RugCheck) ---

// Update the nanaScore calculation to use dynamic weights
function getNanaScore(data: { volumeVelocity: number, buyPressure: number, liquidity: number, rugRiskScore: number, socialLegitimacy: number, insiderProb: number, learnedBonus: number }) {
  const w_vol = getWeight.get("volume")?.weight || 0.15;
  const w_buy = getWeight.get("buy_pressure")?.weight || 15;
  const w_liq = getWeight.get("liquidity")?.weight || 0.1;
  const w_rug = getWeight.get("rug_risk")?.weight || 0.2;
  const w_soc = getWeight.get("social")?.weight || 0.2;
  const w_ins = getWeight.get("insider")?.weight || 0.2;
  const w_lrn = getWeight.get("learned")?.weight || 100;

  return (data.volumeVelocity * w_vol) + 
         (data.buyPressure * w_buy) + 
         (Math.min(100, data.liquidity / 1000) * w_liq) + 
         (Math.max(0, 100 - data.rugRiskScore) * w_rug) +
         (data.socialLegitimacy * w_soc) +
         ((100 - data.insiderProb) * w_ins) +
         (data.learnedBonus * w_lrn);
}

async function getPortfolioWorth() {
  const balances = db.prepare("SELECT SUM(balance) as total FROM simulation_balance").get() as any;
  const activeTrades = db.prepare(`
    SELECT tk.current_price, 
           SUM(CASE WHEN t.type IN ('buy', 'buyback') THEN t.tokens_amount ELSE -t.tokens_amount END) as remaining_tokens
    FROM tokens tk
    JOIN simulation_trades t ON tk.id = t.token_id
    GROUP BY tk.id
    HAVING remaining_tokens > 0.000001
  `).all() as any[];
  
  let tradesValue = 0;
  for (const trade of activeTrades) {
    tradesValue += (trade.remaining_tokens * trade.current_price);
  }
  
  return (balances?.total || 0) + tradesValue;
}

// --- DeepSeek Simulation Engine ---

async function callDeepSeek(prompt: string) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) throw new Error("DeepSeek API Key not configured");
  try {
    const response = await axios.post("https://api.deepseek.com/chat/completions", {
      model: "deepseek-chat",
      messages: [
        { role: "system", content: "You are an expert crypto trading engine. Always return valid JSON." },
        { role: "user", content: prompt }
      ],
      response_format: { type: "json_object" }
    }, {
      headers: { "Authorization": `Bearer ${apiKey}` },
      timeout: 30000
    });
    return JSON.parse(response.data.choices[0].message.content);
  } catch (e) {
    console.error("DeepSeek Simulation Error:", e.message);
    return null;
  }
}

async function runDeepSeekSimulation() {
  console.log("[DeepSeek Simulation] 🤖 Starting AI-driven trade analysis...");
  
  // 1. Analyze New Opportunities
  const topTokens = db.prepare(`
    SELECT * FROM tokens 
    WHERE status = 'active' 
    AND nana_score > 70 
    AND created_at > ?
    ORDER BY nana_score DESC LIMIT 10
  `).all(Date.now() - 3600000) as any[];

  for (const token of topTokens) {
    // Check if already holding
    const holding = db.prepare(`
      SELECT SUM(CASE WHEN type IN ('buy', 'buyback') THEN tokens_amount ELSE -tokens_amount END) as remaining
      FROM simulation_trades WHERE token_id = ?
    `).get(token.id) as any;

    if (holding && holding.remaining > 0.000001) continue;

    const prompt = `
      Analyze this token for a potential simulation buy.
      Symbol: ${token.symbol}
      Nana Score: ${token.nana_score}
      Rug Risk: ${token.rug_risk_score}
      Buy Pressure: ${token.buy_pressure}
      Insider Prob: ${token.insider_probability}
      Sentiment: ${token.sentiment_score}
      
      Should we buy? Return JSON: {"shouldBuy": boolean, "confidence": 0-100, "reason": "string", "amountUsd": number}
      Max amountUsd is $10.
    `;

    const decision = await callDeepSeek(prompt);
    if (decision && decision.shouldBuy && decision.confidence > 75) {
      await executeSimulationTrade(token.id, token.chain, token.current_price, token.nana_score, token.rug_risk_score, token.buy_pressure, token.insider_probability, token.sentiment_score, decision.amountUsd, decision.reason);
    }
  }

  // 2. Analyze Current Portfolio for Sells
  const activeTrades = db.prepare(`
    SELECT tk.id as token_id, tk.symbol, tk.current_price, tk.ath_price, tk.rug_risk_score, tk.buy_pressure, tk.insider_probability,
           tk.sentiment_score, tk.dev_activity_score, tk.ai_rug_risk_level, tk.dev_is_selling, tk.nana_score, tk.chain,
           SUM(CASE WHEN t.type IN ('buy', 'buyback') THEN t.tokens_amount ELSE -t.tokens_amount END) as remaining_tokens,
           AVG(CASE WHEN t.type IN ('buy', 'buyback') THEN t.price ELSE NULL END) as avg_buy_price,
           SUM(CASE WHEN t.type IN ('buy', 'buyback') THEN t.amount_usd ELSE 0 END) as total_buy_usd
    FROM tokens tk
    JOIN simulation_trades t ON tk.id = t.token_id
    GROUP BY tk.id
    HAVING remaining_tokens > 0.000001
  `).all() as any[];

  for (const trade of activeTrades) {
    const roi = trade.current_price / trade.avg_buy_price;
    const prompt = `
      Analyze this holding for a potential sell.
      Symbol: ${trade.symbol}
      ROI: ${roi.toFixed(2)}x
      Current Price: ${trade.current_price}
      Rug Risk: ${trade.rug_risk_score}
      Sentiment: ${trade.sentiment_score}
      Buy Pressure: ${trade.buy_pressure}
      
      Should we sell? Return JSON: {"shouldSell": boolean, "percentage": 0-1, "reason": "string"}
    `;

    const decision = await callDeepSeek(prompt);
    if (decision && decision.shouldSell) {
      await executeManualSell(trade.token_id, decision.percentage, decision.reason);
    }
  }
}

async function executeSimulationTrade(tokenId: string, chain: string, price: number, nanaScore: number, rugRisk: number, buyPressure: number, insiderProb: number, sentiment: number, amountUsdOverride?: number, aiReason?: string) {
  const balance = await getSimulationBalance(chain);
  if (balance <= 0) return { success: false, error: "Insufficient balance" };

  const riskTolerance = parseFloat(getConfig.get("risk_tolerance")?.value || "1.0");
  let amountUsd = amountUsdOverride || (balance * 0.03 * riskTolerance);
  
  if (amountUsd > balance) amountUsd = balance;
  if (amountUsd < 2 && balance >= 2) amountUsd = 2;
  if (amountUsd < 2) return { success: false, error: "Amount too small" };

  const tokensAmount = amountUsd / price;
  const reason = aiReason || `AI Score: ${nanaScore.toFixed(1)}`;

  db.prepare("INSERT INTO simulation_trades (token_id, chain, type, amount_usd, price, tokens_amount, timestamp, reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .run(tokenId, chain, 'buy', amountUsd, price, tokensAmount, Date.now(), reason);

  db.prepare("UPDATE simulation_balance SET balance = balance - ? WHERE chain = ?").run(amountUsd, chain);
  console.log(`[Simulation] 🛒 BOUGHT ${tokenId} for $${amountUsd.toFixed(2)}`);
  return { success: true };
}

async function learnFromUserAction(tokenId: string, actionType: string, reason: string) {
  const token = db.prepare("SELECT * FROM tokens WHERE id = ?").get(tokenId) as any;
  if (!token) return;

  const insight = `User ${actionType} ${token.symbol} because: ${reason}. Token State: Nana=${token.nana_score}, Rug=${token.rug_risk_score}, Sentiment=${token.sentiment_score}`;
  
  db.prepare("INSERT INTO learned_patterns (pattern_type, insight, timestamp) VALUES (?, ?, ?)")
    .run('user_pattern', insight, Date.now());
  
  console.log(`[Neural Engine] 🧠 Learned from user action: ${insight}`);
}

async function executeManualSell(tokenId: string, percentage: number, reason: string) {
  const trade = db.prepare(`
    SELECT tk.symbol, tk.current_price, tk.chain,
           SUM(CASE WHEN t.type IN ('buy', 'buyback') THEN t.tokens_amount ELSE -t.tokens_amount END) as remaining_tokens,
           SUM(CASE WHEN t.type IN ('buy', 'buyback') THEN t.amount_usd ELSE 0 END) / SUM(CASE WHEN t.type IN ('buy', 'buyback') THEN t.tokens_amount ELSE 0 END) as avg_buy_price,
           SUM(CASE WHEN t.type IN ('buy', 'buyback') THEN t.amount_usd ELSE 0 END) as total_buy_usd
    FROM tokens tk
    JOIN simulation_trades t ON tk.id = t.token_id
    WHERE tk.id = ?
    GROUP BY tk.id
  `).get(tokenId) as any;

  if (!trade || trade.remaining_tokens <= 0) return { success: false, error: "No tokens to sell" };

  const tokensToSell = trade.remaining_tokens * percentage;
  const sellAmountUsd = tokensToSell * trade.current_price;
  const costBasis = trade.avg_buy_price * tokensToSell;
  const profitUsd = sellAmountUsd - costBasis;

  db.prepare("INSERT INTO simulation_trades (token_id, chain, type, amount_usd, price, tokens_amount, profit_usd, timestamp, reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(tokenId, trade.chain, 'sell', sellAmountUsd, trade.current_price, tokensToSell, profitUsd, Date.now(), reason);

  db.prepare("UPDATE simulation_balance SET balance = balance + ? WHERE chain = ?").run(sellAmountUsd, trade.chain);
  console.log(`[Simulation] 💰 SOLD ${trade.symbol} for $${sellAmountUsd.toFixed(2)}`);
  return { success: true };
}

async function checkSimulationSells() {
  const activeTrades = db.prepare(`
    SELECT tk.id as token_id, tk.symbol, tk.current_price, tk.ath_price, tk.rug_risk_score, tk.buy_pressure, tk.insider_probability,
           tk.sentiment_score, tk.dev_activity_score, tk.ai_rug_risk_level, tk.dev_is_selling, tk.nana_score, tk.chain,
           SUM(CASE WHEN t.type IN ('buy', 'buyback') THEN t.tokens_amount ELSE -t.tokens_amount END) as remaining_tokens,
           AVG(CASE WHEN t.type IN ('buy', 'buyback') THEN t.price ELSE NULL END) as avg_buy_price,
           SUM(CASE WHEN t.type IN ('buy', 'buyback') THEN t.amount_usd ELSE 0 END) as total_buy_usd
    FROM tokens tk
    JOIN simulation_trades t ON tk.id = t.token_id
    GROUP BY tk.id
    HAVING remaining_tokens > 0.000001
  `).all() as any[];

  for (const trade of activeTrades) {
    const currentPrice = trade.current_price;
    const buyPrice = trade.avg_buy_price;
    const roi = currentPrice / buyPrice;
    const fromAth = trade.ath_price > 0 ? currentPrice / trade.ath_price : 1;
    
    let shouldSell = false;
    let sellPercent = 1.0; // Default to full sell
    let reason = "";

    // --- Dynamic Exit Strategy (Intelligence-Based) ---

    // 1. Security/Rug Risk (Highest Priority) - Full Sell
    if (trade.ai_rug_risk_level === 'CRITICAL') {
      shouldSell = true;
      reason = "CRITICAL Security Alert: AI detected imminent rug risk";
    } else if (trade.rug_risk_score > 75) {
      shouldSell = true;
      reason = "High Technical Risk: RugCheck score exceeded safety threshold";
    }

    // 2. Developer & Community Activity - Full Sell
    else if (trade.dev_is_selling === 1) {
      shouldSell = true;
      reason = "Dev Exit: On-chain developer sell detected";
    } 
    else if (trade.sentiment_score < 20 && trade.buy_pressure < 0.3) {
      shouldSell = true;
      reason = "Community Collapse: Inactive on X and Buy Pressure is low";
    }

    // 3. Partial Profit Taking (25% Sells)
    const profitTarget = parseFloat(getConfig.get("profit_target")?.value || "1.3");
    if (roi >= profitTarget) {
      // Check for "changes in community and buy pressure"
      const buyPressureDropping = trade.buy_pressure < 0.5;
      const sentimentDropping = trade.sentiment_score < 40;
      
      if (buyPressureDropping || sentimentDropping) {
        shouldSell = true;
        sellPercent = 0.25;
        reason = "Partial TP: Taking 25% profit due to weakening indicators";
      } else if (roi >= 2.0) {
        // Even if it looks good, take some profit at 2x
        shouldSell = true;
        sellPercent = 0.25;
        reason = "Partial TP: Taking 25% profit at 2x milestone";
      }
    }

    // 4. Intelligence-Based Trailing Stop - Full Sell
    if (!shouldSell && roi >= 1.5 && fromAth < 0.5) {
      shouldSell = true;
      reason = "Dynamic TP: Trailing profit lock hit (50% dip from ATH)";
    }

    // 5. Extreme Momentum Loss - Full Sell
    if (!shouldSell && roi > 1.1 && trade.buy_pressure < 0.25) {
      shouldSell = true;
      reason = "Momentum Loss: Buy pressure collapsed while in profit";
    }

    if (shouldSell) {
      const tokensToSell = trade.remaining_tokens * sellPercent;
      const sellAmountUsd = tokensToSell * currentPrice;
      
      // Calculate profit for this specific portion
      const costBasis = (trade.total_buy_usd / trade.remaining_tokens) * tokensToSell;
      const profitUsd = sellAmountUsd - costBasis;

      db.prepare("INSERT INTO simulation_trades (token_id, chain, type, amount_usd, price, tokens_amount, profit_usd, timestamp, reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .run(trade.token_id, trade.chain, 'sell', sellAmountUsd, currentPrice, tokensToSell, profitUsd, Date.now(), reason);

      db.prepare("UPDATE simulation_balance SET balance = balance + ? WHERE chain = ?").run(sellAmountUsd, trade.chain);
      
      console.log(`[Simulation] 💰 SOLD ${sellPercent * 100}% of ${trade.symbol} for $${sellAmountUsd.toFixed(2)} (Profit: $${profitUsd.toFixed(2)})`);

      // Notify Telegram
      const profitPercent = ((roi - 1) * 100).toFixed(1);
      const emoji = profitUsd >= 0 ? '💰' : '📉';
      const status = profitUsd >= 0 ? 'PROFIT' : 'LOSS';
      
      const sellMessage = `
${emoji} *SIMULATION SELL (${(sellPercent * 100).toFixed(0)}%):* ${trade.symbol}
Status: *${status}*

💵 *Amount:* $${sellAmountUsd.toFixed(2)}
📈 *ROI:* ${profitPercent}% ($${profitUsd.toFixed(2)})
⛓️ *Chain:* ${trade.chain}

📝 *Reason:* ${reason}
      `;
      
      await broadcastToTelegram(sellMessage);

      // Learning Logic
      if (profitUsd > 0) {
        await learnFromSuccess(trade.token_id, trade.symbol, trade.chain, reason);
      } else {
        db.prepare("INSERT INTO learned_patterns (pattern_type, insight, weight_adjustment, timestamp) VALUES (?, ?, ?, ?)")
          .run('failed_setup', `Token ${trade.symbol} on ${trade.chain} resulted in loss. Reason: ${reason}`, 0.95, Date.now());
      }

      // Buyback logic: If it dips after profit but indicators are still good
      if (profitUsd > 0 && trade.buy_pressure > 0.7 && trade.nana_score > 80) {
        // Potential buyback logic could go here in a future update or next tick
      }
    }
  }
}

// Update prices and ATH with real data
async function updatePrices() {
  try {
    if (getConfig.get("scanning_active")?.value !== "true") {
      return;
    }
    console.log(`[${new Date().toISOString()}] 💓 Heartbeat: Updating Prices...`);
    const activeTokens = db.prepare("SELECT * FROM tokens WHERE status = 'active'").all();
    for (const token of activeTokens as any) {
      const pair = await fetchTokenDetails(token.address);
      if (pair) {
        const newPrice = parseFloat(pair.priceUsd || "0");
        const newAth = Math.max(token.ath_price, newPrice);
        const newMc = pair.fdv || 0;
        
        const buys = pair.txns?.h1?.buys || 0;
        const sells = pair.txns?.h1?.sells || 0;
        const buyPressure = (buys + sells) > 0 ? buys / (buys + sells) : 0.5;
        const volumeVelocity = Math.min(100, (pair.volume?.m5 || 0) / 1000);

        db.prepare("UPDATE tokens SET current_price = ?, ath_price = ?, market_cap = ?, buy_pressure = ?, volume_velocity = ? WHERE id = ?")
          .run(newPrice, newAth, newMc, buyPressure, volumeVelocity, token.id);

        // Periodically refresh security and social metrics for active tokens (every 15m)
        const now = Date.now();
        if (now - (token.last_security_check || 0) > 15 * 60 * 1000) {
          console.log(`[Update] 🔍 Refreshing intelligence for ${token.symbol}...`);
          const rugData = await checkRugRisk(token.address, token.chain);
          const website = pair.info?.websites?.[0]?.url;
          const twitter = pair.info?.socials?.find((s: any) => s.type === 'twitter')?.url;

          db.prepare(`
            UPDATE tokens 
            SET rug_risk_score = ?, ai_rug_verdict = ?, ai_rug_risk_level = ?, 
                last_security_check = ?, website = ?, twitter = ?, raw_risks = ?
            WHERE id = ?
          `).run(
            rugData.score / 10, rugData.aiVerdict, rugData.riskLevel,
            now, website, twitter, JSON.stringify(rugData.risks),
            token.id
          );
        }

        // Check for 2x or ATH alerts
        if (newPrice >= token.call_price * 2 && token.status !== 'called_2x') {
          const chatId = getConfig.get("chat_id")?.value;
          if (bot && chatId) {
            const mc = formatCurrency(pair.fdv || 0);
            bot.sendMessage(chatId, `💰 *PROFIT ALERT:* ${token.symbol} just hit 2x! 🚀\nPrice: $${newPrice.toFixed(8)}\nMarket Cap: ${mc}`, { parse_mode: "Markdown" });
            db.prepare("UPDATE tokens SET status = 'called_2x' WHERE id = ?").run(token.id);
          }
        }
      }
    }
    
    // Process simulation sells after price updates
    await checkSimulationSells();
    
  } catch (e) {
    console.error("Update prices error:", e.message);
  }
}

async function scanNewMints() {
  try {
    if (getConfig.get("scanning_active")?.value !== "true") {
      console.log(`[${new Date().toISOString()}] ⏸️ Scanning is PAUSED.`);
      return;
    }
    lastScanTimestamp = Date.now();
    console.log(`[${new Date().toISOString()}] 💓 Heartbeat: Scanning New Mints...`);
    const response = await axios.get('https://api.dexscreener.com/token-profiles/latest/v1', { timeout: 10000 });
    const profiles = response.data || [];
    console.log(`[Scan] Fetched ${profiles.length} new mint profiles.`);

    const scannedChainsRaw = getConfig.get("scanned_chains")?.value || "";
    const scannedChains = scannedChainsRaw ? scannedChainsRaw.split(',') : [];
    const minScore = parseFloat(getConfig.get("min_nana_score")?.value || "55");

    for (const profile of profiles) {
      const address = profile.tokenAddress;
      const chainId = profile.chainId;

      if (scannedChains.length > 0 && !scannedChains.includes(chainId)) continue;

      // 24h duplicate check
      const last24h = Date.now() - (24 * 60 * 60 * 1000);
      const existing = db.prepare("SELECT id FROM tokens WHERE address = ? AND created_at > ?").get(address, last24h);
      if (existing) continue;

      const pair = await fetchTokenDetails(address);
      if (!pair) continue;

      // New mints often have low liquidity initially, but we still apply a minimum
      const liquidity = pair.liquidity?.usd || 0;
      if (liquidity < 10000) continue; // Lower threshold for new mints to catch early traction

      // Check velocity (m5 volume)
      const m5Volume = pair.volume?.m5 || 0;
      if (m5Volume < 5000) continue; // Must have some early traction

      const price = parseFloat(pair.priceUsd || "0");
      const buys = pair.txns?.m5?.buys || 1;
      const sells = pair.txns?.m5?.sells || 1;
      const buyPressure = buys / (buys + sells);

      if (buyPressure < 0.7) continue; // Higher buy pressure requirement for new mints

      const rugData = await checkRugRisk(address, chainId);
      const rugRiskScore = rugData.score / 10;
      
      if (rugRiskScore > 40 || rugData.riskLevel === 'CRITICAL') {
        db.prepare("INSERT OR REPLACE INTO rugs (address, reason, timestamp) VALUES (?, ?, ?)")
          .run(address, `High Risk Mint: ${rugData.score} | AI: ${rugData.aiVerdict}`, Date.now());
        continue; // Strict rug filter for new mints
      }

      // Wallet Intelligence (Solana only)
      const walletIntel = chainId === 'solana' ? await getSolanaWalletIntelligence(address) : { insiderProb: 0, walletRisk: 0, organicRatio: 100 };
      
      // Social Analysis (Metadata only, AI moved to frontend)
      const website = pair.info?.websites?.[0]?.url;
      const twitter = pair.info?.socials?.find((s: any) => s.type === 'twitter')?.url;

      const volumeVelocity = Math.min(100, (pair.volume?.m5 || 0) / 1000); 
      const learnedBonus = getLearnedBonus();
      const nanaScore = getNanaScore({
        volumeVelocity,
        buyPressure,
        liquidity,
        rugRiskScore,
        socialLegitimacy: 50, // Default until background AI analyzes
        insiderProb: walletIntel.insiderProb,
        learnedBonus
      });

      if (nanaScore < minScore) {
        console.log(`[Scan] New Mint ${pair.baseToken.symbol} skipped. Score: ${nanaScore.toFixed(1)} < ${minScore}`);
        continue;
      }

      console.log(`[Scan] ✨ NEW MINT FOUND: ${pair.baseToken.symbol} on ${chainId} with Score: ${nanaScore.toFixed(1)}`);
      const id = Math.random().toString(36).substring(7);
      const marketCap = pair.fdv || 0;
      try {
        db.prepare(`
          INSERT INTO tokens (id, symbol, name, chain, address, boost_level, liquidity, buy_pressure, nana_score, rug_risk_score, insider_probability, wallet_risk, market_cap, cto_status, call_price, current_price, ath_price, created_at, sentiment_score, dev_activity_score, ai_rug_verdict, ai_rug_risk_level, website, twitter, raw_risks, dev_is_selling, volume_velocity)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          id, pair.baseToken.symbol, pair.baseToken.name, chainId, address, 
          0, liquidity, buyPressure, 
          nanaScore, rugRiskScore, walletIntel.insiderProb, walletIntel.walletRisk, marketCap,
          0, price, price, price, Date.now(),
          50, 50,
          'Pending Neural Analysis', 'MEDIUM',
          website, twitter, JSON.stringify(rugData.risks),
          0, volumeVelocity
        );
        console.log(`[Scan] ✅ New Mint ${pair.baseToken.symbol} stored in database.`);
      } catch (dbErr) {
        console.error(`[Scan] ❌ Database error storing new mint ${pair.baseToken.symbol}:`, dbErr.message);
      }

      // --- Simulation Trade ---
      await executeSimulationTrade(id, chainId, price, nanaScore, rugRiskScore, buyPressure, walletIntel.insiderProb, 50);

      // --- Send Alerts to All Relevant Users ---
      if (bot) {
        const users = db.prepare("SELECT id FROM users").all() as any[];
        for (const user of users) {
          const userScanningActive = getUserConfig.get(user.id, "scanning_active")?.value || getConfig.get("scanning_active")?.value;
          if (userScanningActive !== "true") continue;

          const userAlertsEnabled = getUserConfig.get(user.id, "alerts_enabled")?.value || getConfig.get("alerts_enabled")?.value;
          if (userAlertsEnabled !== "true") continue;

          const userChatId = getUserConfig.get(user.id, "chat_id")?.value || getConfig.get("chat_id")?.value;
          if (!userChatId) continue;

          const userMinScore = parseFloat(getUserConfig.get(user.id, "min_nana_score")?.value || getConfig.get("min_nana_score")?.value || "55");
          if (nanaScore < userMinScore) continue;

          const mc = formatCurrency(pair.fdv || 0);
          const liq = formatCurrency(liquidity);
          const m5v = formatCurrency(m5Volume);
          
          const message = `✨ *NEW MINT DETECTED:* ${pair.baseToken.symbol}\nChain: ${chainId}\nMarket Cap: ${mc}\nLiq: ${liq}\n5m Vol: ${m5v}\nInsider Prob: ${walletIntel.insiderProb.toFixed(0)}%\nNana Score: ${nanaScore.toFixed(1)}\n🛡️ *Security:* ${rugData.riskLevel} (${rugData.aiVerdict})\n[View](${pair.url})`;
          
          bot.sendMessage(userChatId, message, { parse_mode: "Markdown" }).catch(e => console.error(`Error sending to user ${user.id}:`, e.message));
        }
      }

      // Add a small delay between scans to avoid rate limits
      await delay(500);
    }
  } catch (e) {
    console.error("New mint scan error:", e.message);
  }
}

// --- Background AI Worker (DeepSeek Fallback for Autonomous Mode) ---
async function processBackgroundAI() {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) return;

  try {
    // 1. Process Pending Rug Analysis
    const pendingRug = db.prepare("SELECT * FROM tokens WHERE ai_rug_verdict = 'Pending Neural Analysis' LIMIT 3").all() as any[];
    for (const token of pendingRug) {
      console.log(`[Background AI] Analyzing Rug Risk for ${token.symbol} via DeepSeek...`);
      const prompt = `Analyze this token for rug risk. Address: ${token.address}, Risks: ${token.raw_risks}, Score: ${token.rug_risk_score}. Return JSON with "verdict" (string) and "riskLevel" (LOW/MEDIUM/HIGH).`;
      
      try {
        const response = await axios.post("https://api.deepseek.com/chat/completions", {
          model: "deepseek-chat",
          messages: [{ role: "user", content: prompt }],
          response_format: { type: "json_object" }
        }, { headers: { "Authorization": `Bearer ${apiKey}` } });
        
        const result = JSON.parse(response.data.choices[0].message.content);
        db.prepare("UPDATE tokens SET ai_rug_verdict = ?, ai_rug_risk_level = ? WHERE id = ?")
          .run(result.verdict, result.riskLevel, token.id);
      } catch (e) {
        console.error(`[Background AI] Rug Analysis failed for ${token.symbol}:`, e.message);
      }
    }

    // 2. Process Pending Social Analysis
    const pendingSocial = db.prepare("SELECT * FROM tokens WHERE ai_social_verdict = 'Pending Social Analysis' LIMIT 3").all() as any[];
    for (const token of pendingSocial) {
      console.log(`[Background AI] Analyzing Socials for ${token.symbol} via DeepSeek...`);
      const prompt = `Analyze social sentiment for ${token.symbol}. Website: ${token.website}, Twitter: ${token.twitter}. Return JSON with "verdict" (string), "sentimentScore" (0-100), and "devActivityScore" (0-100).`;
      
      try {
        const response = await axios.post("https://api.deepseek.com/chat/completions", {
          model: "deepseek-chat",
          messages: [{ role: "user", content: prompt }],
          response_format: { type: "json_object" }
        }, { headers: { "Authorization": `Bearer ${apiKey}` } });
        
        const result = JSON.parse(response.data.choices[0].message.content);
        db.prepare("UPDATE tokens SET ai_social_verdict = ?, sentiment_score = ?, dev_activity_score = ? WHERE id = ?")
          .run(result.verdict, result.sentimentScore, result.devActivityScore, token.id);
      } catch (e) {
        console.error(`[Background AI] Social Analysis failed for ${token.symbol}:`, e.message);
      }
    }

    // 3. Process Pending AI Insights
    const pendingInsights = db.prepare("SELECT * FROM learned_patterns WHERE pattern_type = 'pending_ai' LIMIT 3").all() as any[];
    for (const item of pendingInsights) {
      console.log(`[Background AI] Generating Insight for pattern ${item.id} via DeepSeek...`);
      const prompt = `As a crypto trading neural engine, analyze this success pattern and provide a one-sentence technical insight for future scans: "${item.insight}"`;
      
      try {
        const response = await axios.post("https://api.deepseek.com/chat/completions", {
          model: "deepseek-chat",
          messages: [{ role: "user", content: prompt }]
        }, { headers: { "Authorization": `Bearer ${apiKey}` } });
        
        const insight = response.data.choices[0].message.content.trim();
        db.prepare("UPDATE learned_patterns SET insight = ?, pattern_type = 'ai_insight' WHERE id = ?")
          .run(insight, item.id);
      } catch (e) {
        console.error(`[Background AI] Insight generation failed for ${item.id}:`, e.message);
      }
    }

  } catch (e) {
    console.error("[Background AI] Worker error:", e.message);
  }
}

// Start workers
setInterval(scanBoosts, 60000); // Scan boosts every 60s
setInterval(scanNewMints, 120000); // Scan new mints every 2m
setInterval(updatePrices, 30000); // Update prices every 30s
setInterval(analyzePerformanceAndLearn, 3600000); // Learn every 1h
setInterval(runDeepSeekSimulation, 900000); // AI Simulation every 15m
setInterval(runNeuralEngine, 1800000); // Every 30m
setInterval(processBackgroundAI, 300000); // Process background AI every 5m

// --- Express Server ---
async function startServer() {
  const app = express();
  app.use(express.json());

  // API Routes
  app.get("/api/simulation/portfolio", async (req, res) => {
    const portfolioRaw = db.prepare(`
      SELECT tk.id, tk.symbol, tk.name, tk.current_price, tk.chain, tk.address,
             SUM(CASE WHEN t.type IN ('buy', 'buyback') THEN t.tokens_amount ELSE -t.tokens_amount END) as quantity,
             AVG(CASE WHEN t.type IN ('buy', 'buyback') THEN t.price ELSE NULL END) as avg_buy_price
      FROM tokens tk
      JOIN simulation_trades t ON tk.id = t.token_id
      GROUP BY tk.id
      HAVING quantity > 0.000001
    `).all() as any[];

    const portfolio = portfolioRaw.map(t => ({
      id: t.id,
      symbol: t.symbol || '?',
      name: t.name || 'Unknown',
      currentPrice: t.current_price || 0,
      chain: t.chain || 'unknown',
      address: t.address || '',
      quantity: t.quantity || 0,
      avgBuyPrice: t.avg_buy_price || 0,
      totalValue: (t.quantity || 0) * (t.current_price || 0)
    }));

    const totalValue = portfolio.reduce((acc, t) => acc + t.totalValue, 0);
    res.json({ portfolio, totalValue });
  });

  app.post("/api/simulation/manual-buy", async (req, res) => {
    const { tokenAddress, chain, amountUsd, reason } = req.body;
    let token = db.prepare("SELECT * FROM tokens WHERE address = ? AND chain = ?").get(tokenAddress, chain) as any;
    
    if (!token) {
      // Try to fetch from DexScreener if not in DB
      try {
        const dexRes = await axios.get(`https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`);
        const pair = dexRes.data.pairs?.find((p: any) => p.chainId === chain);
        if (pair) {
          db.prepare("INSERT INTO tokens (id, symbol, name, chain, address, current_price, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
            .run(crypto.randomUUID(), pair.baseToken.symbol, pair.baseToken.name, chain, tokenAddress, parseFloat(pair.priceUsd || "0"), Date.now());
          token = db.prepare("SELECT * FROM tokens WHERE address = ? AND chain = ?").get(tokenAddress, chain);
        }
      } catch (e) {
        console.error("Failed to fetch token for manual buy:", e.message);
      }
    }

    if (!token) return res.status(404).json({ error: "Token not found and could not be fetched" });

    const result = await executeSimulationTrade(token.id, token.chain, token.current_price, token.nana_score || 0, token.rug_risk_score || 0, token.buy_pressure || 0, token.insider_probability || 0, token.sentiment_score || 0, amountUsd, reason || "Manual User Buy");
    
    if (!result.success) return res.status(400).json({ error: result.error });

    await learnFromUserAction(token.id, 'buy', reason || "Manual User Buy");

    db.prepare("INSERT INTO user_actions (action_type, token_id, amount_usd, timestamp) VALUES (?, ?, ?, ?)")
      .run('manual_buy', token.id, amountUsd, Date.now());

    res.json({ success: true });
  });

  app.post("/api/simulation/manual-sell", async (req, res) => {
    const { tokenAddress, chain, percentage, reason } = req.body;
    const token = db.prepare("SELECT * FROM tokens WHERE address = ? AND chain = ?").get(tokenAddress, chain) as any;
    if (!token) return res.status(404).json({ error: "Token not found" });

    const result = await executeManualSell(token.id, percentage / 100, reason || "Manual User Sell");
    
    if (!result.success) return res.status(400).json({ error: result.error });

    await learnFromUserAction(token.id, 'sell', reason || "Manual User Sell");

    db.prepare("INSERT INTO user_actions (action_type, token_id, percentage, timestamp) VALUES (?, ?, ?, ?)")
      .run('manual_sell', token.id, percentage, Date.now());

    res.json({ success: true });
  });
  app.post("/api/ai/deepseek", async (req, res) => {
    const { prompt } = req.body;
    const apiKey = process.env.DEEPSEEK_API_KEY;
    
    if (!apiKey) return res.status(400).json({ error: "DeepSeek API Key not configured" });

    try {
      const response = await axios.post("https://api.deepseek.com/chat/completions", {
        model: "deepseek-chat",
        messages: [
          { role: "system", content: "You are a crypto security analyst. Always return valid JSON." },
          { role: "user", content: prompt }
        ],
        response_format: { type: "json_object" }
      }, {
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`
        },
        timeout: 45000 // 45 second timeout
      });
      
      console.log(`[DeepSeek API] Success. Response length: ${response.data.choices[0].message.content.length}`);
      res.json({ content: response.data.choices[0].message.content });
    } catch (e: any) {
      const errorData = e.response?.data;
      const errorMessage = errorData?.error?.message || errorData?.message || e.message;
      
      if (e.code === 'ECONNABORTED') {
        console.error("[DeepSeek API] Request timed out after 45s");
        return res.status(504).json({ error: "DeepSeek API timed out. The model is likely overloaded." });
      }

      console.error("[DeepSeek API] Error:", errorData || e.message);
      res.status(e.response?.status || 500).json({ 
        error: errorMessage,
        details: errorData
      });
    }
  });

  app.get("/api/health", (req, res) => {
    const scanningActive = getConfig.get("scanning_active")?.value === "true";
    const tokenCount = db.prepare("SELECT COUNT(*) as count FROM tokens").get() as any;
    const tradeCount = db.prepare("SELECT COUNT(*) as count FROM simulation_trades").get() as any;
    res.json({ 
      status: "ok", 
      timestamp: Date.now(),
      scanning: scanningActive,
      lastScan: lastScanTimestamp,
      database: {
        tokens: tokenCount.count,
        trades: tradeCount.count
      }
    });
  });

  app.post("/api/simulate-token", async (req, res) => {
    try {
      // Fetch a random trending token from DexScreener to simulate a detection
      const response = await axios.get('https://api.dexscreener.com/token-profiles/latest/v1');
      const profiles = response.data || [];
      if (profiles.length > 0) {
        const randomToken = profiles[Math.floor(Math.random() * profiles.length)];
        // We bypass filters for simulation
        const pair = await fetchTokenDetails(randomToken.tokenAddress);
        if (pair) {
          const id = Math.random().toString(36).substring(7);
          const price = parseFloat(pair.priceUsd || "0");
          db.prepare(`
            INSERT INTO tokens (id, symbol, name, chain, address, boost_level, liquidity, buy_pressure, nana_score, rug_risk_score, insider_probability, wallet_risk, market_cap, cto_status, call_price, current_price, ath_price, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            id, pair.baseToken.symbol, pair.baseToken.name, pair.chainId, randomToken.tokenAddress, 
            100, pair.liquidity?.usd || 0, 0.8, 
            75.5, 15.2, 5, 10, pair.fdv || 0,
            0, price, price, price, Date.now()
          );
          return res.json({ success: true, symbol: pair.baseToken.symbol });
        }
      }
      res.status(400).json({ error: "Could not find a token to simulate" });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post("/api/signup", (req, res) => {
    const { email, password } = req.body;
    const id = Math.random().toString(36).substring(7);
    try {
      db.prepare("INSERT INTO users (id, email, password, created_at) VALUES (?, ?, ?, ?)")
        .run(id, email, password, Date.now());
      res.json({ success: true, user: { id, email } });
    } catch (e) {
      res.status(400).json({ error: "Email already exists" });
    }
  });

  app.post("/api/login", (req, res) => {
    const { email, password } = req.body;
    const user = db.prepare("SELECT * FROM users WHERE email = ? AND password = ?").get(email, password) as any;
    if (user) {
      res.json({ success: true, user: { id: user.id, email: user.email } });
    } else {
      res.status(401).json({ error: "Invalid credentials" });
    }
  });

  app.get("/api/tokens", (req, res) => {
    try {
      const tokens = db.prepare("SELECT * FROM tokens ORDER BY created_at DESC LIMIT 500").all();
      console.log(`[API] Returning ${tokens.length} tokens to client.`);
      res.json(tokens);
    } catch (e) {
      console.error("[API] Error fetching tokens:", e.message);
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/tokens/history", (req, res) => {
    const tokens = db.prepare("SELECT * FROM tokens ORDER BY created_at DESC LIMIT 2000").all();
    res.json(tokens);
  });

  app.get("/api/rugs", (req, res) => {
    const rugs = db.prepare("SELECT * FROM rugs ORDER BY timestamp DESC LIMIT 10").all();
    res.json(rugs);
  });

  app.get("/api/insights", (req, res) => {
    const insights = db.prepare("SELECT * FROM learned_patterns ORDER BY timestamp DESC LIMIT 20").all();
    res.json(insights);
  });

  app.get("/api/simulation/trades", (req, res) => {
    const trades = db.prepare("SELECT t.*, tk.symbol, tk.chain FROM simulation_trades t JOIN tokens tk ON t.token_id = tk.id ORDER BY t.timestamp DESC LIMIT 50").all();
    res.json(trades);
  });

  app.get("/api/simulation/stats", (req, res) => {
    const balances = db.prepare("SELECT * FROM simulation_balance").all();
    const profit = db.prepare("SELECT SUM(profit_usd) as total FROM simulation_trades WHERE type = 'sell'").get() as any;
    res.json({ balances, totalProfit: profit.total || 0 });
  });

  app.get("/api/wallets", (req, res) => {
    const wallets = db.prepare("SELECT * FROM monitored_wallets").all();
    res.json(wallets);
  });

  app.get("/api/debug/db", (req, res) => {
    try {
      const tokenCount = db.prepare("SELECT COUNT(*) as count FROM tokens").get() as any;
      const rugCount = db.prepare("SELECT COUNT(*) as count FROM rugs").get() as any;
      const tradeCount = db.prepare("SELECT COUNT(*) as count FROM simulation_trades").get() as any;
      const insightCount = db.prepare("SELECT COUNT(*) as count FROM learned_patterns").get() as any;
      
      res.json({
        tokens: tokenCount.count,
        rugs: rugCount.count,
        trades: tradeCount.count,
        insights: insightCount.count,
        timestamp: Date.now()
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/test", async (req, res) => {
    try {
      const botOk = bot !== null;
      const dbOk = db.prepare("SELECT 1").get() !== undefined;
      res.json({ 
        status: "ok", 
        bot: botOk, 
        db: dbOk, 
        timestamp: Date.now() 
      });
    } catch (e) {
      res.status(500).json({ status: "error", message: e.message });
    }
  });

  app.post("/api/tokens/analyze", (req, res) => {
    const { id, ai_rug_verdict, ai_rug_risk_level, ai_social_verdict, sentiment_score, dev_activity_score, nana_score, dev_is_selling } = req.body;
    try {
      db.prepare(`
        UPDATE tokens 
        SET ai_rug_verdict = ?, ai_rug_risk_level = ?, ai_social_verdict = ?, sentiment_score = ?, dev_activity_score = ?, nana_score = ?, dev_is_selling = ?
        WHERE id = ?
      `).run(ai_rug_verdict, ai_rug_risk_level, ai_social_verdict, sentiment_score, dev_activity_score, nana_score, dev_is_selling || 0, id);
      res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/config", (req, res) => {
    const userId = req.query.userId as string;
    if (userId) {
      const config = getAllUserConfigs.all(userId) as any[];
      const configObj = config.reduce((acc: any, curr: any) => {
        acc[curr.key] = curr.value;
        return acc;
      }, {});
      // Merge with global defaults if missing
      const globalConfig = db.prepare("SELECT * FROM config").all() as any[];
      globalConfig.forEach(c => {
        if (configObj[c.key] === undefined) {
          configObj[c.key] = c.value;
        }
      });
      return res.json(configObj);
    }
    const config = db.prepare("SELECT * FROM config").all();
    const configObj = config.reduce((acc: any, curr: any) => {
      acc[curr.key] = curr.value;
      return acc;
    }, {});
    res.json(configObj);
  });

  app.post("/api/config", async (req, res) => {
    const { key, value, userId } = req.body;
    if (userId) {
      setUserConfig.run(userId, key, value);
    } else {
      setConfig.run(key, value);
    }
    
    if (key === "telegram_token" || key === "alerts_enabled") {
      await initBot();
    }
    res.json({ success: true });
  });

  app.post("/api/toggle-scanning", (req, res) => {
    console.log("[API] Toggle scanning requested. UserID:", req.query.userId);
    try {
      const userId = req.query.userId as string;
      
      // Get current global state
      const globalCurrent = getConfig.get("scanning_active")?.value || "true";
      const next = globalCurrent === "true" ? "false" : "true";
      
      // Update global state
      setConfig.run("scanning_active", next);
      
      // If userId provided, also update user-specific state for UI consistency
      if (userId) {
        setUserConfig.run(userId, "scanning_active", next);
        console.log(`[API] Scanning toggled for user ${userId} and GLOBALLY: ${next}`);
      } else {
        console.log(`[API] Global scanning toggled: ${next}`);
      }
      
      res.json({ success: true, scanning_active: next });
    } catch (e) {
      console.error("[API] Toggle scanning error:", e.message);
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/neural/weights", (req, res) => {
    try {
      const weights = db.prepare("SELECT * FROM neural_weights").all();
      res.json(weights);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.get("/api/stats", (req, res) => {
    const totalCalls = db.prepare("SELECT COUNT(*) as count FROM tokens").get() as any;
    const avgScore = db.prepare("SELECT AVG(nana_score) as avg FROM tokens").get() as any;
    const avgSentiment = db.prepare("SELECT AVG(sentiment_score) as avg FROM tokens").get() as any;
    const explosive = db.prepare("SELECT COUNT(*) as count FROM tokens WHERE ath_price / call_price >= 5").get() as any;
    const winners = db.prepare("SELECT COUNT(*) as count FROM tokens WHERE ath_price / call_price >= 2").get() as any;
    
    const winRate = totalCalls.count > 0 ? (winners.count / totalCalls.count) * 100 : 0;

    res.json({
      totalCalls: totalCalls.count,
      avgScore: avgScore.avg || 0,
      avgSentiment: avgSentiment.avg || 0,
      explosive: explosive.count,
      winRate: winRate,
      rugPrevention: 94.2 // Mocked for now as we don't track all scanned rugs yet
    });
  });

  app.post("/api/insights/update", (req, res) => {
    const { id, insight } = req.body;
    if (!id || !insight) return res.status(400).json({ error: "Missing ID or insight" });
    
    db.prepare("UPDATE learned_patterns SET insight = ?, pattern_type = 'ai_insight' WHERE id = ?")
      .run(insight, id);
      
    res.json({ success: true });
  });

  // Global error handler
  app.use((err: any, req: any, res: any, next: any) => {
    console.error("Express Error:", err);
    if (req?.path?.startsWith("/api/")) {
      res.status(500).json({ error: "Internal Server Error", message: err.message });
    } else {
      next(err);
    }
  });

  // 404 for API
  app.use("/api/*", (req, res) => {
    res.status(404).json({ error: `API route not found: ${req.originalUrl}` });
  });

  // Vite middleware
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const PORT = 3000;
  const server = app.listen(PORT, "0.0.0.0", async () => {
    console.log(`DEGENICS ANGEL running on http://localhost:${PORT}`);
    await initBot();
  });

  // Graceful shutdown
  process.on('SIGTERM', async () => {
    console.log('SIGTERM signal received: closing HTTP server');
    if (bot) {
      await bot.stopPolling();
    }
    server.close(() => {
      console.log('HTTP server closed');
      process.exit(0);
    });
  });

  process.on('SIGINT', async () => {
    console.log('SIGINT signal received: closing HTTP server');
    if (bot) {
      await bot.stopPolling();
    }
    server.close(() => {
      console.log('HTTP server closed');
      process.exit(0);
    });
  });
}

startServer();
