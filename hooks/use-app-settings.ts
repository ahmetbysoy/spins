'use client';

// Uygulama ayarları: default nesne + localStorage kalıcılığı.
// Kod, app/page.tsx içinden birebir taşındı (davranış değişikliği yok).
import { useEffect, useRef, useState } from 'react';
import type { AppSettings } from '@/lib/types';

export const DEFAULT_SETTINGS: AppSettings = {
  ma1: 9,
  ma2: 21,
  ma3: 50,
  sarStep: 0.02,
  sarMax: 0.2,
  nWindow: 3,
  showMa: true,
  showSar: true,
  showVol: true,
  rawConfirm: true,
  showFlow: true,
  showLiq: true,
  liqMin: 50000,
  oiPollSec: 15,
  cascadePct: 0.8,
  showLadder: true,
  showHeatmap: true,
  showMfeMae: true,
  whaleAlerts: true,
  haptics: true,
  whaleMin: 300000,
  wallPct: 90,
  showBB: false,
  showRsi: false,
  showMacd: false,
  showVwap: true,
  bbPeriod: 20,
  bbStd: 2,
  rsiPeriod: 14,
  macdFast: 12,
  macdSlow: 26,
  macdSignal: 9,
  patternWinPct: 0.15,
  ma1Color: '#e0b64c',
  ma2Color: '#4c8ce0',
  ma3Color: '#b06ce0',
  ma1Width: 1,
  ma2Width: 1,
  ma3Width: 1,
  sarColor: '#9aa4ae',
  sarWidth: 1,
  bbColor: '#4c8ce0',
  bbWidth: 1,
  vwapColor: '#ff9800',
  vwapWidth: 2,
  rsiColor: '#fdd835',
  rsiWidth: 1,
  macdColor: '#00bcd4',
  macdWidth: 1,
  macdSignalColor: '#ff7043',
  macdSignalWidth: 1,
  scanEnabled: true,
  scanTopN: 10
};

export interface AppSettingsApi {
  settings: AppSettings;
  settingsRef: React.RefObject<AppSettings>;
  updateSettings: (s: AppSettings) => void;
  updateSingleSetting: (key: keyof AppSettings, val: any) => void;
}

export function useAppSettings(): AppSettingsApi {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const settingsRef = useRef<AppSettings>(settings);
  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  // Kayıtlı ayarları mount'ta oku (SSR-safe)
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        const savedSettings = localStorage.getItem('fs_settings');
        if (savedSettings) {
          const parsed = JSON.parse(savedSettings);
          if (parsed && typeof parsed === 'object') {
            setSettings((prev) => ({ ...prev, ...parsed }));
          }
        }
      } catch (e) {
        console.warn('Failed to load localStorage preferences:', e);
      }
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  const updateSettings = (newSettings: AppSettings) => {
    setSettings(newSettings);
    try {
      localStorage.setItem('fs_settings', JSON.stringify(newSettings));
    } catch {}
  };

  const updateSingleSetting = (key: keyof AppSettings, val: any) => {
    setSettings((prev) => {
      const next = { ...prev, [key]: val };
      try {
        localStorage.setItem('fs_settings', JSON.stringify(next));
      } catch {}
      return next;
    });
  };

  return { settings, settingsRef, updateSettings, updateSingleSetting };
}
