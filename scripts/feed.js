// GoldWorth feeder — her calistirmada (30 dk) metals.json + altinapi.json'dan prices.json uretir.
// Ek olarak: gunluk degisim (dunku kapanisa gore), gun ici en yuksek/en dusuk,
// history/daily.json (gunluk kapanislar) ve history/intraday.json (son 8 gun, 30 dk'lik) dosyalarini gunceller.
// Disariya istek atmaz; girdi dosyalarini workflow curl ile indirir.

const fs = require('fs');
const path = require('path');

const ROOT = process.env.FEED_ROOT || process.cwd();
const P = (f) => path.join(ROOT, f);
const NOW = process.env.FEED_NOW ? new Date(process.env.FEED_NOW) : new Date();
const TZ = 'Europe/Istanbul';
const INTRADAY_DAYS = 8;

const readJson = (f, fallback) => {
  try { return JSON.parse(fs.readFileSync(P(f), 'utf8')); } catch { return fallback; }
};
const writeJson = (f, obj, pretty) => {
  fs.mkdirSync(path.dirname(P(f)), { recursive: true });
  fs.writeFileSync(P(f), JSON.stringify(obj, null, pretty ? 2 : 0));
};
const num = (x) => (Number.isFinite(Number(x)) && Number(x) > 0 ? Number(x) : null);
const inv = (x) => (x > 0 ? 1 / x : null);
const round = (x, d = 6) => (x == null ? null : Number(x.toPrecision(d + 3)));
const istanbulDay = (d) => d.toLocaleDateString('en-CA', { timeZone: TZ }); // YYYY-MM-DD

// ---------- 1) Girdiler ----------
const m = readJson('metals.json', null);
const a = readJson('altinapi.json', null);
if (!m) { console.error('metals.json okunamadi'); process.exit(1); }
if (!a) { console.error('altinapi.json okunamadi'); process.exit(1); }

const metals = m.metals || {};
const c = m.currencies || {};
const rows = Array.isArray(a.data) ? a.data : [];
if (rows.length === 0) { console.error('altinapi bos dondu'); process.exit(1); }

// Onceki calistirmanin fiyatlari — eski "change" alani icin (geri uyumluluk)
const prev = {};
const old = readJson('prices.json', {});
for (const s of (old.tr?.symbols || [])) prev[s.symbol] = s.bid;

// ---------- 2) Gun durumu (acilis / en yuksek / en dusuk / dunku kapanis) ----------
const FX_TRACK = ['TRY', 'EUR', 'GBP', 'INR', 'AED', 'SAR', 'CHF'];
const METALS_TRACK = ['gold', 'silver', 'platinum', 'palladium'];

const current = {};
for (const r of rows) {
  const bid = num(r.bid);
  if (bid != null) current['tr:' + r.symbol] = bid;
}
for (const k of METALS_TRACK) if (num(metals[k]) != null) current['m:' + k] = num(metals[k]);
for (const k of FX_TRACK) { const v = inv(num(c[k])); if (v != null) current['fx:' + k] = v; }

const today = istanbulDay(NOW);
let state = readJson('history/state.json', null);
const daily = readJson('history/daily.json', null) || {
  note: 'Gunluk kapanis. Metaller USD/ons, kurlar 1 USD karsiligi birim, trAltin = Harem has altin gram TL (alis).',
  fields: ['date', 'gold', 'silver', 'platinum', 'palladium', 'TRY', 'EUR', 'INR', 'GBP', 'trAltin'],
  rows: []
};

const dailyRowFrom = (date, vals) => [
  date,
  round(vals['m:gold']), round(vals['m:silver']), round(vals['m:platinum']), round(vals['m:palladium']),
  round(vals['fx:TRY']), round(vals['fx:EUR']), round(vals['fx:INR']), round(vals['fx:GBP']),
  round(vals['tr:ALTIN'])
];

const upsertDaily = (row) => {
  const i = daily.rows.findIndex((r) => r[0] === row[0]);
  if (i >= 0) {
    // Mevcut satirda olmayan alanlari doldur, olanlari bu calistirmanin kapanisiyla guncelle
    daily.rows[i] = daily.rows[i].map((v, j) => (row[j] != null ? row[j] : v));
  } else {
    daily.rows.push(row);
    daily.rows.sort((x, y) => (x[0] < y[0] ? -1 : 1));
  }
};

// Backfill'den gelen son gunluk kapanis — state yoksa metaller/kurlar icin dunku kapanis olarak kullanilir
const lastDailyBefore = (day) => {
  for (let i = daily.rows.length - 1; i >= 0; i--) if (daily.rows[i][0] < day) return daily.rows[i];
  return null;
};
const prevCloseFromDaily = (day) => {
  const r = lastDailyBefore(day);
  if (!r) return {};
  const f = daily.fields;
  const out = {};
  const put = (key, field) => { const v = r[f.indexOf(field)]; if (v != null) out[key] = v; };
  put('m:gold', 'gold'); put('m:silver', 'silver'); put('m:platinum', 'platinum'); put('m:palladium', 'palladium');
  put('fx:TRY', 'TRY'); put('fx:EUR', 'EUR'); put('fx:INR', 'INR'); put('fx:GBP', 'GBP');
  put('tr:ALTIN', 'trAltin');
  return out;
};

if (!state || state.day !== today) {
  // Yeni gun: dunun son degerlerini kapanis olarak yaz
  if (state && state.day && state.last) upsertDaily(dailyRowFrom(state.day, state.last));
  const prevClose = { ...prevCloseFromDaily(today), ...(state && state.last ? state.last : {}) };
  state = { day: today, prevDay: state ? state.day : null, prevClose, open: { ...current }, high: { ...current }, low: { ...current }, last: {} };
}
for (const [k, v] of Object.entries(current)) {
  if (state.open[k] == null) state.open[k] = v;
  state.high[k] = state.high[k] == null ? v : Math.max(state.high[k], v);
  state.low[k] = state.low[k] == null ? v : Math.min(state.low[k], v);
  state.last[k] = v;
}

