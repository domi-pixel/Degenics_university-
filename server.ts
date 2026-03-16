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
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS config (
    user_id INTEGER,
    key TEXT,
    value TEXT,
    PRIMARY KEY (user_id, key)
  );

  CREATE TABLE IF NOT EXISTS rugs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    address TEXT,
    reason TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS insights (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
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
const insertBalance = db.prepare('INSERT OR IGNORE INTO balances (chain, balance) VALUES (?, ?)');
initialBalances.forEach(([chain, balance]) => insertBalance.run(chain, balance));

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

// Migration: Update neural weights factors
try {
  db.prepare("UPDATE neural_weights SET factor = 'Dev Activity' WHERE factor = 'Dev History'").run();
  db.prepare("INSERT OR IGNORE INTO neural_weights (factor, weight) VALUES ('Rug Risk', 0.10)").run();
} catch (err) {
  console.error('Neural weights migration failed:', err);
}

// Seed default config
const defaultConfig = [
  ['scanning_active', 'true'],
  ['min_boost', '100'],
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

const insertConfig = db.prepare('INSERT OR IGNORE INTO config (key, value) VALUES (?, ?)');
defaultConfig.forEach(([key, value]) => insertConfig.run(key, value));

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
  console.log('[Neural Engine] Learning from recent trades...');
  const recentSells = db.prepare(`
    SELECT t.*, tok.liquidity, tok.sentiment_score, tok.dev_activity_score, tok.rug_risk_score
    FROM simulation_trades t
    JOIN tokens tok ON t.address = tok.address
    WHERE t.type = 'sell' AND t.timestamp > datetime('now', '-24 hours')
  `).all();

  if (recentSells.length === 0) return;

  const weights = getNeuralWeights();
  const learningRate = 0.01;

  recentSells.forEach((trade: any) => {
    const isProfitable = trade.profit_usd > 0;
    const adjustment = isProfitable ? learningRate : -learningRate;

    // Simplified learning: adjust weights based on token characteristics at time of trade
    // In a real app, we'd store the factor values at the time of the 'buy'
    weights.forEach((w: any) => {
      let factorValue = 0.5; // Default
      if (w.factor === 'Liquidity Depth') factorValue = Math.min(1, trade.liquidity / 100000);
      if (w.factor === 'Social Velocity') factorValue = trade.sentiment_score / 100;
      if (w.factor === 'Dev Activity') factorValue = trade.dev_activity_score / 100;
      if (w.factor === 'Rug Risk') factorValue = trade.rug_risk_score / 100;
      if (w.factor === 'Holder Distribution') factorValue = 0.6; // Mock

      w.weight += adjustment * (factorValue - 0.5);
    });
  });

  // Normalize weights
  const totalWeight = weights.reduce((acc: number, w: any) => acc + Math.max(0.01, w.weight), 0);
  weights.forEach((w: any) => {
    w.weight = Math.max(0.01, w.weight) / totalWeight;
    db.prepare('UPDATE neural_weights SET weight = ? WHERE factor = ?').run(w.weight, w.factor);
  });

  const topFactor = weights.sort((a: any, b: any) => b.weight - a.weight)[0];
  db.prepare('INSERT INTO insights (insight, weight_adjustment) VALUES (?, ?)')
    .run(`Neural Engine optimized: Increased focus on ${topFactor.factor} based on recent performance.`, 0.05);
}

// Telegram Bot Setup
const GENERAL_BOT_TOKEN = '7865663467:AAH4umyxZ1-IpjjxqwzDhYyA8ypmizI_J8I';
let bot: TelegramBot | null = null;
function initBot() {
  const token = GENERAL_BOT_TOKEN;
  if (token && token.trim() !== '') {
    try {
      if (bot) {
        bot.stopPolling();
      }
      bot = new TelegramBot(token, { polling: true });
      console.log('Telegram Bot Initialized with General Token');
      
      bot.on('message', (msg) => {
        const chatId = msg.chat.id;
        if (msg.text === '/start') {
          bot?.sendMessage(chatId, `Welcome to Degenics Angel. Your Chat ID is: ${chatId}. Add this to your Config to receive alerts.`);
        }
      });

      bot.on('polling_error', (error) => {
        // Only log if not a 409 (conflict is common during restarts)
        if (!error.message.includes('409 Conflict')) {
          console.error('Telegram Polling Error:', error.message);
        }
        if (error.message.includes('404 Not Found')) {
          console.error('CRITICAL: General Telegram Token is invalid (404).');
          bot?.stopPolling();
          bot = null;
        }
      });
    } catch (e) {
      console.error('Failed to init Telegram Bot:', e);
    }
  }
}

initBot();

let lastScan = Date.now();

// Background Scanning Logic
async function scanNewPairs() {
  const isActive = db.prepare("SELECT value FROM config WHERE key = ?").get('scanning_active')?.value === 'true';
  if (!isActive) return;

  lastScan = Date.now();
  console.log('[Scanner] Scanning for new pairs...');
  try {
    // Fetch latest pairs from DexScreener (Solana as example)
    const response = await axios.get('https://api.dexscreener.com/token-profiles/latest/v1');
    const profiles = response.data || [];
    
    for (const profile of profiles.slice(0, 5)) {
      const address = profile.tokenAddress;
      const chain = profile.chainId;
      
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
      
      // Basic filtering
      if (liquidity < 5000) continue;

      // More realistic rug risk calculation
      let rugRisk = 20 + Math.random() * 30; // Base risk
      if (liquidity > 50000) rugRisk -= 10;
      if (mcap > 500000) rugRisk -= 5;
      if (pair.boosts && pair.boosts.active > 0) rugRisk -= 5;
      
      const sentiment = 50 + Math.random() * 40;
      const devActivity = Math.random() * 100;
      
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

      console.log(`[Scanner] New token detected: ${pair.baseToken.symbol} on ${chain}`);

      // Auto-Simulation Trading for all users
      const minNanaScore = parseFloat(db.prepare("SELECT value FROM config WHERE key = ?").get('min_nana_score')?.value || '70');
      if (nanaScore >= minNanaScore && rugRisk < 15) {
        const amountUsd = 10;
        const price = parseFloat(pair.priceUsd);
        const quantity = amountUsd / price;
        
        const users = db.prepare('SELECT id FROM users').all();
        for (const user of users) {
          try {
            // Check balance for this user
            const currentBalance = db.prepare('SELECT balance FROM balances WHERE user_id = ? AND chain = ?').get(user.id, chain)?.balance || 0;
            if (currentBalance >= amountUsd) {
              db.prepare('INSERT INTO simulation_trades (user_id, address, symbol, chain, type, amount_usd, price, reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
                .run(user.id, address, pair.baseToken.symbol, chain, 'buy', amountUsd, price, 'Neural Engine High Confidence Entry');

              db.prepare('UPDATE balances SET balance = balance - ? WHERE user_id = ? AND chain = ?').run(amountUsd, user.id, chain);

              db.prepare(`
                INSERT INTO portfolio (user_id, address, symbol, chain, quantity, avg_buy_price, current_price, total_value)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(user_id, address) DO UPDATE SET
                  quantity = quantity + excluded.quantity,
                  avg_buy_price = (avg_buy_price * quantity + excluded.avg_buy_price * excluded.quantity) / (quantity + excluded.quantity),
                  total_value = total_value + excluded.total_value
              `).run(user.id, address, pair.baseToken.symbol, chain, quantity, price, price, amountUsd);
              
              console.log(`[Simulation] Auto-bought ${pair.baseToken.symbol} for user ${user.id} due to high score (${nanaScore.toFixed(1)})`);
            }
          } catch (err) {
            console.error(`[Simulation] Failed auto-buy for user ${user.id}:`, err);
          }
        }
      }

      // Telegram Alert for all users who have chat_id set
      if (bot) {
        const usersWithAlerts = db.prepare(`
          SELECT c1.user_id, c1.value as chat_id 
          FROM config c1
          JOIN config c2 ON (c1.user_id = c2.user_id OR (c1.user_id IS NULL AND c2.user_id IS NULL))
          WHERE c1.key = 'chat_id' AND c2.key = 'alerts_enabled' AND c2.value = 'true'
        `).all();

        for (const u of usersWithAlerts) {
          try {
            bot.sendMessage(u.chat_id, `🚀 *New Signal Detected!*\n\n*Token:* ${pair.baseToken.symbol}\n*Score:* ${nanaScore.toFixed(1)}\n*Chain:* ${chain}\n*Address:* \`${address}\`\n\n[DexScreener](${pair.url})`, { parse_mode: 'Markdown' });
          } catch (err) {
            console.error(`Failed to send Telegram alert to user ${u.user_id}:`, err);
          }
        }
      }
    }
  } catch (e) {
    console.error('[Scanner] Error:', e);
  }
}

async function updatePrices() {
  const tokens = db.prepare('SELECT id, address, chain, current_price, ath_price FROM tokens ORDER BY created_at DESC LIMIT 20').all();
  
  for (const token of tokens) {
    try {
      const response = await axios.get(`https://api.dexscreener.com/latest/dex/tokens/${token.address}`);
      const pairs = response.data.pairs || [];
      const pair = pairs.find((p: any) => p.chainId === token.chain);

      if (pair) {
        const newPrice = parseFloat(pair.priceUsd);
        const newAth = Math.max(token.ath_price, newPrice);
        
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
}

// Background Loops
setInterval(scanNewPairs, 60000); // Scan every minute
setInterval(updatePrices, 30000); // Update prices every 30s
setInterval(learnFromTrades, 3600000); // Learn from trades every hour

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
    const perUserKeys = ['chat_id', 'alerts_enabled'];
    const targetUserId = perUserKeys.includes(key) ? userId : null;
    
    db.prepare('INSERT OR REPLACE INTO config (user_id, key, value) VALUES (?, ?, ?)').run(targetUserId, key, String(value));
    res.json({ success: true });
  });

  app.get('/api/tokens', (req, res) => {
    const since = req.query.since as string;
    let tokens;
    if (since) {
      tokens = db.prepare('SELECT * FROM tokens WHERE created_at >= ? ORDER BY created_at DESC LIMIT 50').all(since);
    } else {
      // Default to last 24 hours for unauthenticated or fresh view
      tokens = db.prepare("SELECT * FROM tokens WHERE created_at > datetime('now', '-24 hours') ORDER BY created_at DESC LIMIT 50").all();
    }
    res.json(tokens);
  });

  app.get('/api/tokens/history', (req, res) => {
    const since = req.query.since as string;
    let tokens;
    if (since) {
      tokens = db.prepare('SELECT * FROM tokens WHERE created_at >= ? ORDER BY created_at DESC').all(since);
    } else {
      tokens = db.prepare('SELECT * FROM tokens ORDER BY created_at DESC').all();
    }
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
    try {
      const totalCalls = db.prepare('SELECT COUNT(*) as count FROM tokens').get()?.count || 0;
      const avgSentiment = db.prepare('SELECT AVG(sentiment_score) as avg FROM tokens').get()?.avg || 0;
      const explosive = db.prepare('SELECT COUNT(*) as count FROM tokens WHERE ath_price >= call_price * 5').get()?.count || 0;
      const winners = db.prepare('SELECT COUNT(*) as count FROM tokens WHERE ath_price >= call_price * 2').get()?.count || 0;
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
        SELECT c1.user_id, c1.value as chat_id 
        FROM config c1
        JOIN config c2 ON (c1.user_id = c2.user_id OR (c1.user_id IS NULL AND c2.user_id IS NULL))
        WHERE c1.key = 'chat_id' AND c2.key = 'alerts_enabled' AND c2.value = 'true'
      `).all();

      for (const u of usersWithAlerts) {
        try {
          bot.sendMessage(u.chat_id, `🚀 *New Signal Detected!*\n\n*Token:* ${mockToken.symbol}\n*Score:* ${mockToken.nana_score.toFixed(1)}\n*Chain:* ${mockToken.chain}\n*Address:* \`${mockToken.address}\`\n\n[DexScreener](https://dexscreener.com/${mockToken.chain}/${mockToken.address})`, { parse_mode: 'Markdown' });
        } catch (err) {
          console.error(`Failed to send Telegram alert to user ${u.user_id}:`, err);
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

  app.get('/api/test/bot', async (req, res) => {
    if (!bot) {
      return res.status(500).json({ error: 'Bot not initialized' });
    }
    try {
      const me = await bot.getMe();
      res.json({ success: true, bot: me });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  const PORT = 3000;
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });

  async function updateATHPrices() {
    console.log('[Scanner] Updating ATH prices...');
    try {
      const tokens = db.prepare("SELECT id, address, chain, ath_price FROM tokens WHERE created_at > datetime('now', '-48 hours')").all();
      for (const token of tokens) {
        try {
          const pairRes = await axios.get(`https://api.dexscreener.com/latest/dex/tokens/${token.address}`);
          const pairs = pairRes.data.pairs || [];
          const pair = pairs.find((p: any) => p.chainId === token.chain) || pairs[0];
          
          if (pair) {
            const currentPrice = parseFloat(pair.priceUsd);
            if (currentPrice > token.ath_price) {
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
    }
  }

  // Start background scanner
  setInterval(scanNewPairs, 60000); // Scan every minute
  setInterval(updateATHPrices, 300000); // Update ATH every 5 minutes
  setInterval(learnFromTrades, 3600000); // Learn every hour
}

startServer();
