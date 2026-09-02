# Spins — Android APK

Uygulama **tamamen gömülüdür**: `next build` statik export'u (`NEXT_STATIC=1` → `out/`)
APK'nın içine paketlenir — Vercel'e bağımlılık yoktur, uçak modunda bile arayüz açılır.
Veri akışı: WebSocket doğrudan Binance'e (WebSocket'e CORS uygulanmaz), REST ise
`lib/rest-race.ts` CORS-proxy havuzundan (gömülü modda `/api/binance` adayı atlanır).
Vercel deployment'u kendi hayatına devam eder; APK'yı güncellemek için yeniden build gerekir.

## Otomatik build (GitHub Actions → `.github/workflows/apk.yml`)
- **Elle**: Actions → **APK** → *Run workflow* → artifact olarak `spins-apk` indirilir.
- **Etiket**: `git tag v1.0.0 && git push --tags` → debug (+ imza sırları varsa release)
  APK'lar otomatik GitHub Release'e eklenir.

## İmzalı release (güncellenebilir kurulumlar için, opsiyonel)
Debug APK her zaman üretilir ve telefona kurulabilir; ama Play dışında bile
**sürüm yükseltme** için sabit imza gerekir. Bir kez:
```bash
keytool -genkey -v -keystore spins.keystore -alias spins -keyalg RSA -keysize 2048 -validity 10000
base64 -w0 spins.keystore
```
Repo → Settings → Secrets → Actions:
| Secret | Değer |
|---|---|
| `RELEASE_KEYSTORE_BASE64` | base64 çıktısı |
| `RELEASE_STORE_PASSWORD` | keystore şifresi |
| `RELEASE_KEY_ALIAS` | `spins` |
| `RELEASE_KEY_PASSWORD` | anahtar şifresi |

Sırlar tanımlıysa workflow `assembleRelease` da koşar; değilse yalnızca debug APK.

## Yerel build
```bash
rm -rf app/api && NEXT_STATIC=1 npx next build && mv app/api app/api 2>/dev/null; git checkout app/api
npx cap sync android
cd android && ./gradlew assembleDebug
# çıktı: android/app/build/outputs/apk/debug/app-debug.apk
```

## Çevrimdışı / hata ekranı
Kabuk yereldir; veri bağlantısı yoksa `public/offline.html` bilgi ekranı gösterilir
("Tekrar Dene" = sayfayı yeniler). Arayüz açılır, akış internet gelince başlar.

## Kabuk ayarları
`capacitor.config.json` — `webDir: out`, appId, uygulama adı. İkon/splash:
`android/app/src/main/res/` (koyu tema, neon mum ikonu).
