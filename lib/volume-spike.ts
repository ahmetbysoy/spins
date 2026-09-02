// Volume spike vurgusu (dopamin 3): ortalamasinin 3x ustune cikan hacim
// barlari altin renkle boyanir — whale activity tek bakista belli olur.
export const VOL_SPIKE_MULT = 3;
export const VOL_SPIKE_LOOKBACK = 20;
export const VOL_SPIKE_MIN_SAMPLES = 5;
export const VOL_SPIKE_COLOR = 'rgba(251, 191, 36, 0.55)';
const BULL_COLOR = 'rgba(38, 166, 154, 0.4)';
const BEAR_COLOR = 'rgba(239, 83, 80, 0.4)';

/** i. bar, onundeki en fazla 20 barin ortalamasinin 3x'ini asiyor mu? */
export function isVolumeSpike(volumes: number[], i: number): boolean {
  const prev = volumes.slice(Math.max(0, i - VOL_SPIKE_LOOKBACK), i);
  if (prev.length < VOL_SPIKE_MIN_SAMPLES) return false;
  const mean = prev.reduce((a, b) => a + b, 0) / prev.length;
  return mean > 0 && volumes[i] > VOL_SPIKE_MULT * mean;
}

/** Volume bar rengi: spike -> altin, degilse yon rengi */
export function volumeBarColor(volumes: number[], i: number, bullish: boolean): string {
  return isVolumeSpike(volumes, i) ? VOL_SPIKE_COLOR : bullish ? BULL_COLOR : BEAR_COLOR;
}
