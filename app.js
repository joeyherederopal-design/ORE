// ================================================================
// ORE 2.0 — Oracle of Real Earnings (Mobile PWA)
// ================================================================

// Config
const COIN_IDS = {
  BTC:'bitcoin',ETH:'ethereum',SOL:'solana',XRP:'ripple',ADA:'cardano',
  AVAX:'avalanche-2',DOT:'polkadot',LINK:'chainlink',LTC:'litecoin',
  DOGE:'dogecoin',SHIB:'shiba-inu',BNB:'binancecoin',UNI:'uniswap',
  TRX:'tron',MATIC:'matic-network',ATOM:'cosmos',FIL:'filecoin',
  INJ:'injective-protocol',PEPE:'pepe',WIF:'dogwifcoin',SUI:'sui',
  ARB:'arbitrum',APT:'aptos',NEAR:'near',PAXG:'pax-gold'
};
const SCAN_CRYPTO = ['BTC','ETH','SOL','XRP','ADA','AVAX','DOT','LINK','LTC','DOGE','SHIB','BNB','UNI','TRX'];
const SCAN_STOCKS = ['AAPL','MSFT','GOOGL','AMZN','META','TSLA','NVDA','NFLX','JPM','V','DIS','AMD','COIN','HOOD'];
const EARNINGS_CAP = 1000000;

// State
let currentTab = 'overview';
let phpRate = 57;
let priceCache = {};
let historyCache = {};
let cacheTime = 0;

// ================================================================
// Storage (localStorage)
// ================================================================
function loadHoldings() {
  try { return JSON.parse(localStorage.getItem('ore_holdings')) || {crypto:{},stocks:{},funds:{}}; }
  catch(e) { return {crypto:{},stocks:{},funds:{}}; }
}
function saveHoldingsData(h) { localStorage.setItem('ore_holdings', JSON.stringify(h)); }
function getPeakEarnings() { return parseFloat(localStorage.getItem('ore_peak_earnings')) || 0; }
function updatePeakEarnings(pnl) {
  const peak = getPeakEarnings();
  if (pnl > peak) localStorage.setItem('ore_peak_earnings', String(pnl));
  return Math.max(peak, pnl);
}

// ================================================================
// Price Fetching
// ================================================================
async function fetchPhpRate() {
  try {
    const r = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=tether&vs_currencies=php');
    const d = await r.json();
    phpRate = d.tether.php;
  } catch(e) { phpRate = 57; }
  return phpRate;
}

async function fetchCryptoPrice(symbol) {
  const coinId = COIN_IDS[symbol];
  if (!coinId) return null;
  if (priceCache[symbol] && Date.now() - cacheTime < 60000) return priceCache[symbol];
  try {
    const r = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${coinId}&vs_currencies=php`);
    const d = await r.json();
    const price = d[coinId].php;
    priceCache[symbol] = price;
    cacheTime = Date.now();
    return price;
  } catch(e) { return null; }
}

async function fetchCryptoHistory(symbol) {
  const coinId = COIN_IDS[symbol];
  if (!coinId) return [];
  if (historyCache[symbol]) return historyCache[symbol];
  try {
    const r = await fetch(`https://api.coingecko.com/api/v3/coins/${coinId}/market_chart?vs_currency=php&days=90&interval=daily`);
    const d = await r.json();
    const closes = d.prices.map(p => p[1]);
    historyCache[symbol] = closes;
    return closes;
  } catch(e) { return []; }
}

