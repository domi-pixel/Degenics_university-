import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import Database from 'better-sqlite3';
import TelegramBot from 'node-telegram-bot-api';
import dotenv from 'dotenv';
import axios from 'axios';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const db = new Database('degenics.db');

// Initialize Database
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE,
    password TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    address TEXT,
    symbol TEXT,
    chain TEXT,
    nana_score REAL,
    rug_risk_score REAL,
    insider_probability REAL,
    sentiment_score REAL,
    buy_pressure REAL,
    current_price REAL,
    call_price REAL,
    ath_price REAL,
    market_cap REAL,
    liquidity REAL,
    cto_status INTEGER,
    ai_rug_risk_level TEXT,
    ai_rug_verdict TEXT,
    ai_social_verdict TEXT,
    dev_activity_score REAL DEFAULT 0,
    alert_2x_sent INTEGER DEFAULT 0,
    alert_5x_sent INTEGER DEFAULT 0,
    alert_20x_sent INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_tokens_address ON tokens(address);
  CREATE INDEX IF NOT EXISTS idx_tokens_created_at ON tokens(created_at);

  CREATE TABLE IF NOT EXISTS config (
    user_id INTEGER,
    key TEXT,
    value TEXT,
    PRIMARY KEY (user_id, key)
  );
`);

// Seed default config if not exists
const defaultConfigInitial = [
  [null, 'scanning_active', 'true'],
  [null, 'min_nana_score', '70'],
  [null, 'min_liquidity', '5000'],
  [null, 'max_rug_score', '50'],
  [null, 'telegram_group_id', '']
];
const insertConfigInitial = db.prepare('INSERT OR IGNORE INTO config (user_id, key, value) VALUES (?, ?, ?)');
defaultConfigInitial.forEach(([uid, k, v]) => insertConfigInitial.run(uid, k, v));

db.exec(`

  CREATE TABLE IF NOT EXISTS rugs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    address TEXT,
    reason TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS insights (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    address TEXT,
    insight TEXT,
    weight_adjustment REAL,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS simulation_trades (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    address TEXT,
    symbol TEXT,
    chain TEXT,
    type TEXT,
    amount_usd REAL,
    price REAL,
    profit_usd REAL,
    reason TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS portfolio (
    user_id INTEGER,
    address TEXT,
    symbol TEXT,
    chain TEXT,
    quantity REAL,
    avg_buy_price REAL,
    current_price REAL,
    total_value REAL,
    PRIMARY KEY (user_id, address)
  );

  CREATE TABLE IF NOT EXISTS neural_weights (
    factor TEXT PRIMARY KEY,
    weight REAL
  );

  CREATE TABLE IF NOT EXISTS balances (
    user_id INTEGER,
    chain TEXT,
    balance REAL,
    PRIMARY KEY (user_id, chain)
  );
`);

// Seed default balances
const initialBalances = [
  ['solana', 100.00],
  ['ethereum', 100.00],
  ['base', 100.00]
];
const insertBalance = db.prepare('INSERT OR IGNORE INTO balances (user_id, chain, balance) VALUES (?, ?, ?)');
initialBalances.forEach(([chain, balance]) => insertBalance.run(null, chain, balance));

// Migration: Ensure users has created_at column
try {
  db.prepare("SELECT created_at FROM users LIMIT 1").get();
} catch (e) {
  console.log('Migrating users: adding created_at column');
  try {
    db.exec("ALTER TABLE users ADD COLUMN created_at DATETIME DEFAULT CURRENT_TIMESTAMP");
  } catch (err) {
    console.error('Migration failed (maybe column exists):', err);
  }
}

// Migration: Ensure config has user_id column
try {
  db.prepare("SELECT user_id FROM config LIMIT 1").get();
} catch (e) {
  console.log('Migrating config: adding user_id column');
  try {
    // We'll recreate the table to handle the new primary key
    db.exec(`
      CREATE TABLE config_new (
        user_id INTEGER,
        key TEXT,
        value TEXT,
        PRIMARY KEY (user_id, key)
      );
      INSERT INTO config_new (user_id, key, value) SELECT NULL, key, value FROM config;
      DROP TABLE config;
      ALTER TABLE config_new RENAME TO config;
    `);
  } catch (err) {
    console.error('Migration failed:', err);
  }
}

// Clear all existing telegram tokens
try {
  db.prepare("DELETE FROM config WHERE key = ?").run('telegram_token');
} catch (e) {}

// Migration: Ensure simulation_trades has user_id column
try {
  db.prepare("SELECT user_id FROM simulation_trades LIMIT 1").get();
} catch (e) {
  console.log('Migrating simulation_trades: adding user_id column');
  try {
    db.exec("ALTER TABLE simulation_trades ADD COLUMN user_id INTEGER");
  } catch (err) {
    console.error('Migration failed:', err);
  }
}

// Migration: Ensure portfolio has user_id column
try {
  db.prepare("SELECT user_id FROM portfolio LIMIT 1").get();
} catch (e) {
  console.log('Migrating portfolio: adding user_id column');
  try {
    // SQLite doesn't support adding a column with PRIMARY KEY constraint easily
    // We'll just add the column and handle the logic in code for now, or recreate table
    db.exec("ALTER TABLE portfolio ADD COLUMN user_id INTEGER");
  } catch (err) {
    console.error('Migration failed:', err);
  }
}

// Migration: Ensure balances has user_id column
try {
  db.prepare("SELECT user_id FROM balances LIMIT 1").get();
} catch (e) {
  console.log('Migrating balances: adding user_id column');
  try {
    db.exec("ALTER TABLE balances ADD COLUMN user_id INTEGER");
  } catch (err) {
    console.error('Migration failed:', err);
  }
}

// Migration: Ensure simulation_trades has address column
try {
  db.prepare("SELECT address FROM simulation_trades LIMIT 1").get();
} catch (e) {
  console.log('Migrating simulation_trades: adding address column');
  try {
    db.exec("ALTER TABLE simulation_trades ADD COLUMN address TEXT");
  } catch (err) {
    console.error('Migration failed (maybe column exists):', err);
  }
}

// Migration: Ensure tokens has alert tracking columns
try {
  db.prepare("SELECT alert_2x_sent FROM tokens LIMIT 1").get();
} catch (e) {
  console.log('Migrating tokens: adding alert tracking columns');
  try {
    db.exec("ALTER TABLE tokens ADD COLUMN alert_2x_sent INTEGER DEFAULT 0");
    db.exec("ALTER TABLE tokens ADD COLUMN alert_5x_sent INTEGER DEFAULT 0");
    db.exec("ALTER TABLE tokens ADD COLUMN alert_20x_sent INTEGER DEFAULT 0");
  } catch (err) {
    console.error('Migration failed:', err);
  }
}

// Migration: Ensure insights has address column
try {
  db.prepare("SELECT address FROM insights LIMIT 1").get();
} catch (e) {
  console.log('Migrating insights: adding address column');
  try {
    db.exec("ALTER TABLE insights ADD COLUMN address TEXT");
  } catch (err) {
    console.error('Migration failed:', err);
  }
}

// Migration: Update neural weights factors
try {
  db.prepare("UPDATE neural_weights SET factor = 'Dev Activity' WHERE factor = 'Dev History'").run();
  db.prepare("INSERT OR IGNORE INTO neural_weights (factor, weight) VALUES ('Rug Risk', 0.10)").run();
} catch (err) {
  console.error('Neural weights migration failed:', err);
}

// Seed default config
const defaultConfigGlobal = [
  ['scanning_active', 'true'],
  ['min_nana_score', '70'],
  ['risk_mode', 'balanced'],
  ['risk_tolerance', '1.0'],
  ['profit_target', '1.5'],
  ['alerts_enabled', 'false'],
  ['telegram_token', ''],
  ['chat_id', ''],
  ['ai_provider', 'gemini'],
  ['ai_switch_mode', 'auto'],
  ['scanned_chains', 'solana,ethereum,base']
];

const insertConfigGlobal = db.prepare('INSERT OR IGNORE INTO config (user_id, key, value) VALUES (NULL, ?, ?)');
defaultConfigGlobal.forEach(([key, value]) => insertConfigGlobal.run(key, value));

// Neural Weights (initial)
const initialWeights = [
  { factor: 'Liquidity Depth', weight: 0.30 },
  { factor: 'Holder Distribution', weight: 0.20 },
  { factor: 'Social Velocity', weight: 0.20 },
  { factor: 'Dev Activity', weight: 0.20 },
  { factor: 'Rug Risk', weight: 0.10 }
];

const insertWeight = db.prepare('INSERT OR IGNORE INTO neural_weights (factor, weight) VALUES (?, ?)');
initialWeights.forEach(w => insertWeight.run(w.factor, w.weight));

function getNeuralWeights() {
  return db.prepare('SELECT * FROM neural_weights').all();
}

function calculateNanaScore(factors: any) {
  const weights = getNeuralWeights();
  let score = 0;
  weights.forEach((w: any) => {
    if (factors[w.factor] !== undefined) {
      if (w.factor === 'Rug Risk') {
        // Rug risk is a negative factor
        score -= factors[w.factor] * w.weight;
      } else {
        score += factors[w.factor] * w.weight;
      }
    }
  });
  return Math.min(100, Math.max(0, score));
}

async function learnFromTrades() {
  console.log('[Neural Engine] Learning from recent performance...');
  
  const weights = getNeuralWeights();
  const learningRate = 0.02; // Slightly higher learning rate for faster adaptation

  // 1. Learn from Simulation Trades (Realized Profit/Loss)
  const recentSells = db.prepare(`
    SELECT t.*, tok.liquidity, tok.sentiment_score, tok.dev_activity_score, tok.rug_risk_score
    FROM simulation_trades t
    JOIN tokens tok ON t.address = tok.address
    WHERE t.type = 'sell' AND t.timestamp > datetime('now', '-24 hours')
  `).all();

  recentSells.forEach((trade: any) => {
    const isProfitable = trade.profit_usd > 0;
    const adjustment = isProfitable ? learningRate : -learningRate;

    weights.forEach((w: any) => {
      let factorValue = 0.5;
      if (w.factor === 'Liquidity Depth') factorValue = Math.min(1, trade.liquidity / 25000);
      if (w.factor === 'Social Velocity') factorValue = trade.sentiment_score / 100;
      if (w.factor === 'Dev Activity') factorValue = trade.dev_activity_score / 100;
      if (w.factor === 'Rug Risk') factorValue = trade.rug_risk_score / 100;
      if (w.factor === 'Holder Distribution') factorValue = 0.75;

      // For negative factors like Rug Risk, a "good" value is LOW
      const normalizedValue = w.factor === 'Rug Risk' ? (1 - factorValue) : factorValue;
      w.weight += adjustment * (normalizedValue - 0.5);
    });
  });

  // 2. Learn from "Natural Winners" (Tokens that hit 2x+ regardless of simulation)
  const naturalWinners = db.prepare(`
    SELECT * FROM tokens 
    WHERE created_at > datetime('now', '-24 hours') 
    AND call_price > 0 AND ath_price >= call_price * 2
  `).all();

  naturalWinners.forEach((token: any) => {
    const multiplier = token.ath_price / token.call_price;
    const adjustment = learningRate * Math.min(2, multiplier / 2); // Scale adjustment by performance

    weights.forEach((w: any) => {
      let factorValue = 0.5;
      if (w.factor === 'Liquidity Depth') factorValue = Math.min(1, token.liquidity / 25000);
      if (w.factor === 'Social Velocity') factorValue = token.sentiment_score / 100;
      if (w.factor === 'Dev Activity') factorValue = token.dev_activity_score / 100;
      if (w.factor === 'Rug Risk') factorValue = token.rug_risk_score / 100;
      if (w.factor === 'Holder Distribution') factorValue = 0.75;

      const normalizedValue = w.factor === 'Rug Risk' ? (1 - factorValue) : factorValue;
      w.weight += adjustment * (normalizedValue - 0.5);
    });
  });

  // 3. Learn from Manual Insights
  const manualInsights = db.prepare(`
    SELECT * FROM insights 
    WHERE timestamp > datetime('now', '-24 hours') AND address IS NOT NULL
  `).all();

  manualInsights.forEach((insight: any) => {
    const token = db.prepare("SELECT * FROM tokens WHERE address = ?").get(insight.address);
    if (token) {
      const adjustment = insight.weight_adjustment || learningRate;
      weights.forEach((w: any) => {
        let factorValue = 0.5;
        if (w.factor === 'Liquidity Depth') factorValue = Math.min(1, token.liquidity / 25000);
        if (w.factor === 'Social Velocity') factorValue = token.sentiment_score / 100;
        if (w.factor === 'Dev Activity') factorValue = token.dev_activity_score / 100;
        if (w.factor === 'Rug Risk') factorValue = token.rug_risk_score / 100;
        if (w.factor === 'Holder Distribution') factorValue = 0.75;

        const normalizedValue = w.factor === 'Rug Risk' ? (1 - factorValue) : factorValue;
        w.weight += adjustment * (normalizedValue - 0.5);
      });
    }
  });

  if (recentSells.length === 0 && naturalWinners.length === 0 && manualInsights.length === 0) return;

  // Normalize weights
  const totalWeight = weights.reduce((acc: number, w: any) => acc + Math.max(0.01, w.weight), 0);
  weights.forEach((w: any) => {
    w.weight = Math.max(0.01, w.weight) / totalWeight;
    db.prepare('UPDATE neural_weights SET weight = ? WHERE factor = ?').run(w.weight, w.factor);
  });

  const topFactor = weights.sort((a: any, b: any) => b.weight - a.weight)[0];
  db.prepare('INSERT INTO insights (insight, weight_adjustment) VALUES (?, ?)')
    .run(`Neural Engine optimized: Increased focus on ${topFactor.factor} based on ${recentSells.length} trades and ${naturalWinners.length} winners.`, 0.05);
}

// Telegram Bot Setup
const GENERAL_BOT_TOKEN = process.env.TELEGRAM_TOKEN || '7865663467:AAH4umyxZ1-IpjjxqwzDhYyA8ypmizI_J8I';
let bot: TelegramBot | null = null;
function initBot() {
  const token = GENERAL_BOT_TOKEN;
  if (token && token.trim() !== '' && token !== 'YOUR_TELEGRAM_BOT_TOKEN') {
    try {
      if (bot) {
        bot.stopPolling();
      }
      bot = new TelegramBot(token, { 
        polling: {
          interval: 1000,
          autoStart: true,
          params: {
            timeout: 10
          }
        } 
      });
      console.log(`Telegram Bot Initialized (Token: ${token.substring(0, 5)}...)`);
      
      bot.on('message', async (msg) => {
        try {
          const chatId = msg.chat.id;
          const text = msg.text || '';
          
          console.log(`[Telegram] Received message from ${chatId}: ${text}`);

          if (text === '/start') {
            await bot?.sendMessage(chatId, `👼 *Welcome to Degenics Angel*\n\nYour Chat ID is: \`${chatId}\`\n\nAdd this ID to your Config in the dashboard to receive real-time alerts.\n\nType /commands to see what I can do.`, { parse_mode: 'Markdown' });
            return;
          }

        if (text === '/commands' || text === '/help') {
          const help = `👼 *DEGENICS ANGEL COMMANDS*

/status - Check system health and scanning state
/performance - View win rate and ROI stats
/portfolio - View your current simulation holdings
/settings - View your current risk and profit settings
/top - See top 5 tokens by Nana Score
/recent (alias: /signals) - View the 5 most recent signals
/filters - View current scanning parameters
/insights - View latest AI learned patterns
/learn <address> <reason> - Ingest a successful token for pattern learning
/chatid (alias: /id) - Get your Telegram User ID
/testalert (alias: /test) - Test your alert connection
/setrisk <val> - Set risk tolerance (0.1 - 3.0)
/setprofit <val> - Set profit target ROI (1.1 - 5.0)
/buy <address> <amount> - Manual simulation buy (USD)
/sell <address> <percent> - Manual simulation sell (%)
/reset - Reset your simulation balances
/pause - Pause the scanning engine
/resume - Resume the scanning engine
/history - View top 20 tokens by ATH performance (Overall)
/history24 - View top 20 tokens by ATH performance (Last 24h)
/config_group <id> - Set your Telegram Group ID for alerts
/commands (alias: /help) - Show this list`;
          await bot?.sendMessage(chatId, help, { parse_mode: 'Markdown' });
          return;
        }

        if (text === '/chatid' || text === '/id') {
          await bot?.sendMessage(chatId, `Your Chat ID is: \`${chatId}\``, { parse_mode: 'Markdown' });
          return;
        }

        const user = db.prepare("SELECT user_id FROM config WHERE key = 'chat_id' AND value = ?").get(chatId.toString());
        const userId = user ? user.user_id : null;

        if (text === '/portfolio') {
          if (!userId) {
            await bot?.sendMessage(chatId, "👼 *Portfolio*\n\n_Your Telegram account is not linked to a Degenics user. Please set your Chat ID in the dashboard settings._", { parse_mode: 'Markdown' });
            return;
          }
          const holdings = db.prepare("SELECT * FROM portfolio WHERE user_id = ?").all(userId);
          const balances = db.prepare("SELECT chain, balance FROM balances WHERE user_id = ?").all(userId);
          
          let msgText = `👼 *Your Simulation Portfolio*\n\n`;
          
          msgText += `*Balances:*\n`;
          balances.forEach((b: any) => {
            msgText += `• ${b.chain.toUpperCase()}: $${b.balance.toFixed(2)}\n`;
          });
          
          msgText += `\n*Holdings:*\n`;
          if (holdings.length === 0) {
            msgText += "_No active holdings._";
          } else {
            holdings.forEach((h: any) => {
              const roi = ((h.current_price / h.avg_buy_price - 1) * 100).toFixed(1);
              msgText += `• *${h.symbol}*: $${h.total_value.toFixed(2)} (${roi}%)\n  \`${h.address}\`\n`;
            });
          }
          await bot?.sendMessage(chatId, msgText, { parse_mode: 'Markdown' });
          return;
        }

        if (text === '/settings') {
          const risk = db.prepare("SELECT value FROM config WHERE key = 'risk_tolerance' AND (user_id = ? OR user_id IS NULL) ORDER BY user_id DESC").get(userId)?.value || '1.0';
          const profit = db.prepare("SELECT value FROM config WHERE key = 'profit_target' AND (user_id = ? OR user_id IS NULL) ORDER BY user_id DESC").get(userId)?.value || '2.0';
          const alerts = db.prepare("SELECT value FROM config WHERE key = 'alerts_enabled' AND (user_id = ? OR user_id IS NULL) ORDER BY user_id DESC").get(userId)?.value || 'true';
          
          const settings = `👼 *Your Settings*

*Risk Tolerance:* ${risk}
*Profit Target:* ${profit}x
*Alerts:* ${alerts === 'true' ? '🟢 ON' : '🔴 OFF'}
*User ID:* ${userId || 'Global Default'}`;
          await bot?.sendMessage(chatId, settings, { parse_mode: 'Markdown' });
          return;
        }

        if (text === '/reset') {
          if (!userId) {
            await bot?.sendMessage(chatId, "Please link your Chat ID in the dashboard first.");
            return;
          }
          db.prepare('UPDATE balances SET balance = 100.00 WHERE user_id = ?').run(userId);
          db.prepare('DELETE FROM portfolio WHERE user_id = ?').run(userId);
          await bot?.sendMessage(chatId, "👼 *Simulation Reset*\n\nYour balances have been reset to $100 per chain and holdings cleared.", { parse_mode: 'Markdown' });
          return;
        }

        if (text.startsWith('/buy ')) {
          if (!userId) {
            await bot?.sendMessage(chatId, "Please link your Chat ID in the dashboard first.");
            return;
          }
          const parts = text.split(' ');
          if (parts.length < 3) {
            await bot?.sendMessage(chatId, "Usage: /buy <address> <amount_usd>");
            return;
          }
          const address = parts[1];
          const amount = parseFloat(parts[2]);
          
          if (isNaN(amount) || amount <= 0) {
            await bot?.sendMessage(chatId, "Invalid amount.");
            return;
          }

          try {
            const pairRes = await axios.get(`https://api.dexscreener.com/latest/dex/tokens/${address}`);
            const pair = pairRes.data.pairs?.[0];
            if (!pair) {
              await bot?.sendMessage(chatId, "Token not found on DexScreener.");
              return;
            }

            const chain = pair.chainId;
            const price = parseFloat(pair.priceUsd);
            const balance = db.prepare('SELECT balance FROM balances WHERE user_id = ? AND chain = ?').get(userId, chain)?.balance || 0;

            if (balance < amount) {
              await bot?.sendMessage(chatId, `Insufficient balance on ${chain}. Current: $${balance.toFixed(2)}`);
              return;
            }

            const qty = amount / price;
            db.prepare('UPDATE balances SET balance = balance - ? WHERE user_id = ? AND chain = ?').run(amount, userId, chain);
            db.prepare('INSERT OR REPLACE INTO portfolio (user_id, address, symbol, chain, quantity, avg_buy_price, current_price, total_value) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
              .run(userId, address, pair.baseToken.symbol, chain, qty, price, price, amount);
            
            db.prepare('INSERT INTO simulation_trades (user_id, address, symbol, chain, type, amount_usd, price, reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
              .run(userId, address, pair.baseToken.symbol, chain, 'buy', amount, price, 'Manual Telegram Buy');

            await bot?.sendMessage(chatId, `👼 *Manual Buy Success*\n\nBought ${qty.toFixed(2)} ${pair.baseToken.symbol} for $${amount.toFixed(2)} on ${chain}.`, { parse_mode: 'Markdown' });
          } catch (e) {
            await bot?.sendMessage(chatId, "Error processing buy order.");
          }
          return;
        }

        if (text.startsWith('/sell ')) {
          if (!userId) {
            await bot?.sendMessage(chatId, "Please link your Chat ID in the dashboard first.");
            return;
          }
          const parts = text.split(' ');
          if (parts.length < 3) {
            await bot?.sendMessage(chatId, "Usage: /sell <address> <percent>");
            return;
          }
          const address = parts[1];
          const percent = parseFloat(parts[2]);
          
          if (isNaN(percent) || percent <= 0 || percent > 100) {
            await bot?.sendMessage(chatId, "Invalid percentage (1-100).");
            return;
          }

          const holding = db.prepare('SELECT * FROM portfolio WHERE user_id = ? AND address = ?').get(userId, address);
          if (!holding) {
            await bot?.sendMessage(chatId, "You are not holding this token.");
            return;
          }

          try {
            const pairRes = await axios.get(`https://api.dexscreener.com/latest/dex/tokens/${address}`);
            const pair = pairRes.data.pairs?.find((p: any) => p.chainId === holding.chain) || pairRes.data.pairs?.[0];
            const sellPrice = pair ? parseFloat(pair.priceUsd) : holding.current_price;
            
            const sellQty = holding.quantity * (percent / 100);
            const amountUsd = sellQty * sellPrice;
            const profit = (sellPrice - holding.avg_buy_price) * sellQty;

            db.prepare('INSERT INTO simulation_trades (user_id, address, symbol, chain, type, amount_usd, price, profit_usd, reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
              .run(userId, address, holding.symbol, holding.chain, 'sell', amountUsd, sellPrice, profit, 'Manual Telegram Sell');

            db.prepare('UPDATE balances SET balance = balance + ? WHERE user_id = ? AND chain = ?').run(amountUsd, userId, holding.chain);

            if (percent >= 100) {
              db.prepare('DELETE FROM portfolio WHERE user_id = ? AND address = ?').run(userId, address);
            } else {
              db.prepare('UPDATE portfolio SET quantity = quantity - ?, total_value = (quantity - ?) * ?, current_price = ? WHERE user_id = ? AND address = ?')
                .run(sellQty, sellQty, sellPrice, sellPrice, userId, address);
            }

            await bot?.sendMessage(chatId, `👼 *Manual Sell Success*\n\nSold ${percent}% of ${holding.symbol} for $${amountUsd.toFixed(2)}.\nProfit/Loss: $${profit.toFixed(2)}`, { parse_mode: 'Markdown' });
          } catch (e) {
            await bot?.sendMessage(chatId, "Error processing sell order.");
          }
          return;
        }

        if (text === '/status') {
            const isActive = db.prepare("SELECT value FROM config WHERE key = ? AND user_id IS NULL").get('scanning_active')?.value === 'true';
            const tokenCount = db.prepare("SELECT COUNT(*) as count FROM tokens").get().count;
            const uptime = Math.floor(process.uptime() / 60);
            
            const status = `👼 *System Status*
            
*Scanner:* ${isActive ? '🟢 ACTIVE' : '🔴 PAUSED'}
*Tokens Tracked:* ${tokenCount}
*Uptime:* ${uptime} minutes
*Last Scan:* ${new Date(lastScan).toLocaleTimeString()}
*Health:* Optimal ⚡️`;
            await bot?.sendMessage(chatId, status, { parse_mode: 'Markdown' });
            return;
          }

          if (text === '/performance') {
            const trades = db.prepare("SELECT profit_usd FROM simulation_trades WHERE type = 'sell'").all();
            const wins = trades.filter((t: any) => t.profit_usd > 0).length;
            const total = trades.length;
            const winRate = total > 0 ? (wins / total * 100).toFixed(1) : 0;
            const totalProfit = trades.reduce((acc: number, t: any) => acc + t.profit_usd, 0).toFixed(2);
            
            const perf = `👼 *Performance Stats*

*Win Rate:* ${winRate}%
*Total Trades:* ${total}
*Total Profit:* $${totalProfit}
*Avg Profit/Trade:* $${total > 0 ? (parseFloat(totalProfit) / total).toFixed(2) : 0}`;
            await bot?.sendMessage(chatId, perf, { parse_mode: 'Markdown' });
            return;
          }

          if (text === '/top') {
            const topTokens = db.prepare("SELECT symbol, nana_score, current_price FROM tokens ORDER BY nana_score DESC LIMIT 5").all();
            let msgText = `👼 *Top 5 Tokens by Nana Score*\n\n`;
            topTokens.forEach((t: any, i: number) => {
              msgText += `${i+1}. *${t.symbol}* - Score: ${t.nana_score.toFixed(1)} ($${t.current_price.toFixed(8)})\n`;
            });
            await bot?.sendMessage(chatId, msgText, { parse_mode: 'Markdown' });
            return;
          }

          if (text === '/recent' || text === '/signals') {
            const recentTokens = db.prepare("SELECT symbol, nana_score, created_at FROM tokens ORDER BY created_at DESC LIMIT 5").all();
            let msgText = `👼 *5 Most Recent Signals*\n\n`;
            recentTokens.forEach((t: any, i: number) => {
              msgText += `${i+1}. *${t.symbol}* - Score: ${t.nana_score.toFixed(1)} (${new Date(t.created_at).toLocaleTimeString()})\n`;
            });
            await bot?.sendMessage(chatId, msgText, { parse_mode: 'Markdown' });
            return;
          }

          if (text === '/filters') {
            const user = db.prepare("SELECT user_id FROM config WHERE key = 'chat_id' AND value = ?").get(chatId.toString());
            const uid = user ? user.user_id : null;
            
            const getConfig = (key: string, defaultVal: string) => {
              return db.prepare("SELECT value FROM config WHERE key = ? AND (user_id = ? OR user_id IS NULL) ORDER BY user_id DESC LIMIT 1").get(key, uid)?.value || defaultVal;
            };

            const minScore = getConfig('min_nana_score', '70');
            const minLiq = getConfig('min_liquidity', '5000');
            const maxRug = getConfig('max_rug_score', '50');
            const alertsEnabled = getConfig('alerts_enabled', 'false');
            
            const filters = `👼 *Current Scanning Filters*

*Min Nana Score:* ${minScore}
*Min Liquidity:* $${minLiq}
*Max Rug Score:* ${maxRug}
*Alerts:* ${alertsEnabled === 'true' ? '✅ Enabled' : '❌ Disabled'}
*Auto-Buy:* Enabled (Global)`;
            await bot?.sendMessage(chatId, filters, { parse_mode: 'Markdown' });
            return;
          }

          if (text === '/insights') {
            const latestInsights = db.prepare("SELECT insight, timestamp FROM insights ORDER BY timestamp DESC LIMIT 3").all();
            let msgText = `👼 *Latest AI Insights*\n\n`;
            if (latestInsights.length === 0) msgText += "_No insights gathered yet._";
            latestInsights.forEach((ins: any) => {
              msgText += `• ${ins.insight} (${new Date(ins.timestamp).toLocaleDateString()})\n\n`;
            });
            await bot?.sendMessage(chatId, msgText, { parse_mode: 'Markdown' });
            return;
          }

          if (text.startsWith('/learn ')) {
            const parts = text.split(' ');
            if (parts.length < 3) {
              await bot?.sendMessage(chatId, "Usage: /learn <address> <reason>");
              return;
            }
            const address = parts[1];
            const reason = parts.slice(2).join(' ');
            db.prepare("INSERT INTO insights (address, insight, weight_adjustment) VALUES (?, ?, ?)").run(address, `Manual Learning: ${reason}`, 0.05);
            await bot?.sendMessage(chatId, `👼 *Learning Ingested*\n\nAddress: \`${address}\`\nReason: ${reason}\n\nAI weights will be adjusted in the next cycle.`, { parse_mode: 'Markdown' });
            return;
          }

          if (text === '/testalert' || text === '/test') {
            await bot?.sendMessage(chatId, "👼 *Alert Test*\n\nYour connection is active. You will receive signals here.", { parse_mode: 'Markdown' });
            return;
          }

          if (text.startsWith('/setrisk ')) {
            const val = parseFloat(text.split(' ')[1]);
            if (isNaN(val) || val < 0.1 || val > 3.0) {
              await bot?.sendMessage(chatId, "Please provide a value between 0.1 and 3.0");
              return;
            }
            const user = db.prepare("SELECT user_id FROM config WHERE key = 'chat_id' AND value = ?").get(chatId.toString());
            const userId = user ? user.user_id : null;
            db.prepare("INSERT OR REPLACE INTO config (user_id, key, value) VALUES (?, ?, ?)").run(userId, 'risk_tolerance', val.toString());
            await bot?.sendMessage(chatId, `👼 *Risk Tolerance Set:* ${val}`);
            return;
          }

          if (text.startsWith('/setprofit ')) {
            const val = parseFloat(text.split(' ')[1]);
            if (isNaN(val) || val < 1.1 || val > 5.0) {
              await bot?.sendMessage(chatId, "Please provide a value between 1.1 and 5.0");
              return;
            }
            const user = db.prepare("SELECT user_id FROM config WHERE key = 'chat_id' AND value = ?").get(chatId.toString());
            const userId = user ? user.user_id : null;
            db.prepare("INSERT OR REPLACE INTO config (user_id, key, value) VALUES (?, ?, ?)").run(userId, 'profit_target', val.toString());
            await bot?.sendMessage(chatId, `👼 *Profit Target Set:* ${val}x`);
            return;
          }

          if (text.startsWith('/setscore ')) {
            const val = parseFloat(text.split(' ')[1]);
            if (isNaN(val) || val < 0 || val > 100) {
              await bot?.sendMessage(chatId, "Please provide a value between 0 and 100");
              return;
            }
            const user = db.prepare("SELECT user_id FROM config WHERE key = 'chat_id' AND value = ?").get(chatId.toString());
            const userId = user ? user.user_id : null;
            db.prepare("INSERT OR REPLACE INTO config (user_id, key, value) VALUES (?, ?, ?)").run(userId, 'min_nana_score', val.toString());
            await bot?.sendMessage(chatId, `👼 *Min Nana Score Set:* ${val}`);
            return;
          }

          if (text.startsWith('/setliq ')) {
            const val = parseFloat(text.split(' ')[1]);
            if (isNaN(val) || val < 0) {
              await bot?.sendMessage(chatId, "Please provide a positive value");
              return;
            }
            const user = db.prepare("SELECT user_id FROM config WHERE key = 'chat_id' AND value = ?").get(chatId.toString());
            const userId = user ? user.user_id : null;
            db.prepare("INSERT OR REPLACE INTO config (user_id, key, value) VALUES (?, ?, ?)").run(userId, 'min_liquidity', val.toString());
            await bot?.sendMessage(chatId, `👼 *Min Liquidity Set:* $${val}`);
            return;
          }

          if (text === '/pause') {
            db.prepare("INSERT OR REPLACE INTO config (user_id, key, value) VALUES (NULL, 'scanning_active', 'false')").run();
            await bot?.sendMessage(chatId, "👼 *Scanning Engine Paused* 🔴");
            return;
          }

          if (text === '/resume') {
            db.prepare("INSERT OR REPLACE INTO config (user_id, key, value) VALUES (NULL, 'scanning_active', 'true')").run();
            await bot?.sendMessage(chatId, "👼 *Scanning Engine Resumed* 🟢");
            return;
          }

          if (text === '/history') {
            const history = db.prepare(`
              SELECT symbol, ath_price, call_price, 
              CASE WHEN call_price > 0 THEN (ath_price / call_price) ELSE 1 END as multiplier 
              FROM tokens 
              WHERE ath_price IS NOT NULL AND call_price IS NOT NULL
              ORDER BY multiplier DESC 
              LIMIT 20
            `).all();

            console.log(`[Telegram] History requested. Found ${history.length} tokens.`);
            
            let msgText = `👼 *Top 20 Signal History (Overall)*\n\n`;
            if (history.length === 0) {
              msgText += "_No signals recorded yet._";
            } else {
              history.forEach((t: any, i: number) => {
                const mult = t.multiplier || 1;
                msgText += `${i+1}. *${t.symbol}* - ATH: $${(t.ath_price || 0).toFixed(6)} (${mult.toFixed(1)}x)\n`;
              });
            }
            await bot?.sendMessage(chatId, msgText, { parse_mode: 'Markdown' });
            return;
          }

          if (text === '/history24') {
            const history = db.prepare(`
              SELECT symbol, ath_price, call_price, 
              CASE WHEN call_price > 0 THEN (ath_price / call_price) ELSE 1 END as multiplier 
              FROM tokens 
              WHERE ath_price IS NOT NULL AND call_price IS NOT NULL 
              AND created_at > datetime('now', '-24 hours')
              ORDER BY multiplier DESC 
              LIMIT 20
            `).all();

            console.log(`[Telegram] History (24h) requested. Found ${history.length} tokens.`);
            
            let msgText = `👼 *Top 20 Signal History (Last 24h)*\n\n`;
            if (history.length === 0) {
              msgText += "_No signals recorded in the last 24 hours._";
            } else {
              history.forEach((t: any, i: number) => {
                const mult = t.multiplier || 1;
                msgText += `${i+1}. *${t.symbol}* - ATH: $${(t.ath_price || 0).toFixed(6)} (${mult.toFixed(1)}x)\n`;
              });
            }
            await bot?.sendMessage(chatId, msgText, { parse_mode: 'Markdown' });
            return;
          }

          if (text.startsWith('/config_group ')) {
            const groupId = text.split(' ')[1];
            if (!groupId) {
              await bot?.sendMessage(chatId, "Usage: /config_group <group_id>");
              return;
            }
            const user = db.prepare("SELECT user_id FROM config WHERE key = 'chat_id' AND value = ?").get(chatId.toString());
            const userId = user ? user.user_id : null;
            db.prepare("INSERT OR REPLACE INTO config (user_id, key, value) VALUES (?, ?, ?)").run(userId, 'telegram_group_id', groupId);
            await bot?.sendMessage(chatId, `👼 *Telegram Group ID Set:* \`${groupId}\``, { parse_mode: 'Markdown' });
            return;
          }
        } catch (err) {
          console.error('[Telegram] Message Handler Error:', err);
        }
      });

      bot.on('polling_error', (error: any) => {
        // Ignore common transient errors
        if (error.message.includes('409 Conflict') || error.message.includes('502 Bad Gateway')) {
          return;
        }
        
        console.error('Telegram Polling Error:', error.message);
        
        if (error.message.includes('404 Not Found')) {
          console.error('CRITICAL: Telegram Token is invalid (404). Please update TELEGRAM_TOKEN in Settings.');
          bot?.stopPolling();
          bot = null;
        }
      });
    } catch (e) {
      console.error('Failed to init Telegram Bot:', e);
    }
  } else {
    console.warn('Telegram Bot: No valid token found in environment or hardcoded fallback.');
  }
}

