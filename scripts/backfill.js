// GoldWorth gecmis fiyat doldurma — TEK SEFERLIK (elle calistirilir).
// metals.dev timeseries (30 gunluk parcalar) -> altin, gumus, platin, paladyum (USD/ons) + EUR/INR/GBP
// Frankfurter (Avrupa Merkez Bankasi kurlari, ucretsiz, anahtarsiz) -> TRY (ve eksik EUR/INR/GBP)
// Sonuc history/daily.json'a birlestirilir; var olan dolu degerlere dokunulmaz.

const fs = require('fs');
const path = require('path');

const ROOT = process.env.FEED_ROOT || process.cwd();
const P = (f) => path.join(ROOT, f);
const YEARS = Math.min(Math.max(Number(process.env.YEARS) || 5, 1), 10);
const KEY = process.env.METALS_API_KEY;
const MAX_REQUESTS = 140; // kota korumasi

const FIELDS = ['date', 'gold', 'silver', 'platinum', 'palladium', 'TRY', 'EUR', 'INR', 'GBP', 'trAltin'];
const DAY = 86400000;
const iso = (d) => d.toISOString().slice(0, 10);
const round = (x) => (x == null ? null : Number(Number(x).toPrecision(9)));
const inv = (x) => (x > 0 ? 1 / x : null);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getJson(url, label) {
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`${label}: HTTP ${res.status}`);
  const j = await res.json();
  if (j.status === 'failure') throw new Error(`${label}: ${j.error_code} ${j.error_message}`);
  return j;
}

async function fetchFrankfurter(start, end) {
  const q = `${start}..${end}?base=USD&symbols=TRY,EUR,INR,GBP`;
  const urls = [`https://api.frankfurter.dev/v1/${q}`, `https://api.frankfurter.app/${q.replace('base=', 'from=').replace('symbols=', 'to=')}`];
  let lastErr;
  for (const u of urls) {
    try { return (await getJson(u, 'frankfurter')).rates || {}; } catch (e) { lastErr = e; }
  }
  throw lastErr;
}

// Saf birlestirme — test edilebilir
function mergeDaily(existing, metalsByDate, fxByDate) {
  const daily = existing || { fields: FIELDS, rows: [] };
  const byDate = new Map(daily.rows.map((r) => [r[0], r.slice()]));
  const dates = Array.from(new Set([...Object.keys(metalsByDate), ...byDate.keys()])).sort();

  let lastFx = {};
  const fxDates = Object.keys(fxByDate).sort();
  let fi = 0;
  for (const date of dates) {
    while (fi < fxDates.length && fxDates[fi] <= date) { lastFx = { ...lastFx, ...fxByDate[fxDates[fi]] }; fi++; }
    const mt = metalsByDate[date] || {};
    const fresh = [
      date,
      round(mt.gold), round(mt.silver), round(mt.platinum), round(mt.palladium),
      round(lastFx.TRY), round(mt.EUR ?? lastFx.EUR), round(mt.INR ?? lastFx.INR), round(mt.GBP ?? lastFx.GBP),
      null
    ];
    const old = byDate.get(date);
    byDate.set(date, old ? old.map((v, j) => (v != null ? v : fresh[j])) : fresh);
  }
  daily.fields = FIELDS;
  daily.rows = Array.from(byDate.values()).sort((x, y) => (x[0] < y[0] ? -1 : 1));
  return daily;
}

async function main() {
  if (!KEY) { console.error('METALS_API_KEY yok'); process.exit(1); }
  const end = new Date(Date.now() - DAY); // dun
  const start = new Date(end.getTime() - YEARS * 365 * DAY);

  const metalsByDate = {};
  let requests = 0;
  for (let s = new Date(start); s <= end; s = new Date(s.getTime() + 30 * DAY)) {
    const e = new Date(Math.min(s.getTime() + 29 * DAY, end.getTime()));
    if (++requests > MAX_REQUESTS) throw new Error('istek siniri asildi');
    const j = await getJson(`https://api.metals.dev/v1/timeseries?api_key=${KEY}&start_date=${iso(s)}&end_date=${iso(e)}`, `metals.dev ${iso(s)}`);
    for (const [date, v] of Object.entries(j.rates || {})) {
      const mt = v.metals || {};
      const cu = v.currencies || {};
      metalsByDate[date] = {
        gold: mt.gold, silver: mt.silver, platinum: mt.platinum, palladium: mt.palladium,
        EUR: inv(cu.EUR), INR: inv(cu.INR), GBP: inv(cu.GBP)
      };
    }
    console.log(`metals.dev ${iso(s)} .. ${iso(e)} tamam`);
    await sleep(400);
  }
  console.log('metals.dev toplam istek:', requests, '| gun:', Object.keys(metalsByDate).length);

  const fxByDate = await fetchFrankfurter(iso(start), iso(end));
  console.log('Frankfurter kur gunu:', Object.keys(fxByDate).length);
  if (Object.keys(fxByDate).length === 0) throw new Error('Frankfurter bos dondu');

  let existing = null;
  try { existing = JSON.parse(fs.readFileSync(P('history/daily.json'), 'utf8')); } catch {}
  const daily = mergeDaily(existing, metalsByDate, fxByDate);
  daily.note = 'Gunluk kapanis. Metaller USD/ons, kurlar 1 USD karsiligi birim, trAltin = Harem has altin gram TL (alis). Gecmis: metals.dev + Frankfurter (ECB).';
  fs.mkdirSync(P('history'), { recursive: true });
  fs.writeFileSync(P('history/daily.json'), JSON.stringify(daily));
  console.log('history/daily.json yazildi, satir:', daily.rows.length, '| ilk:', daily.rows[0]?.[0], '| son:', daily.rows.at(-1)?.[0]);
}

if (require.main === module) {
  main().catch((e) => { console.error('Backfill hatasi:', e.message); process.exit(1); });
}
module.exports = { mergeDaily, FIELDS };