const dayInfo = (key, value) => {
  const pc = state.prevClose[key] ?? null;
  const change = value != null && pc > 0 ? value - pc : null;
  return {
    prevClose: pc,
    dayChange: change,
    dayChangePct: change != null ? (change / pc) * 100 : null,
    dayOpen: state.open[key] ?? null,
    dayHigh: state.high[key] ?? null,
    dayLow: state.low[key] ?? null
  };
};

// ---------- 3) prices.json ----------
const symbols = rows.map((r) => {
  const bid = num(r.bid);
  const ask = num(r.ask);
  const p = prev[r.symbol];
  const change = bid != null && p > 0 ? bid - p : null;
  return {
    symbol: r.symbol,
    category: r.category || null,
    bid, ask,
    // Eski alanlar: son calistirmaya (30 dk) gore degisim — mevcut uygulama surumu bunu okuyor
    change,
    changePct: change != null && p > 0 ? (change / p) * 100 : null,
    // Yeni alanlar: dunku kapanisa gore gunluk degisim + gun ici aralik
    ...dayInfo('tr:' + r.symbol, bid)
  };
});

const find = (sym) => symbols.find((s) => s.symbol === sym)?.bid ?? null;

const day = {};
for (const k of METALS_TRACK) {
  const v = num(metals[k]);
  day[k] = { price: v, ...dayInfo('m:' + k, v) };
}

const out = {
  updatedAt: NOW.toISOString(),
  historyFiles: { daily: 'history/daily.json', intraday: 'history/intraday.json' },
  global: {
    base: 'USD',
    goldPerOz: metals.gold ?? null,
    silverPerOz: metals.silver ?? null,
    goldPerGram: metals.gold ? metals.gold / 31.1034768 : null,
    silverPerGram: metals.silver ? metals.silver / 31.1034768 : null,
    platinumPerOz: metals.platinum ?? null,
    palladiumPerOz: metals.palladium ?? null,
    // Gunluk degisim (dunku kapanisa gore), USD/ons
    day,
    // LBMA resmi fiyatlari (USD/ons) — Avrupa bolgesinde EUR'ya cevrilerek gosterilir
    lbma: {
      goldAm: metals.lbma_gold_am ?? null,
      goldPm: metals.lbma_gold_pm ?? null,
      silver: metals.lbma_silver ?? null,
      platinumAm: metals.lbma_platinum_am ?? null,
      platinumPm: metals.lbma_platinum_pm ?? null,
      palladiumAm: metals.lbma_palladium_am ?? null,
      palladiumPm: metals.lbma_palladium_pm ?? null
    },
    // Hindistan referanslari (USD/ons) — INR'ye cevrilerek gosterilir
    india: {
      ibjaGold: metals.ibja_gold ?? null,
      ibjaSilver: metals.ibja_silver ?? null,
      mcxGold: metals.mcx_gold ?? null,
      mcxSilver: metals.mcx_silver ?? null
    },
    allMetals: metals,
    // 1 birim = kac USD (metals.dev ham hali). Tersi: 1 USD = 1/x birim
    allCurrencies: c,
    unitsPerUsd: {
      TRY: inv(c.TRY), EUR: inv(c.EUR), INR: inv(c.INR),
      AED: inv(c.AED), SAR: inv(c.SAR), GBP: inv(c.GBP), CHF: inv(c.CHF)
    }
  },
  tr: {
    // Mevcut ekranlarin kullandigi alanlar — degismedi
    altin: find('ALTIN'),
    gumus: find('GUMTRY'),
    usd: find('USDTRY'),
    eur: find('EURTRY'),
    gbp: find('GBPTRY'),
    stale: a.stale === true,
    sourceUpdatedAt: a.updatedAt || null,
    dayStart: state.day,
    symbols
  }
};

if (out.global.goldPerOz == null) { console.error('metals.dev altin gelmedi'); process.exit(1); }
if (out.tr.altin == null) { console.error('altinapi ALTIN gelmedi'); process.exit(1); }

// ---------- 4) Gun ici gecmis (son 8 gun) ----------
const intraday = readJson('history/intraday.json', null) || {
  note: 'Son 8 gun, ~30 dk aralikla. Metaller USD/ons, TRY = 1 USD kac TL, trAltin = Harem has altin gram TL (alis).',
  fields: ['t', 'gold', 'silver', 'platinum', 'palladium', 'TRY', 'trAltin'],
  rows: []
};
const tKey = NOW.toISOString().slice(0, 16) + 'Z';
const cutoff = new Date(NOW.getTime() - INTRADAY_DAYS * 86400000).toISOString();
intraday.rows = intraday.rows.filter((r) => r[0] >= cutoff && r[0] !== tKey);
intraday.rows.push([
  tKey,
  round(current['m:gold']), round(current['m:silver']), round(current['m:platinum']), round(current['m:palladium']),
  round(current['fx:TRY']), round(current['tr:ALTIN'])
]);

// Bugunun satirini da gunluk dosyada guncel tut (grafigin son noktasi icin)
upsertDaily(dailyRowFrom(today, state.last));

writeJson('prices.json', out, true);
writeJson('history/state.json', state, false);
writeJson('history/intraday.json', intraday, false);
writeJson('history/daily.json', daily, false);

console.log('prices.json yazildi:', out.updatedAt, '| gun:', state.day, '| gunluk satir:', daily.rows.length, '| gun ici satir:', intraday.rows.length);
