// Dokunmatik titreşim (haptik) — Android WebView/Chrome'da navigator.vibrate.
// iOS Safari desteklemez: sessiz no-op. Ayar: settings.haptics (varsayılan açık).
export type BuzzPattern = number | number[];

export function hapticsSupported(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
}

/** Kısa dokunma geri bildirimi. Ayar kontağı çağıran taraftadır (settingsRef). */
export function buzz(pattern: BuzzPattern = 15): void {
  try {
    if (hapticsSupported()) navigator.vibrate(pattern);
  } catch {
    /* izin/ortam hataları sessizce yutulur */
  }
}

/** Sinyal titreşimi: AL/SAT — kısa çift vuruş (PREDATOR davranışı) */
export const SIGNAL_BUZZ: BuzzPattern = [30, 40, 30];
/** Whale/uyarı titreşimi: tek kısa vuruş */
export const ALERT_BUZZ: BuzzPattern = 20;