initBot();

let lastScan = Date.now();

let isScanning = false;
// Background Scanning Logic
async function scanNewPairs() {
  if (isScanning) return;
  isScanning = true;
  const isActive = db.prepare("SELECT value FROM config WHERE key = ?").get('scanning_active')?.value === 'true';
  if (!isActive) {
    isScanning = false;
    return;
  }

  lastScan = Date.now();
  console.log('[Scanner] Scanning for new pairs...');
  try {
    // Fetch latest profiles (paid/boosted)
    const profileRes = await axios.get('https://api.dexscreener.com/token-profiles/latest/v1').catch(() => ({ data: [] }));
    const allDetected = profileRes.data || [];
    
    for (const item of allDetected.slice(0, 50)) {
      const address = item.tokenAddress;
      const chain = item.chainId;
      
      // Check if already exists
      const exists = db.prepare('SELECT id FROM tokens WHERE address = ?').get(address);
      if (exists) continue;

      // Fetch detailed pair info
      const pairRes = await axios.get(`https://api.dexscreener.com/latest/dex/tokens/${address}`);
      const pairs = pairRes.data.pairs || [];
      const pair = pairs.find((p: any) => p.chainId === chain);

      if (!pair) continue;

      const liquidity = pair.liquidity?.usd || 0;
      const mcap = pair.fdv || 0;
      
      // Basic filtering using global config
      const globalMinLiq = parseFloat(db.prepare("SELECT value FROM config WHERE key = 'min_liquidity' AND user_id IS NULL").get()?.value || '5000');
      if (liquidity < globalMinLiq) continue;

      // More realistic rug risk calculation
      let rugRisk = 20 + Math.random() * 30; // Base risk
      if (liquidity > 50000) rugRisk -= 10;
      if (mcap > 500000) rugRisk -= 5;
      
      const sentiment = 50 + Math.random() * 40;
      const devActivity = Math.random() * 100;
      
      const priceUsd = parseFloat(pair.priceUsd || '0');
      if (isNaN(priceUsd) || priceUsd <= 0) continue;

      // Improved scaling for the "trenches"
      const nanaScore = calculateNanaScore({
        'Liquidity Depth': Math.min(100, (liquidity / 25000) * 100), // $25k liquidity = 100 score for this factor
        'Holder Distribution': 75 + (Math.random() * 15), 
        'Social Velocity': sentiment,
        'Dev Activity': devActivity,
        'Rug Risk': rugRisk
      });

      const result = db.prepare(`
        INSERT INTO tokens (
          address, symbol, chain, nana_score, rug_risk_score, insider_probability, 
          sentiment_score, buy_pressure, current_price, call_price, ath_price, 
          market_cap, liquidity, cto_status, ai_rug_verdict, dev_activity_score
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        address, pair.baseToken.symbol, chain, nanaScore, rugRisk, 
        Math.random() * 40, sentiment, 0.5 + Math.random() * 0.5,
        parseFloat(pair.priceUsd), parseFloat(pair.priceUsd), parseFloat(pair.priceUsd),
        mcap, liquidity, Math.random() > 0.7 ? 1 : 0, 'Pending Neural Analysis', devActivity
      );

      console.log(`[Scanner] New token detected: ${pair.baseToken.symbol} on ${chain} at $${priceUsd}`);

      // 1. Resolve all users who might be interested
      // This includes all users in the 'users' table, plus the 'global' context (null user_id)
      const allUserIds = db.prepare('SELECT id FROM users').all().map(u => u.id);
      allUserIds.push(null); // Add global context

      for (const uid of allUserIds) {
        // Helper to get config for this user (with fallback to global)
        const getConfig = (key: string, defaultVal: string) => {
          return db.prepare("SELECT value FROM config WHERE key = ? AND (user_id = ? OR user_id IS NULL) ORDER BY user_id DESC LIMIT 1").get(key, uid)?.value || defaultVal;
        };

        const minScore = parseFloat(getConfig('min_nana_score', '70'));
        const minLiq = parseFloat(getConfig('min_liquidity', '5000'));
        const alertsEnabled = getConfig('alerts_enabled', 'false') === 'true';
        const chatId = getConfig('chat_id', '');
        const groupId = getConfig('telegram_group_id', '');

        // Check if token meets this user's criteria
        if (nanaScore >= minScore && liquidity >= minLiq) {
          
          // A. Auto-Simulation Trading (only for real users, not global context)
          if (uid !== null && rugRisk < 15) {
            try {
              const amountUsd = 10;
              const price = priceUsd;
              const quantity = amountUsd / price;
              
              const currentBalance = db.prepare('SELECT balance FROM balances WHERE user_id = ? AND chain = ?').get(uid, chain)?.balance || 0;
              if (currentBalance >= amountUsd) {
                db.prepare('INSERT INTO simulation_trades (user_id, address, symbol, chain, type, amount_usd, price, reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
                  .run(uid, address, pair.baseToken.symbol, chain, 'buy', amountUsd, price, 'Neural Engine High Confidence Entry');

                db.prepare('UPDATE balances SET balance = balance - ? WHERE user_id = ? AND chain = ?').run(amountUsd, uid, chain);

                db.prepare(`
                  INSERT INTO portfolio (user_id, address, symbol, chain, quantity, avg_buy_price, current_price, total_value)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                  ON CONFLICT(user_id, address) DO UPDATE SET
                    quantity = quantity + excluded.quantity,
                    avg_buy_price = (avg_buy_price * quantity + excluded.avg_buy_price * excluded.quantity) / (quantity + excluded.quantity),
                    total_value = total_value + excluded.total_value
                `).run(uid, address, pair.baseToken.symbol, chain, quantity, price, price, amountUsd);
                
                console.log(`[Simulation] Auto-bought ${pair.baseToken.symbol} for user ${uid} due to high score (${nanaScore.toFixed(1)})`);
              }
            } catch (err) {
              console.error(`[Simulation] Failed auto-buy for user ${uid}:`, err);
            }
          }

          // B. Telegram Alerts
          if (bot && alertsEnabled && chatId) {
            try {
              const alertMsg = `🚀 *New Signal Detected!*\n\n*Token:* ${pair.baseToken.symbol}\n*Score:* ${nanaScore.toFixed(1)}\n*Chain:* ${chain}\n*Address:* \`${address}\`\n\n[DexScreener](${pair.url})`;
              bot.sendMessage(chatId, alertMsg, { parse_mode: 'Markdown' });
              if (groupId && groupId !== chatId) {
                bot.sendMessage(groupId, alertMsg, { parse_mode: 'Markdown' });
              }
            } catch (err) {
              console.error(`Failed to send Telegram alert to user ${uid}:`, err);
            }
          }
        }
      }
    }
  } catch (e) {
    console.error('[Scanner] Error:', e);
  } finally {
    isScanning = false;
  }
}

