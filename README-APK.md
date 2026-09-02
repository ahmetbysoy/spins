# Spins — Android APK

Uygulama, **Capacitor** kabuğudur: `com.ahmetbysoy.spins`, açılışta canlı siteyi
(`https://spins.vercel.app`) tam ekran WebView'da açar. Ayrık native paket yoktur;
her deploy'da site güncellenir, APK yeniden build gerekmez.

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
npm ci && npx cap sync android
cd android && ./gradlew assembleDebug
# çıktı: android/app/build/outputs/apk/debug/app-debug.apk
```

## Çevrimdışı / hata ekranı
Site yüklenemezse (ağ kesintisi vb.) WebView `public/offline.html`'e düşer:
SPINS ekranı + "Tekrar Dene" + 10sn otomatik yeniden deneme.

## Kabuk ayarları
`capacitor.config.json` — hedef URL, appId, uygulama adı. İkon/splash:
`android/app/src/main/res/` (koyu tema, neon mum ikonu).