async function fetchStock(symbol) {
  try {
    const proxy = 'https://corsproxy.io/?url=';
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}?interval=1d&range=3mo`;
    const r = await fetch(proxy + encodeURIComponent(url));
    const d = await r.json();
    const result = d.chart.result[0];
    const closes = result.indicators.quote[0].close.filter(c => c !== null && c !== undefined);
    if (closes.length === 0) return null;
    return { price: closes[closes.length - 1], closes };
  } catch(e) { return null; }
}

// ================================================================
// Indicators
// ================================================================
function calcRSI(closes, period = 14) {
  if (!closes || closes.length < period + 1) return 50;
  let gains = 0, losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gains += diff; else losses -= diff;
  }
  const avgGain = gains / period, avgLoss = losses / period;
  if (avgGain === 0 && avgLoss === 0) return 50;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

function calcSMA(closes, period) {
  if (!closes || closes.length < period) return null;
  let sum = 0;
  for (let i = closes.length - period; i < closes.length; i++) sum += closes[i];
  return sum / period;
}

// ================================================================
// Signals
// ================================================================
function getSignals(price, rsi, trend, mom, hi, lo, held, cost) {
  const sigs = [];
  if (rsi < 30) sigs.push(['BUY',3,`RSI ${rsi.toFixed(0)} oversold`]);
  else if (rsi > 70) sigs.push(['SELL',3,`RSI ${rsi.toFixed(0)} overbought`]);
  else if (rsi < 45) sigs.push(['BUY',1,`RSI ${rsi.toFixed(0)} bullish lean`]);
  else if (rsi > 55) sigs.push(['SELL',1,`RSI ${rsi.toFixed(0)} momentum up`]);
  else sigs.push(['HOLD',1,`RSI ${rsi.toFixed(0)} neutral`]);

  if (trend === 'UP') sigs.push(['BUY',2,'Golden Cross']);
  else sigs.push(['SELL',2,'Death Cross']);

  if (mom < -5) sigs.push(['BUY',2,`Down ${mom.toFixed(1)}% this week`]);
  else if (mom > 5) sigs.push(['SELL',1,`Up ${mom.toFixed(1)}% this week`]);
  else sigs.push(['HOLD',1,`Flat ${mom.toFixed(1)}%`]);

  if (hi && lo && hi !== lo) {
    const pos = (price - lo) / (hi - lo) * 100;
    if (pos < 25) sigs.push(['BUY',1,`Near low ${pos.toFixed(0)}%`]);
    else if (pos > 75) sigs.push(['SELL',1,`Near high ${pos.toFixed(0)}%`]);
  }

  if (held > 0 && cost > 0) {
    const pct = (held * price - cost) / cost * 100;
    if (pct >= 50) sigs.push(['SELL',3,`Up ${pct.toFixed(0)}% VERY ripe!`]);
    else if (pct >= 25) sigs.push(['SELL',2,`Up ${pct.toFixed(0)}% take profit`]);
    else if (pct >= 10) sigs.push(['HOLD',1,`Up ${pct.toFixed(0)}% healthy`]);
    else if (pct >= -10) sigs.push(['HOLD',1,`At ${pct.toFixed(0)}% break-even`]);
    else sigs.push(['BUY',1,`Down ${Math.abs(pct).toFixed(0)}% avg down?`]);
  } else sigs.push(['BUY',1,'No position yet']);

  let b = 0, s = 0, h = 0;
  sigs.forEach(x => { if(x[0]==='BUY')b+=x[1]; else if(x[0]==='SELL')s+=x[1]; else h+=x[1]; });
  if (b > s && b >= h) return { sigs, final:'BUY', buyScore:b };
  if (s > b && s >= h) return { sigs, final:'SELL', buyScore:b };
  return { sigs, final:'HOLD', buyScore:b };
}

function findValueDips(list, getPrice, getHistory) {
  const dips = [];
  list.forEach(async symbol => {
    const closes = getHistory ? (historyCache[symbol] || []) : [];
    const price = getPrice(symbol);
    if (!price || closes.length < 14) return;
    const rsi = calcRSI(closes);
    const hi = Math.max(...closes), lo = Math.min(...closes);
    const rangePos = (price - lo) / (hi - lo) * 100;
    if (rsi > 75 && rangePos > 85) return;
    let score = 0; const reasons = [];
    if (rsi < 25) { score+=5; reasons.push(`🔥 Oversold RSI ${rsi.toFixed(0)}`); }
    else if (rsi < 35) { score+=4; reasons.push(`✅ Very oversold RSI ${rsi.toFixed(0)}`); }
    else if (rsi < 45) { score+=3; reasons.push(`📉 Oversold RSI ${rsi.toFixed(0)}`); }
    if (rangePos < 20) { score+=4; reasons.push(`📈 Near LOW ${rangePos.toFixed(0)}%`); }
    else if (rangePos < 35) { score+=3; reasons.push(`📈 Near bottom ${rangePos.toFixed(0)}%`); }
    if (closes.length >= 6) {
      const r3 = closes.slice(-3).reduce((a,b)=>a+b,0)/3;
      const p3 = closes.slice(-6,-3).reduce((a,b)=>a+b,0)/3;
      if (r3 > p3) { score+=4; reasons.push(`🚀 Bouncing +${((r3-p3)/p3*100).toFixed(1)}%!`); }
    }
    const drop = ((hi - price) / hi) * 100;
    if (drop > 30) { score+=2; reasons.push(`💰 Down ${drop.toFixed(0)}% from peak`); }
    dips.push({ symbol, price, rsi, rangePos, drop, score, reasons });
  });
  return dips;
}

// ================================================================
// Formatting
// ================================================================
function fmtPHP(n) { return '₱' + Number(n).toLocaleString('en-PH', {maximumFractionDigits:2}); }
function fmtPct(n) { return (n >= 0 ? '+' : '') + n.toFixed(1) + '%'; }

function badgeHTML(final) {
  const cls = final === 'BUY' ? 'badge-buy' : final === 'SELL' ? 'badge-sell' : 'badge-hold';
  return `<span class="badge ${cls}">${final}</span>`;
}

function calcBox(held, cost, price, currency) {
  if (held <= 0 || cost <= 0) return '';
  const avg = cost / held;
  let html = '<div class="calc-box">🧮 IF YOU SELL:\n';
  [25, 50, 80, 100].forEach(p => {
    const sold = held * p / 100;
    const cash = sold * price;
    const profit = cash - sold * avg;
    const pp = (profit / (sold * avg)) * 100;
    const sign = profit >= 0 ? '+' : '';
    const cur = currency === '₱' ? '₱' : '$';
    html += `  ${p}%: ${cur}${cash.toFixed(0)} profit ${sign}${cur}${profit.toFixed(2)} (${pp.toFixed(0)}%)\n`;
  });
  return html + '</div>';
}

// ================================================================
// UI Rendering
// ================================================================
function switchTab(tab) {
  currentTab = tab;
  document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.tab === tab));
  if (tab === 'overview') renderOverview();
  else if (tab === 'crypto') renderCryptoHome();
  else if (tab === 'stocks') renderStocksHome();
  else if (tab === 'funds') renderFunds();
}

function setLoading(msg) {
  document.getElementById('content').innerHTML = `<div class="loading"><div class="spinner"></div>${msg}</div>`;
}

// ---- OVERVIEW ----
async function renderOverview() {
  setLoading('Fetching all your wealth...');
  const h = loadHoldings();
  await fetchPhpRate();
  let html = '<div class="btn-row"><button class="btn btn-gold" onclick="renderOverview()">💎 Refresh</button>';
  html += '<button class="btn btn-blue" onclick="openTradeModal()">💸 Trade</button></div>';

  // Fetch all data
  let cryptoVal = 0, cryptoInv = 0, stockVal = 0, stockInv = 0, fundVal = 0, fundInv = 0;
  const cryptoItems = [], stockItems = [], fundItems = [];

  // Crypto
  for (const coin in h.crypto) {
    const qty = h.crypto[coin].qty;
    if (qty <= 0) continue;
    const price = await fetchCryptoPrice(coin);
    if (price) {
      const val = qty * price;
      cryptoVal += val; cryptoInv += h.crypto[coin].cost;
      cryptoItems.push({ name: coin, value: val, pnl: val - h.crypto[coin].cost });
    }
  }

  // Stocks
  for (const sym in h.stocks) {
    const qty = h.stocks[sym].qty;
    if (qty <= 0) continue;
    const data = await fetchStock(sym);
    if (data) {
      const val = qty * data.price * phpRate;
      stockVal += val; stockInv += h.stocks[sym].cost * phpRate;
      stockItems.push({ name: sym, value: val, pnl: val - h.stocks[sym].cost * phpRate });
    }
  }

  // Funds
  for (const name in h.funds) {
    fundVal += h.funds[name].qty; fundInv += h.funds[name].cost;
    fundItems.push({ name, value: h.funds[name].qty, pnl: h.funds[name].qty - h.funds[name].cost });
  }

  const total = cryptoVal + stockVal + fundVal;
  const inv = cryptoInv + stockInv + fundInv;
  const pnl = total - inv;
  const pnlPct = inv > 0 ? (pnl / inv * 100) : 0;
  const peak = updatePeakEarnings(pnl);
  const peakPct = Math.min(100, peak / EARNINGS_CAP * 100);

  // Net worth card
  html += `<div class="networth-card">
    <div class="networth-label">💎 Total Net Worth</div>
    <div class="networth-value">${fmtPHP(total)}</div>
    <div class="networth-pnl ${pnl >= 0 ? 'profit' : 'loss'}">${pnl >= 0 ? '+' : ''}${fmtPHP(pnl)} (${pnlPct.toFixed(1)}%)</div>
  </div>`;

  // Sections
  if (cryptoItems.length) {
    html += '<div class="section-header" style="color:#f7931a;">🪙 CRYPTO</div>';
    cryptoItems.forEach(c => {
      html += `<div class="card"><div class="card-row"><span>${c.name}</span><span>${fmtPHP(c.value)}</span></div>`;
      html += `<div class="card-pnl ${c.pnl>=0?'profit':'loss'}">${c.pnl>=0?'+':''}${fmtPHP(c.pnl)}</div></div>`;
    });
  }
  if (stockItems.length) {
    html += '<div class="section-header" style="color:#00d09c;">📈 STOCKS</div>';
    stockItems.forEach(s => {
      html += `<div class="card"><div class="card-row"><span>${s.name}</span><span>${fmtPHP(s.value)}</span></div>`;
      html += `<div class="card-pnl ${s.pnl>=0?'profit':'loss'}">${s.pnl>=0?'+':''}${fmtPHP(s.pnl)}</div></div>`;
    });
  }
  if (fundItems.length) {
    html += '<div class="section-header" style="color:#0abde3;">🏦 FUNDS</div>';
    fundItems.forEach(f => {
      html += `<div class="card"><div class="card-row"><span>${f.name}</span><span>${fmtPHP(f.value)}</span></div>`;
      html += `<div class="card-pnl ${f.pnl>=0?'profit':'loss'}">${f.pnl>=0?'+':''}${fmtPHP(f.pnl)}</div></div>`;
    });
  }

  // Earnings cap
  html += `<div class="card" style="text-align:center;">
    <div class="card-sub">Earnings Cap</div>
    <div class="card-pnl profit">${fmtPHP(peak)} / ${fmtPHP(EARNINGS_CAP)} (${peakPct.toFixed(1)}%)</div>
    <div class="progress-bar"><div class="progress-fill" style="width:${peakPct}%;background:${peakPct>80?'#f0c040':'#00d09c'};"></div></div>
  </div>`;

  document.getElementById('content').innerHTML = html;
  updateTime();
}

// ---- CRYPTO ----
function renderCryptoHome() {
  const html = `<div class="btn-row">
    <button class="btn btn-blue" onclick="renderCryptoSignals()">📊 Signals</button>
    <button class="btn btn-gold" onclick="renderCryptoScan()">🔍 Best</button>
    <button class="btn btn-green" onclick="renderCryptoDips()">💎 Dips</button>
  </div>
  <div class="card" style="text-align:center;color:#a0a0b0;">Tap a button above to analyze your crypto</div>`;
  document.getElementById('content').innerHTML = html;
}

async function renderCryptoSignals() {
  setLoading('Fetching crypto signals...');
  const h = loadHoldings();
  let html = '<div class="section-header">🪙 Your Crypto Signals</div>';
  for (const coin in h.crypto) {
    const qty = h.crypto[coin].qty;
    if (qty <= 0) continue;
    const price = await fetchCryptoPrice(coin);
    const closes = await fetchCryptoHistory(coin);
    if (!price || closes.length < 14) continue;
    const rsi = calcRSI(closes), s10 = calcSMA(closes,10), s30 = calcSMA(closes,30);
    const trend = s10 > s30 ? 'UP' : 'DOWN';
    const mom = closes.length >= 14 ? ((closes.slice(-7).reduce((a,b)=>a+b,0)/7 - closes.slice(-14,-7).reduce((a,b)=>a+b,0)/3) / (closes.slice(-14,-7).reduce((a,b)=>a+b,0)/7) * 100) : 0;
    const rec = getSignals(price, rsi, trend, mom, Math.max(...closes), Math.min(...closes), qty, h.crypto[coin].cost);
    const val = qty * price, pnl = val - h.crypto[coin].cost, pnlPct = (pnl/h.crypto[coin].cost)*100;
    html += `<div class="card">
      <div class="card-row"><span class="card-title">${coin}</span>${badgeHTML(rec.final)}</div>
      <div class="card-price">${fmtPHP(price)}</div>
      <div class="card-sub">RSI ${rsi.toFixed(0)} | Trend ${trend} | 7d ${mom.toFixed(1)}%</div>
      <div class="card-pnl ${pnl>=0?'profit':'loss'}">Value ${fmtPHP(val)} | P&L ${pnl>=0?'+':''}${fmtPHP(pnl)} (${pnlPct.toFixed(1)}%)</div>`;
    rec.sigs.forEach(s => html += `<div class="signal-line">[${s[0]}] ${s[2]}</div>`);
    html += calcBox(qty, h.crypto[coin].cost, price, '₱') + '</div>';
  }
  if (html === '<div class="section-header">🪙 Your Crypto Signals</div>')
    html += '<div class="card" style="text-align:center;color:#a0a0b0;">No crypto holdings. Use 💸 Trade to add some.</div>';
  document.getElementById('content').innerHTML = html;
}

async function renderCryptoScan() {
  setLoading('Scanning crypto market...');
  let html = '<div class="section-header">🔍 Best Coins to Buy</div>';
  const results = [];
  for (const coin of SCAN_CRYPTO) {
    const price = await fetchCryptoPrice(coin);
    const closes = await fetchCryptoHistory(coin);
    if (!price || closes.length < 14) continue;
    const rsi = calcRSI(closes), s10 = calcSMA(closes,10), s30 = calcSMA(closes,30);
    const trend = s10 > s30 ? 'UP' : 'DOWN';
    const mom = closes.length >= 14 ? ((closes.slice(-7).reduce((a,b)=>a+b,0)/7 - closes.slice(-14,-7).reduce((a,b)=>a+b,0)/3) / (closes.slice(-14,-7).reduce((a,b)=>a+b,0)/7) * 100) : 0;
    const rec = getSignals(price, rsi, trend, mom, Math.max(...closes), Math.min(...closes), 0, 0);
    results.push({ coin, price, rsi, trend, mom, rec });
  }
  results.sort((a,b) => b.rec.buyScore - a.rec.buyScore);
  const medals = ['🥇','🥈','🥉','4️⃣','5️⃣','6️⃣','7️⃣','8️⃣','9️⃣','🔟'];
  results.slice(0,10).forEach((r, i) => {
    html += `<div class="scan-item"><div class="card-row">
      <span><span class="medal">${medals[i]}</span><b>${r.coin}</b> ${fmtPHP(r.price)}</span>${badgeHTML(r.rec.final)}</div>`;
    const buys = r.rec.sigs.filter(s => s[0]==='BUY').slice(0,2);
    buys.forEach(b => html += `<div class="reason">✓ ${b[2]}</div>`);
    html += '</div>';
  });
  document.getElementById('content').innerHTML = html;
}

async function renderCryptoDips() {
  setLoading('Finding value dips...');
  let html = '<div class="section-header" style="color:#00d09c;">💎 Value Dips — Buy Low</div>';
  const dips = [];
  for (const coin of SCAN_CRYPTO) {
    const price = await fetchCryptoPrice(coin);
    const closes = await fetchCryptoHistory(coin);
    if (!price || closes.length < 14) continue;
    const rsi = calcRSI(closes);
    const hi = Math.max(...closes), lo = Math.min(...closes);
    const rangePos = (price - lo) / (hi - lo) * 100;
    if (rsi > 75 && rangePos > 85) continue;
    let score = 0; const reasons = [];
    if (rsi < 25) { score+=5; reasons.push(`🔥 Oversold RSI ${rsi.toFixed(0)}`); }
    else if (rsi < 35) { score+=4; reasons.push(`✅ Very oversold RSI ${rsi.toFixed(0)}`); }
    else if (rsi < 45) { score+=3; reasons.push(`📉 Oversold RSI ${rsi.toFixed(0)}`); }
    if (rangePos < 20) { score+=4; reasons.push(`📈 Near LOW ${rangePos.toFixed(0)}%`); }
    else if (rangePos < 35) { score+=3; reasons.push(`📈 Near bottom ${rangePos.toFixed(0)}%`); }
    if (closes.length >= 6) {
      const r3 = closes.slice(-3).reduce((a,b)=>a+b,0)/3;
      const p3 = closes.slice(-6,-3).reduce((a,b)=>a+b,0)/3;
      if (r3 > p3) { score+=4; reasons.push(`🚀 Bouncing +${((r3-p3)/p3*100).toFixed(1)}%!`); }
    }
    const drop = ((hi-price)/hi)*100;
    if (drop > 30) { score+=2; reasons.push(`💰 Down ${drop.toFixed(0)}% from peak`); }
    else if (drop > 15) { score+=1; reasons.push(`💰 Down ${drop.toFixed(0)}% from peak`); }
    dips.push({ coin, price, rsi, rangePos, drop, score, reasons });
  }
  dips.sort((a,b) => b.score - a.score);
  if (dips.length === 0) {
    html += '<div class="card" style="text-align:center;color:#ffd93d;">No strong dips found right now.</div>';
  } else {
    const medals = ['🥇','🥈','🥉','4️⃣','5️⃣'];
    dips.slice(0,5).forEach((d, i) => {
      const badge = d.score >= 10 ? '<span class="badge badge-sell">🔥 HOT</span>' :
                    d.score >= 6 ? '<span class="badge badge-buy">✅ GOOD</span>' :
                    '<span class="badge badge-hold">🟡 WATCH</span>';
      html += `<div class="card"><div class="card-row">
        <span><span class="medal">${medals[i]}</span><b>${d.coin}</b> ${fmtPHP(d.price)}</span>${badge}</div>`;
      html += `<div class="card-sub">RSI ${d.rsi.toFixed(0)} | Range ${d.rangePos.toFixed(0)}% | Down ${d.drop.toFixed(0)}%</div>`;
      d.reasons.forEach(r => html += `<div class="reason">${r}</div>`);
      html += '</div>';
    });
  }
  document.getElementById('content').innerHTML = html;
}

// ---- STOCKS ----
function renderStocksHome() {
  const html = `<div class="btn-row">
    <button class="btn btn-blue" onclick="renderStockSignals()">📊 Signals</button>
    <button class="btn btn-gold" onclick="renderStockScan()">🔍 Best</button>
    <button class="btn btn-green" onclick="renderStockDips()">💎 Dips</button>
  </div>
  <div class="card" style="text-align:center;color:#a0a0b0;">Tap a button above to analyze your stocks</div>`;
  document.getElementById('content').innerHTML = html;
}

async function renderStockSignals() {
  setLoading('Fetching stock signals...');
  const h = loadHoldings();
  await fetchPhpRate();
  let html = '<div class="section-header">📈 Your Stock Signals</div>';
  for (const sym in h.stocks) {
    const qty = h.stocks[sym].qty;
    if (qty <= 0) continue;
    const data = await fetchStock(sym);
    if (!data) continue;
    const { price, closes } = data;
    const rsi = calcRSI(closes), s10 = calcSMA(closes,10), s30 = calcSMA(closes,30);
    const trend = s10 > s30 ? 'UP' : 'DOWN';
    const mom = closes.length >= 14 ? ((closes.slice(-7).reduce((a,b)=>a+b,0)/7 - closes.slice(-14,-7).reduce((a,b)=>a+b,0)/7) / (closes.slice(-14,-7).reduce((a,b)=>a+b,0)/7) * 100) : 0;
    const rec = getSignals(price, rsi, trend, mom, Math.max(...closes), Math.min(...closes), qty, h.stocks[sym].cost);
    const val = qty * price, pnl = val - h.stocks[sym].cost, pnlPct = (pnl/h.stocks[sym].cost)*100;
    html += `<div class="card">
      <div class="card-row"><span class="card-title">${sym}</span>${badgeHTML(rec.final)}</div>
      <div class="card-price">$${price.toFixed(2)} (${fmtPHP(price*phpRate)})</div>
      <div class="card-sub">RSI ${rsi.toFixed(0)} | Trend ${trend} | 7d ${mom.toFixed(1)}%</div>
      <div class="card-pnl ${pnl>=0?'profit':'loss'}">Value $${val.toFixed(2)} | P&L ${pnl>=0?'+':''}$${pnl.toFixed(2)} (${pnlPct.toFixed(1)}%)</div>`;
    rec.sigs.forEach(s => html += `<div class="signal-line">[${s[0]}] ${s[2]}</div>`);
    html += calcBox(qty, h.stocks[sym].cost, price, '$') + '</div>';
  }
  if (html === '<div class="section-header">📈 Your Stock Signals</div>')
    html += '<div class="card" style="text-align:center;color:#a0a0b0;">No stock holdings.</div>';
  document.getElementById('content').innerHTML = html;
}

async function renderStockScan() {
  setLoading('Scanning stock market...');
  await fetchPhpRate();
  let html = '<div class="section-header">🔍 Best Stocks to Buy</div>';
  const results = [];
  for (const sym of SCAN_STOCKS) {
    const data = await fetchStock(sym);
    if (!data) continue;
    const { price, closes } = data;
    const rsi = calcRSI(closes), s10 = calcSMA(closes,10), s30 = calcSMA(closes,30);
    const trend = s10 > s30 ? 'UP' : 'DOWN';
    const mom = closes.length >= 14 ? ((closes.slice(-7).reduce((a,b)=>a+b,0)/7 - closes.slice(-14,-7).reduce((a,b)=>a+b,0)/7) / (closes.slice(-14,-7).reduce((a,b)=>a+b,0)/7) * 100) : 0;
    const rec = getSignals(price, rsi, trend, mom, Math.max(...closes), Math.min(...closes), 0, 0);
    results.push({ sym, price, rec });
  }
  results.sort((a,b) => b.rec.buyScore - a.rec.buyScore);
  const medals = ['🥇','🥈','🥉','4️⃣','5️⃣','6️⃣','7️⃣','8️⃣','9️⃣','🔟'];
  results.slice(0,10).forEach((r, i) => {
    html += `<div class="scan-item"><div class="card-row">
      <span><span class="medal">${medals[i]}</span><b>${r.sym}</b> $${r.price.toFixed(2)} (${fmtPHP(r.price*phpRate)})</span>${badgeHTML(r.rec.final)}</div>`;
    const buys = r.rec.sigs.filter(s => s[0]==='BUY').slice(0,2);
    buys.forEach(b => html += `<div class="reason">✓ ${b[2]}</div>`);
    html += '</div>';
  });
  document.getElementById('content').innerHTML = html;
}

async function renderStockDips() {
  setLoading('Finding stock value dips...');
  await fetchPhpRate();
  let html = '<div class="section-header" style="color:#00d09c;">💎 Stock Value Dips</div>';
  const dips = [];
  for (const sym of SCAN_STOCKS) {
    const data = await fetchStock(sym);
    if (!data) continue;
    const { price, closes } = data;
    const rsi = calcRSI(closes);
    const hi = Math.max(...closes), lo = Math.min(...closes);
    const rangePos = (price - lo) / (hi - lo) * 100;
    if (rsi > 75 && rangePos > 85) continue;
    let score = 0; const reasons = [];
    if (rsi < 25) { score+=5; reasons.push(`🔥 Oversold RSI ${rsi.toFixed(0)}`); }
    else if (rsi < 35) { score+=4; reasons.push(`✅ Very oversold RSI ${rsi.toFixed(0)}`); }
    else if (rsi < 45) { score+=3; reasons.push(`📉 Oversold RSI ${rsi.toFixed(0)}`); }
    if (rangePos < 20) { score+=4; reasons.push(`📈 Near LOW ${rangePos.toFixed(0)}%`); }
    else if (rangePos < 35) { score+=3; reasons.push(`📈 Near bottom ${rangePos.toFixed(0)}%`); }
    const drop = ((hi-price)/hi)*100;
    if (drop > 30) { score+=2; reasons.push(`💰 Down ${drop.toFixed(0)}% from peak`); }
    else if (drop > 15) { score+=1; reasons.push(`💰 Down ${drop.toFixed(0)}% from peak`); }
    dips.push({ sym, price, rsi, rangePos, drop, score, reasons });
  }
  dips.sort((a,b) => b.score - a.score);
  if (dips.length === 0) {
    html += '<div class="card" style="text-align:center;color:#ffd93d;">No strong dips found.</div>';
  } else {
    const medals = ['🥇','🥈','🥉','4️⃣','5️⃣'];
    dips.slice(0,5).forEach((d, i) => {
      const badge = d.score >= 10 ? '<span class="badge badge-sell">🔥 HOT</span>' :
                    d.score >= 6 ? '<span class="badge badge-buy">✅ GOOD</span>' :
                    '<span class="badge badge-hold">🟡 WATCH</span>';
      html += `<div class="card"><div class="card-row">
        <span><span class="medal">${medals[i]}</span><b>${d.sym}</b> $${d.price.toFixed(2)}</span>${badge}</div>`;
      d.reasons.forEach(r => html += `<div class="reason">${r}</div>`);
      html += '</div>';
    });
  }
  document.getElementById('content').innerHTML = html;
}

// ---- FUNDS ----
function renderFunds() {
  const h = loadHoldings();
  let html = '<div class="section-header">🏦 My GFunds</div>';
  let totalVal = 0, totalInv = 0;
  for (const name in h.funds) {
    const cur = h.funds[name].qty, inv = h.funds[name].cost;
    const pnl = cur - inv, pct = inv > 0 ? (pnl/inv*100) : 0;
    totalVal += cur; totalInv += inv;
    let calcHTML = '<div class="calc-box">🧮 IF YOU WITHDRAW:\n';
    [25,50,80,100].forEach(p => {
      const w = cur*p/100, cp = inv*p/100, profit = w-cp;
      calcHTML += `  ${p}%: ₱${w.toFixed(0)} profit ${profit>=0?'+':''}₱${profit.toFixed(2)}\n`;
    });
    calcHTML += '</div>';
    html += `<div class="card">
      <div class="card-title">${name}</div>
      <div class="card-sub">Invested ${fmtPHP(inv)} | Current ${fmtPHP(cur)}</div>
      <div class="card-pnl ${pnl>=0?'profit':'loss'}">Growth ${pnl>=0?'+':''}${fmtPHP(pnl)} (${pct.toFixed(2)}%)</div>
      ${calcHTML}</div>`;
  }
  if (totalVal === 0) html += '<div class="card" style="text-align:center;color:#a0a0b0;">No fund holdings.</div>';
  else {
    const pnl = totalVal - totalInv, pct = totalInv > 0 ? (pnl/totalInv*100) : 0;
    html += `<div class="card" style="background:#0f3460;text-align:center;">
      <div class="card-sub">📊 FUNDS TOTAL</div>
      <div style="font-size:22px;font-weight:bold;">${fmtPHP(totalVal)}</div>
      <div class="card-pnl ${pnl>=0?'profit':'loss'}">${pnl>=0?'+':''}${fmtPHP(pnl)} (${pct.toFixed(2)}%)</div>
    </div>`;
  }
  document.getElementById('content').innerHTML = html;
}

// ---- TRADE MODAL ----
function openTradeModal() {
  document.getElementById('tradeModal').classList.add('show');
  document.querySelectorAll('input[name="tPlatform"]').forEach(r =>
    r.addEventListener('change', updateTradeLabel));
  document.querySelectorAll('input[name="tAction"]').forEach(r =>
    r.addEventListener('change', updateTradeLabel));
}
function closeModal(id) { document.getElementById(id).classList.remove('show'); }
function updateTradeLabel() {
  const plat = document.querySelector('input[name="tPlatform"]:checked').value;
  const act = document.querySelector('input[name="tAction"]:checked').value;
  const label = document.getElementById('tAmountLabel');
  if (plat === 'stocks') label.textContent = act === 'BUY' ? 'USD spent' : 'Shares sold';
  else if (plat === 'funds') label.textContent = act === 'BUY' ? 'PHP invested' : 'PHP withdrawn';
  else label.textContent = act === 'BUY' ? 'PHP spent' : 'Coins sold';
}

async function saveTrade() {
  const plat = document.querySelector('input[name="tPlatform"]:checked').value;
  const act = document.querySelector('input[name="tAction"]:checked').value;
  const name = document.getElementById('tName').value.trim().toUpperCase();
  const amount = parseFloat(document.getElementById('tAmount').value);
  if (!name || !amount || amount <= 0) { alert('Enter valid name and amount'); return; }

  const h = loadHoldings();
  if (act === 'BUY') {
    if (plat === 'funds') {
      if (h.funds[name]) { h.funds[name].qty += amount; h.funds[name].cost += amount; }
      else h.funds[name] = { qty: amount, cost: amount };
    } else {
      const price = plat === 'crypto' ? await fetchCryptoPrice(name) : (await fetchStock(name))?.price;
      if (!price) { alert(`Could not get price for ${name}`); return; }
      const qty = amount / price;
      if (h[plat][name]) { h[plat][name].qty += qty; h[plat][name].cost += amount; }
      else h[plat][name] = { qty, cost: amount };
    }
  } else {
    if (!h[plat][name] || h[plat][name].qty <= 0) { alert(`You don't hold ${name}`); return; }
    const old = h[plat][name].qty;
    const sold = Math.min(amount, old);
    const prop = sold / old;
    h[plat][name].qty -= sold;
    h[plat][name].cost = Math.max(0, h[plat][name].cost * (1 - prop));
    if (h[plat][name].qty < 1e-8) { h[plat][name].qty = 0; h[plat][name].cost = 0; }
  }
  saveHoldingsData(h);
  closeModal('tradeModal');
  alert(`✅ ${act} recorded for ${name}!`);
  switchTab(currentTab);
}

// ---- Utilities ----
function updateTime() {
  document.getElementById('headerTime').textContent =
    new Date().toLocaleTimeString('en-PH', { hour:'2-digit', minute:'2-digit' });
}

// ---- Init ----
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

// Auto-import desktop holdings on first run
function importDesktopData() {
  if (localStorage.getItem('ore_imported')) return;
  // Pre-fill with Joey's known holdings
  const data = {
    crypto: {
      ETH: { qty: 0.01094362, cost: 1659.95 },
      LTC: { qty: 0.37554200, cost: 1200.27 },
      SHIB: { qty: 629633, cost: 211.00 },
      UNI: { qty: 6.31900000, cost: 1719 }
    },
    stocks: {
      GOOGL: { qty: 0.031620784, cost: 11.00 },
      META: { qty: 0.145833567, cost: 81.89 }
    },
    funds: {
      'MANULIFE IM': { qty: 1009.37, cost: 1009.37 },
      'BPI-IMI': { qty: 880.16, cost: 880.16 }
    }
  };
  saveHoldingsData(data);
  localStorage.setItem('ore_imported', 'true');
}

importDesktopData();
setInterval(updateTime, 60000);
renderOverview();