let isUpdatingPrices = false;
async function updatePrices() {
  if (isUpdatingPrices) return;
  isUpdatingPrices = true;
  try {
    const tokens = db.prepare('SELECT id, address, chain, current_price, ath_price FROM tokens ORDER BY created_at DESC LIMIT 50').all();
    
    for (const token of tokens) {
      try {
        const response = await axios.get(`https://api.dexscreener.com/latest/dex/tokens/${token.address}`);
        const pairs = response.data.pairs || [];
        const pair = pairs.find((p: any) => p.chainId === token.chain);

        if (pair) {
          const newPrice = parseFloat(pair.priceUsd);
          const newAth = Math.max(token.ath_price || 0, newPrice);
          
          db.prepare('UPDATE tokens SET current_price = ?, ath_price = ?, market_cap = ?, liquidity = ? WHERE id = ?')
            .run(newPrice, newAth, pair.fdv || 0, pair.liquidity?.usd || 0, token.id);
            
          // Update portfolio prices too
          db.prepare('UPDATE portfolio SET current_price = ?, total_value = quantity * ? WHERE address = ?')
            .run(newPrice, newPrice, token.address);
        }
        // Small delay to avoid rate limits
        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (e) {
        console.error(`[PriceUpdater] Error for ${token.address}:`, e);
      }
    }
  } finally {
    isUpdatingPrices = false;
  }
}

// Background Loops
// Initialized inside startServer() to avoid duplication

async function startServer() {
  const app = express();
  app.use(express.json());

  // API Routes
  app.get('/api/health', (req, res) => res.json({ status: 'ok', lastScan }));

  app.post('/api/scan', async (req, res) => {
    await scanNewPairs();
    res.json({ success: true, lastScan });
  });

  app.get('/api/config', (req, res) => {
    const userId = req.query.userId;
    const rows = db.prepare('SELECT * FROM config WHERE user_id IS NULL OR user_id = ?').all(userId);
    const config = rows.reduce((acc: any, row: any) => {
      acc[row.key] = row.value;
      return acc;
    }, {});
    res.json(config);
  });

  app.post('/api/config', (req, res) => {
    const { key, value, userId } = req.body;
    // Keys that are per-user
    const perUserKeys = ['chat_id', 'alerts_enabled', 'telegram_group_id', 'min_nana_score', 'risk_mode', 'risk_tolerance', 'profit_target', 'min_liquidity'];
    const targetUserId = perUserKeys.includes(key) ? userId : null;
    
    db.prepare('INSERT OR REPLACE INTO config (user_id, key, value) VALUES (?, ?, ?)').run(targetUserId, key, String(value));
    res.json({ success: true });
  });

  app.get('/api/tokens', (req, res) => {
    const since = req.query.since as string;
    const rawUserId = req.query.userId;
    const userId = rawUserId ? parseInt(rawUserId as string) : null;
    
    // Get the min_nana_score and min_liquidity for this user or global
    const configRows = db.prepare("SELECT key, value FROM config WHERE (user_id = ? OR user_id IS NULL) AND key IN ('min_nana_score', 'min_liquidity') ORDER BY user_id DESC").all(userId);
    
    const minScore = parseFloat(configRows.find(r => r.key === 'min_nana_score')?.value || '70');
    const minLiq = parseFloat(configRows.find(r => r.key === 'min_liquidity')?.value || '5000');

    let tokens;
    if (since) {
      // Use datetime(?) for robust comparison with ISO strings
      tokens = db.prepare("SELECT * FROM tokens WHERE created_at >= datetime(?) AND created_at > datetime('now', '-24 hours') AND nana_score >= ? AND liquidity >= ? ORDER BY created_at DESC LIMIT 50").all(since, minScore, minLiq);
    } else {
      // Default to last 24 hours for live feed
      // Respect the user's min_nana_score and min_liquidity settings
      tokens = db.prepare("SELECT * FROM tokens WHERE created_at > datetime('now', '-24 hours') AND nana_score >= ? AND liquidity >= ? ORDER BY created_at DESC LIMIT 50").all(minScore, minLiq);
    }
    res.json(tokens);
  });

  app.get('/api/tokens/history', (req, res) => {
    const { chain, winLoss, date, since } = req.query;
    let query = 'SELECT * FROM tokens WHERE 1=1';
    const params: any[] = [];

    if (chain && chain !== 'all') {
      query += ' AND chain = ?';
      params.push(chain);
    }

    if (winLoss === 'winners' || winLoss === 'win') {
      query += ' AND call_price > 0 AND ath_price >= call_price * 2';
    } else if (winLoss === 'losers' || winLoss === 'loss') {
      query += ' AND (call_price = 0 OR ath_price < call_price * 2)';
    }

    if (date) {
      query += ' AND date(created_at) = date(?)';
      params.push(date);
    }

    if (since) {
      query += ' AND created_at >= datetime(?)';
      params.push(since);
    }

    query += ' ORDER BY created_at DESC';
    
    const tokens = db.prepare(query).all(...params);
    res.json(tokens);
  });

  app.post('/api/tokens/analyze', (req, res) => {
    const { id, ai_rug_risk_level, ai_rug_verdict, ai_social_verdict } = req.body;
    db.prepare(`
      UPDATE tokens 
      SET ai_rug_risk_level = ?, ai_rug_verdict = ?, ai_social_verdict = ?
      WHERE id = ?
    `).run(ai_rug_risk_level, ai_rug_verdict, ai_social_verdict, id);
    res.json({ success: true });
  });

  app.get('/api/stats', (req, res) => {
    const { scope } = req.query;
    const timeFilter = scope === 'history' ? "" : "WHERE created_at > datetime('now', '-24 hours')";
    
    try {
      const totalCalls = db.prepare(`SELECT COUNT(*) as count FROM tokens ${timeFilter}`).get()?.count || 0;
      const avgSentiment = db.prepare(`SELECT AVG(sentiment_score) as avg FROM tokens ${timeFilter}`).get()?.avg || 0;
      const explosive = db.prepare(`SELECT COUNT(*) as count FROM tokens ${timeFilter} ${timeFilter ? 'AND' : 'WHERE'} call_price > 0 AND ath_price >= call_price * 5`).get()?.count || 0;
      const winners = db.prepare(`SELECT COUNT(*) as count FROM tokens ${timeFilter} ${timeFilter ? 'AND' : 'WHERE'} call_price > 0 AND ath_price >= call_price * 2`).get()?.count || 0;
      const winRate = totalCalls > 0 ? (winners / totalCalls) * 100 : 0;
      
      res.json({
        totalCalls,
        avgSentiment,
        explosive,
        winRate,
        rugPrevention: 98 // Hardcoded for now
      });
    } catch (e) {
      console.error('Error in /api/stats:', e);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.get('/api/rugs', (req, res) => {
    const rugs = db.prepare('SELECT * FROM rugs ORDER BY timestamp DESC LIMIT 10').all();
    res.json(rugs);
  });

  app.get('/api/insights', (req, res) => {
    const insights = db.prepare('SELECT * FROM insights ORDER BY timestamp DESC LIMIT 10').all();
    res.json(insights);
  });

  app.post('/api/insights/update', (req, res) => {
    const { insight, weight_adjustment } = req.body;
    db.prepare('INSERT INTO insights (insight, weight_adjustment) VALUES (?, ?)').run(insight, weight_adjustment);
    res.json({ success: true });
  });

  app.get('/api/simulation/trades', (req, res) => {
    const userId = req.query.userId;
    if (!userId) return res.json([]);
    const trades = db.prepare('SELECT * FROM simulation_trades WHERE user_id = ? ORDER BY timestamp DESC LIMIT 50').all(userId);
    res.json(trades);
  });

  app.get('/api/simulation/stats', (req, res) => {
    const userId = req.query.userId;
    if (!userId) return res.json({ totalProfit: 0, balances: [] });
    try {
      const totalProfit = db.prepare("SELECT SUM(profit_usd) as total FROM simulation_trades WHERE user_id = ? AND type = ?").get(userId, 'sell')?.total || 0;
      const balances = db.prepare("SELECT * FROM balances WHERE user_id = ?").all(userId);
      res.json({
        totalProfit,
        balances
      });
    } catch (e) {
      console.error('Error in /api/simulation/stats:', e);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.get('/api/simulation/portfolio', async (req, res) => {
    const userId = req.query.userId;
    if (!userId) return res.json({ portfolio: [], totalValue: 0 });
    try {
      const portfolio = db.prepare('SELECT * FROM portfolio WHERE user_id = ?').all(userId);
      
      // Update prices for each item in portfolio
      for (const item of portfolio) {
        try {
          const pairRes = await axios.get(`https://api.dexscreener.com/latest/dex/tokens/${item.address}`);
          const pairs = pairRes.data.pairs || [];
          const pair = pairs.find((p: any) => p.chainId === item.chain) || pairs[0];
          
          if (pair) {
            const newPrice = parseFloat(pair.priceUsd);
            const newValue = item.quantity * newPrice;
            db.prepare('UPDATE portfolio SET current_price = ?, total_value = ? WHERE user_id = ? AND address = ?')
              .run(newPrice, newValue, userId, item.address);
            item.current_price = newPrice;
            item.total_value = newValue;
          }
        } catch (err) {
          console.error(`Failed to update price for ${item.symbol}:`, err);
        }
      }

      const totalValue = portfolio.reduce((acc: number, item: any) => acc + (item.total_value || 0), 0);
      res.json({
        portfolio,
        totalValue
      });
    } catch (e) {
      console.error('Error in /api/simulation/portfolio:', e);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.post('/api/simulation/manual-buy', async (req, res) => {
    const { address, chain, amount_usd, reason, userId } = req.body;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    if (!address || !chain || !amount_usd || amount_usd <= 0) {
      return res.status(400).json({ error: 'Invalid parameters' });
    }
    
    // Check balance
    const currentBalance = db.prepare('SELECT balance FROM balances WHERE user_id = ? AND chain = ?').get(userId, chain)?.balance || 0;
    if (currentBalance < amount_usd) {
      return res.status(400).json({ error: 'Insufficient balance' });
    }

    try {
      // Fetch token info from DexScreener
      const pairRes = await axios.get(`https://api.dexscreener.com/latest/dex/tokens/${address}`);
      const pairs = pairRes.data.pairs || [];
      const pair = pairs.find((p: any) => p.chainId === chain) || pairs[0];

      if (!pair) {
        return res.status(404).json({ error: 'Token not found on DexScreener' });
      }

      const symbol = pair.baseToken.symbol;
      const price = parseFloat(pair.priceUsd);
      const quantity = amount_usd / price;

      db.prepare('INSERT INTO simulation_trades (user_id, address, symbol, chain, type, amount_usd, price, reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        .run(userId, address, symbol, chain, 'buy', amount_usd, price, reason);

      db.prepare('UPDATE balances SET balance = balance - ? WHERE user_id = ? AND chain = ?').run(amount_usd, userId, chain);

      db.prepare(`
        INSERT INTO portfolio (user_id, address, symbol, chain, quantity, avg_buy_price, current_price, total_value)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, address) DO UPDATE SET
          quantity = quantity + excluded.quantity,
          avg_buy_price = (avg_buy_price * quantity + excluded.avg_buy_price * excluded.quantity) / (quantity + excluded.quantity),
          total_value = total_value + excluded.total_value
      `).run(userId, address, symbol, chain, quantity, price, price, amount_usd);

      res.json({ success: true });
    } catch (e) {
      console.error('Error in /api/simulation/manual-buy:', e);
      res.status(500).json({ error: 'Failed to fetch token data' });
    }
  });

  app.post('/api/simulation/manual-sell', async (req, res) => {
    const { address, chain, percent, reason, userId } = req.body;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    if (!address || !chain || !percent || percent <= 0 || percent > 100) {
      return res.status(400).json({ error: 'Invalid parameters' });
    }
    
    const holding = db.prepare('SELECT * FROM portfolio WHERE user_id = ? AND address = ?').get(userId, address);
    if (!holding) return res.status(404).json({ error: 'Not holding this token' });

    try {
      // Fetch latest price from DexScreener
      const pairRes = await axios.get(`https://api.dexscreener.com/latest/dex/tokens/${address}`);
      const pairs = pairRes.data.pairs || [];
      const pair = pairs.find((p: any) => p.chainId === chain) || pairs[0];
      
      const sellPrice = pair ? parseFloat(pair.priceUsd) : holding.current_price;
      const sellQty = holding.quantity * (percent / 100);
      const amountUsd = sellQty * sellPrice;
      const profit = (sellPrice - holding.avg_buy_price) * sellQty;

      db.prepare('INSERT INTO simulation_trades (user_id, address, symbol, chain, type, amount_usd, price, profit_usd, reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(userId, address, holding.symbol, chain, 'sell', amountUsd, sellPrice, profit, reason);

      db.prepare('UPDATE balances SET balance = balance + ? WHERE user_id = ? AND chain = ?').run(amountUsd, userId, chain);

      if (percent >= 100) {
        db.prepare('DELETE FROM portfolio WHERE user_id = ? AND address = ?').run(userId, address);
      } else {
        db.prepare('UPDATE portfolio SET quantity = quantity - ?, total_value = (quantity - ?) * ?, current_price = ? WHERE user_id = ? AND address = ?')
          .run(sellQty, sellQty, sellPrice, sellPrice, userId, address);
      }

      res.json({ success: true });
    } catch (e) {
      console.error('Error in /api/simulation/manual-sell:', e);
      res.status(500).json({ error: 'Failed to fetch token data' });
    }
  });

  app.post('/api/simulation/reset-balances', (req, res) => {
    const userId = req.body.userId;
    if (!userId) return res.status(401).json({ error: 'Unauthorized' });
    db.prepare('UPDATE balances SET balance = 100.00 WHERE user_id = ?').run(userId);
    res.json({ success: true });
  });

  app.post('/api/neural/learn', async (req, res) => {
    await learnFromTrades();
    res.json({ success: true, weights: getNeuralWeights() });
  });

  app.get('/api/neural/weights', (req, res) => {
    res.json(getNeuralWeights());
  });

  app.post('/api/neural/weights', (req, res) => {
    const { factor, weight } = req.body;
    db.prepare('UPDATE neural_weights SET weight = ? WHERE factor = ?').run(weight, factor);
    res.json({ success: true });
  });

  app.post('/api/login', (req, res) => {
    const { email, password } = req.body;
    const user = db.prepare('SELECT * FROM users WHERE email = ? AND password = ?').get(email, password);
    if (user) {
      res.json({ success: true, user: { id: user.id, email: user.email, created_at: user.created_at } });
    } else {
      res.json({ success: false, error: 'Invalid credentials' });
    }
  });

  app.post('/api/signup', (req, res) => {
    const { email, password } = req.body;
    try {
      const result = db.prepare('INSERT INTO users (email, password) VALUES (?, ?)').run(email, password);
      const user = db.prepare('SELECT * FROM users WHERE id = ?').get(result.lastInsertRowid);
      
      // Initialize balances for new user
      const initialBalances = [['solana', 100.00], ['ethereum', 100.00], ['base', 100.00]];
      const insertBalance = db.prepare('INSERT OR IGNORE INTO balances (user_id, chain, balance) VALUES (?, ?, ?)');
      initialBalances.forEach(([chain, balance]) => insertBalance.run(user.id, chain, balance));

      res.json({ success: true, user: { id: user.id, email: user.email, created_at: user.created_at } });
    } catch (e) {
      console.error('Signup error:', e);
      res.json({ success: false, error: 'Email already exists' });
    }
  });

  app.post('/api/toggle-scanning', (req, res) => {
    const current = db.prepare("SELECT value FROM config WHERE key = ?").get('scanning_active')?.value;
    const next = current === 'true' ? 'false' : 'true';
    db.prepare("UPDATE config SET value = ? WHERE key = ?").run(next, 'scanning_active');
    res.json({ success: true, active: next === 'true' });
  });

  app.post('/api/simulate-token', (req, res) => {
    const mockToken = {
      address: '0x' + Math.random().toString(16).slice(2, 42),
      symbol: 'MOCK' + Math.floor(Math.random() * 100),
      chain: 'solana',
      nana_score: 70 + Math.random() * 25,
      rug_risk_score: Math.random() * 30,
      insider_probability: Math.random() * 40,
      sentiment_score: 60 + Math.random() * 30,
      buy_pressure: 0.5 + Math.random() * 0.5,
      current_price: 0.00001,
      call_price: 0.00001,
      ath_price: 0.00001,
      market_cap: 50000 + Math.random() * 100000,
      liquidity: 10000 + Math.random() * 20000,
      cto_status: Math.random() > 0.5 ? 1 : 0
    };

    const result = db.prepare(`
      INSERT INTO tokens (
        address, symbol, chain, nana_score, rug_risk_score, insider_probability, 
        sentiment_score, buy_pressure, current_price, call_price, ath_price, 
        market_cap, liquidity, cto_status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      mockToken.address, mockToken.symbol, mockToken.chain, mockToken.nana_score,
      mockToken.rug_risk_score, mockToken.insider_probability, mockToken.sentiment_score,
      mockToken.buy_pressure, mockToken.current_price, mockToken.call_price,
      mockToken.ath_price, mockToken.market_cap, mockToken.liquidity, mockToken.cto_status
    );

    // Send Telegram Alert if enabled
    if (bot) {
      const usersWithAlerts = db.prepare(`
        SELECT DISTINCT c1.value as chat_id, c3.value as group_id
        FROM config c1
        JOIN config c2 ON (c1.user_id = c2.user_id OR (c1.user_id IS NULL AND c2.user_id IS NULL))
        LEFT JOIN config c3 ON (c1.user_id = c3.user_id AND c3.key = 'telegram_group_id')
        WHERE c1.key = 'chat_id' AND c2.key = 'alerts_enabled' AND c2.value = 'true'
      `).all();

      for (const u of usersWithAlerts) {
        try {
          const alertMsg = `🚀 *New Signal Detected!*\n\n*Token:* ${mockToken.symbol}\n*Score:* ${mockToken.nana_score.toFixed(1)}\n*Chain:* ${mockToken.chain}\n*Address:* \`${mockToken.address}\`\n\n[DexScreener](https://dexscreener.com/${mockToken.chain}/${mockToken.address})`;
          bot.sendMessage(u.chat_id, alertMsg, { parse_mode: 'Markdown' });
          if (u.group_id && u.group_id !== u.chat_id) {
            bot.sendMessage(u.group_id, alertMsg, { parse_mode: 'Markdown' });
          }
        } catch (err) {
          console.error(`Failed to send Telegram alert to user:`, err);
        }
      }
    }

    res.json({ success: true, id: result.lastInsertRowid });
  });

  app.get('/api/test', (req, res) => res.json({ success: true }));

  app.post('/api/ai/deepseek', async (req, res) => {
    const { prompt } = req.body;
    console.log('DeepSeek AI Request received');
    
    // In a real app, you would call DeepSeek API here.
    // Since we don't have a key, we'll use Gemini as a fallback if available, 
    // or return a mock response.
    
    try {
      // Mocking a response for now
      // If the prompt is for rug analysis, return a JSON-like string
      if (prompt.includes('Neural Security Score')) {
        res.json({
          content: JSON.stringify({
            neuralScore: 85,
            verdict: "LOW RISK (MOCK)",
            riskLevel: "LOW",
            reasoning: "Liquidity is locked and contract is verified. No malicious functions detected in mock scan."
          })
        });
      } else if (prompt.includes('social intelligence analysis')) {
        res.json({
          content: JSON.stringify({
            legitimacyScore: 80,
            hypeRiskScore: 20,
            sentimentScore: 75,
            devActivityScore: 90,
            verdict: "BULLISH (MOCK): Community is active and growing. Website is professional."
          })
        });
      } else {
        res.json({ content: JSON.stringify({ message: "AI Response (Mock): The trenches are looking active today." }) });
      }
    } catch (e) {
      res.status(500).json({ error: 'DeepSeek proxy failed' });
    }
  });

  app.get('/api/test/bot', async (req, res) => {
    if (!bot) {
      return res.status(500).json({ error: 'Bot not initialized. Check TELEGRAM_TOKEN in Settings.' });
    }
    try {
      const me = await bot.getMe();
      res.json({ 
        success: true, 
        bot: me,
        polling: bot.isPolling()
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // API 404 handler - must be after all API routes but before Vite
  app.all('/api/*', (req, res) => {
    res.status(404).json({ error: `API route ${req.method} ${req.url} not found` });
  });

  // Vite integration
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
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
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });

  let isUpdatingATH = false;
  async function updateATHPrices() {
    if (isUpdatingATH) return;
    isUpdatingATH = true;
    console.log('[Scanner] Updating ATH prices...');
    try {
      const tokens = db.prepare("SELECT id, address, chain, ath_price, call_price, symbol, alert_2x_sent, alert_5x_sent, alert_20x_sent FROM tokens WHERE created_at > datetime('now', '-168 hours')").all();
      for (const token of tokens) {
        try {
          const pairRes = await axios.get(`https://api.dexscreener.com/latest/dex/tokens/${token.address}`);
          const pairs = pairRes.data.pairs || [];
          // Strict chain matching to avoid price glitches from other chains
          const pair = pairs.find((p: any) => p.chainId === token.chain);
          
          if (pair) {
            const currentPrice = parseFloat(pair.priceUsd);
            const callPrice = token.call_price || currentPrice || 0.00000001; // Avoid division by zero
            const multiplier = currentPrice / callPrice;
            
            // Check for milestones
            let milestoneReached = 0;
            let milestoneText = "";
            
            if (multiplier >= 20 && !token.alert_20x_sent) {
              milestoneReached = 20;
              milestoneText = "🔥 20X MEGA WIN! 🔥";
              db.prepare('UPDATE tokens SET alert_20x_sent = 1, alert_5x_sent = 1, alert_2x_sent = 1 WHERE id = ?').run(token.id);
            } else if (multiplier >= 5 && !token.alert_5x_sent) {
              milestoneReached = 5;
              milestoneText = "🚀 5X BIG WIN! 🚀";
              db.prepare('UPDATE tokens SET alert_5x_sent = 1, alert_2x_sent = 1 WHERE id = ?').run(token.id);
            } else if (multiplier >= 2 && !token.alert_2x_sent) {
              milestoneReached = 2;
              milestoneText = "✅ 2X WIN! ✅";
              db.prepare('UPDATE tokens SET alert_2x_sent = 1 WHERE id = ?').run(token.id);
            }

            if (milestoneReached > 0 && bot) {
              const winMsg = `${milestoneText}\n\n*Token:* ${token.symbol}\n*Multiplier:* ${multiplier.toFixed(2)}x\n*Current Price:* $${currentPrice.toFixed(8)}\n*Call Price:* $${callPrice.toFixed(8)}\n\n[DexScreener](https://dexscreener.com/${token.chain}/${token.address})`;
              
              // Send to all users with alerts enabled
              const users = db.prepare(`
                SELECT DISTINCT c1.value as chat_id, c2.value as group_id 
                FROM config c1 
                LEFT JOIN config c2 ON c1.user_id = c2.user_id AND c2.key = 'telegram_group_id'
                WHERE c1.key = 'chat_id' AND EXISTS (
                  SELECT 1 FROM config c3 WHERE c3.user_id = c1.user_id AND c3.key = 'alerts_enabled' AND c3.value = 'true'
                )
              `).all();

              for (const u of users) {
                if (u.chat_id) {
                  bot.sendMessage(u.chat_id, winMsg, { parse_mode: 'Markdown' }).catch(() => {});
                }
                if (u.group_id && u.group_id !== u.chat_id) {
                  bot.sendMessage(u.group_id, winMsg, { parse_mode: 'Markdown' }).catch(() => {});
                }
              }
            }

            if (currentPrice > (token.ath_price || 0)) {
              db.prepare('UPDATE tokens SET ath_price = ?, current_price = ? WHERE id = ?').run(currentPrice, currentPrice, token.id);
            } else {
              db.prepare('UPDATE tokens SET current_price = ? WHERE id = ?').run(currentPrice, token.id);
            }
          }
        } catch (err) {
          // Silent fail for individual tokens
        }
        // Sleep slightly to avoid rate limits
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    } catch (e) {
      console.error('Failed to update ATH prices:', e);
    } finally {
      isUpdatingATH = false;
    }
  }

  // Start background scanner
  setInterval(scanNewPairs, 30000); // Scan every 30s
  setInterval(updatePrices, 30000); // Update prices every 30s
  setInterval(updateATHPrices, 300000); // Update ATH every 5 minutes
  setInterval(learnFromTrades, 3600000); // Learn every hour
}

startServer();
