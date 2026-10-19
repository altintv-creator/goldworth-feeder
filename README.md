# goldworth-feeder

GoldWorth uygulamasinin fiyat kaynagi. `GoldWorth Feeder` is akisi ~30 dakikada bir (cron-job.org tetikler) calisir.

## Dosyalar

| Dosya | Icerik |
|---|---|
| `prices.json` | Anlik fiyatlar. `global` = metals.dev (USD/ons + 170+ kur), `tr` = altinapi (Harem, alis/satis) |
| `history/daily.json` | Gunluk kapanislar: altin, gumus, platin, paladyum (USD/ons), TRY/EUR/INR/GBP (1 USD karsiligi), trAltin (Harem has gram TL) |
| `history/intraday.json` | Son 8 gun, ~30 dk aralikla ayni degerler |
| `history/state.json` | Ic durum (gun acilisi, en yuksek/en dusuk, dunku kapanis) |

## prices.json'daki yeni alanlar

- `tr.symbols[].prevClose / dayChange / dayChangePct / dayOpen / dayHigh / dayLow` — **dunku kapanisa gore** gunluk degisim (gun sinirlari Istanbul saati).
  Eski `change / changePct` alanlari geri uyumluluk icin duruyor (son 30 dk'ya gore).
- `global.day.{gold,silver,platinum,palladium}` — ayni bilgiler, USD/ons.
- `global.platinumPerOz`, `global.palladiumPerOz`
- `global.lbma` — LBMA altin AM/PM, gumus, platin/paladyum AM/PM (USD/ons)
- `global.india` — IBJA ve MCX altin/gumus (USD/ons)
- `global.unitsPerUsd` — TRY, EUR, INR, AED, SAR, GBP, CHF. Diger tum kurlar: `global.allCurrencies` (1 birim = x USD; 1 USD = 1/x birim)

## Gecmis doldurma (tek seferlik)

Actions > **GoldWorth Gecmis Fiyat Doldurma** > Run workflow. Varsayilan 5 yil, ~61 metals.dev istegi.
Kurlar Frankfurter (Avrupa Merkez Bankasi) uzerinden, ucretsiz. Var olan degerlerin uzerine yazmaz.
