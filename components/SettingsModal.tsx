'use client';

import React from 'react';
import { Sliders, RotateCcw, ShieldAlert, Activity, BarChart2 } from 'lucide-react';
import { AppSettings } from '@/lib/types';

interface SettingsModalProps {
  settings: AppSettings;
  onUpdateSettings: (newSettings: AppSettings) => void;
  onResetDefaults: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  settings,
  onUpdateSettings,
  onResetDefaults
}) => {
  const update = (key: keyof AppSettings, value: any) => {
    onUpdateSettings({
      ...settings,
      [key]: value
    });
  };

  return (
    <div className="flex-1 flex flex-col min-h-0 bg-[#0d1117] p-3 sm:p-4 overflow-y-auto select-none">
      <div className="max-w-4xl mx-auto w-full flex flex-col gap-4">
        {/* Header */}
        <div className="bg-[#12161c] border border-[#22272e] rounded-xl p-3 sm:p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Sliders className="w-5 h-5 text-emerald-400 shrink-0" />
            <div>
              <h2 className="text-xs sm:text-sm font-bold text-slate-100">SİSTEM VE MOTOR AYARLARI</h2>
              <span className="text-[10px] sm:text-[11px] text-slate-500 font-mono">
                Katman 1 (MA/SAR) + Katman 2 (Order Flow) Parametreleri
              </span>
            </div>
          </div>

          <button
            onClick={onResetDefaults}
            className="w-full sm:w-auto flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold bg-[#181d24] text-slate-300 hover:text-white border border-[#2a3038] hover:border-slate-500 transition-all touch-manipulation min-h-[38px] active:scale-95"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Varsayılana Dön</span>
          </button>
        </div>

        {/* 1. Sinyal Çekirdek Motoru (Katman 1) */}
        <div className="bg-[#12161c] border border-[#22272e] rounded-xl p-4 flex flex-col gap-3">
          <div className="flex items-center gap-2 border-b border-[#1f252e] pb-2 text-xs font-bold text-slate-200">
            <Activity className="w-4 h-4 text-emerald-400" />
            <span>SİNYAL ÇEKİRDEK MOTORU (KATMAN 1)</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-xs">
            <div className="bg-[#161b22] border border-[#22272e] rounded-lg p-3 flex items-center justify-between">
              <label className="text-slate-300 font-medium">Hızlı MA (MA 1):</label>
              <input
                type="number"
                min={2}
                max={50}
                value={settings.ma1}
                onChange={(e) => update('ma1', parseInt(e.target.value, 10) || 9)}
                className="w-16 bg-[#11151b] border border-[#2e3640] rounded px-2 py-1 text-center font-mono text-slate-100"
              />
            </div>

            <div className="bg-[#161b22] border border-[#22272e] rounded-lg p-3 flex items-center justify-between">
              <label className="text-slate-300 font-medium">Orta MA (MA 2):</label>
              <input
                type="number"
                min={3}
                max={100}
                value={settings.ma2}
                onChange={(e) => update('ma2', parseInt(e.target.value, 10) || 21)}
                className="w-16 bg-[#11151b] border border-[#2e3640] rounded px-2 py-1 text-center font-mono text-slate-100"
              />
            </div>

            <div className="bg-[#161b22] border border-[#22272e] rounded-lg p-3 flex items-center justify-between">
              <label className="text-slate-300 font-medium">Yavaş MA (MA 3 Trend):</label>
              <input
                type="number"
                min={5}
                max={200}
                value={settings.ma3}
                onChange={(e) => update('ma3', parseInt(e.target.value, 10) || 50)}
                className="w-16 bg-[#11151b] border border-[#2e3640] rounded px-2 py-1 text-center font-mono text-slate-100"
              />
            </div>

            <div className="bg-[#161b22] border border-[#22272e] rounded-lg p-3 flex items-center justify-between">
              <label className="text-slate-300 font-medium">SAR Adım (Step):</label>
              <input
                type="number"
                step="0.01"
                min={0.01}
                max={0.1}
                value={settings.sarStep}
                onChange={(e) => update('sarStep', parseFloat(e.target.value) || 0.02)}
                className="w-16 bg-[#11151b] border border-[#2e3640] rounded px-2 py-1 text-center font-mono text-slate-100"
              />
            </div>

            <div className="bg-[#161b22] border border-[#22272e] rounded-lg p-3 flex items-center justify-between">
              <label className="text-slate-300 font-medium">SAR Tavan (Max):</label>
              <input
                type="number"
                step="0.05"
                min={0.05}
                max={0.5}
                value={settings.sarMax}
                onChange={(e) => update('sarMax', parseFloat(e.target.value) || 0.2)}
                className="w-16 bg-[#11151b] border border-[#2e3640] rounded px-2 py-1 text-center font-mono text-slate-100"
              />
            </div>

            <div className="bg-[#161b22] border border-[#22272e] rounded-lg p-3 flex items-center justify-between">
              <label className="text-slate-300 font-medium">Kurgu Penceresi (N Mum):</label>
              <input
                type="number"
                min={1}
                max={10}
                value={settings.nWindow}
                onChange={(e) => update('nWindow', parseInt(e.target.value, 10) || 3)}
                className="w-16 bg-[#11151b] border border-[#2e3640] rounded px-2 py-1 text-center font-mono text-slate-100"
              />
            </div>
          </div>
        </div>

        {/* 2. Katman 2: Raw Flow Confirm / Veto */}
        <div className="bg-[#12161c] border border-[#22272e] rounded-xl p-4 flex flex-col gap-3">
          <div className="flex items-center gap-2 border-b border-[#1f252e] pb-2 text-xs font-bold text-slate-200">
            <ShieldAlert className="w-4 h-4 text-cyan-400" />
            <span>KATMAN 2 — ORDER FLOW VE LİKİDİTE GÜVEN FİLTRELERİ</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-xs">
            <div className="bg-[#161b22] border border-[#22272e] rounded-lg p-3 flex items-center justify-between">
              <label className="text-slate-300 font-medium">Raw Flow Skorlama:</label>
              <input
                type="checkbox"
                checked={settings.rawConfirm}
                onChange={(e) => update('rawConfirm', e.target.checked)}
                className="w-4 h-4 rounded text-emerald-500"
              />
            </div>

            <div className="bg-[#161b22] border border-[#22272e] rounded-lg p-3 flex items-center justify-between">
              <label className="text-slate-300 font-medium">DOM Ladder (Sağ Şerit):</label>
              <input
                type="checkbox"
                checked={settings.showLadder}
                onChange={(e) => update('showLadder', e.target.checked)}
                className="w-4 h-4 rounded text-emerald-500"
              />
            </div>

            <div className="bg-[#161b22] border border-[#22272e] rounded-lg p-3 flex items-center justify-between">
              <label className="text-slate-300 font-medium">Likidite Isı Haritası (Heatmap):</label>
              <input
                type="checkbox"
                checked={settings.showHeatmap}
                onChange={(e) => update('showHeatmap', e.target.checked)}
                className="w-4 h-4 rounded text-emerald-500"
              />
            </div>

            <div className="bg-[#161b22] border border-[#22272e] rounded-lg p-3 flex items-center justify-between">
              <label className="text-slate-300 font-medium">Min. Likidasyon (USDT):</label>
              <input
                type="number"
                step={10000}
                min={0}
                value={settings.liqMin}
                onChange={(e) => update('liqMin', parseInt(e.target.value, 10) || 50000)}
                className="w-24 bg-[#11151b] border border-[#2e3640] rounded px-2 py-1 text-center font-mono text-slate-100"
              />
            </div>

            <div className="bg-[#161b22] border border-[#22272e] rounded-lg p-3 flex items-center justify-between">
              <label className="text-slate-300 font-medium">Whale İşlem Eşiği (USDT):</label>
              <input
                type="number"
                step={50000}
                min={50000}
                value={settings.whaleMin}
                onChange={(e) => update('whaleMin', parseInt(e.target.value, 10) || 300000)}
                className="w-24 bg-[#11151b] border border-[#2e3640] rounded px-2 py-1 text-center font-mono text-slate-100"
              />
            </div>

            <div className="bg-[#161b22] border border-[#22272e] rounded-lg p-3 flex items-center justify-between">
              <label className="text-slate-300 font-medium">Duvar Yüzdelik Eşiği (P):</label>
              <input
                type="number"
                min={80}
                max={99}
                value={settings.wallPct}
                onChange={(e) => update('wallPct', parseInt(e.target.value, 10) || 90)}
                className="w-16 bg-[#11151b] border border-[#2e3640] rounded px-2 py-1 text-center font-mono text-slate-100"
              />
            </div>
          </div>
        </div>

        {/* 3. İndikatör Görünürlükleri ve Görünüm */}
        <div className="bg-[#12161c] border border-[#22272e] rounded-xl p-4 flex flex-col gap-3">
          <div className="flex items-center gap-2 border-b border-[#1f252e] pb-2 text-xs font-bold text-slate-200">
            <BarChart2 className="w-4 h-4 text-purple-400" />
            <span>GRAFİK VE İNDİKATÖR AYARLARI</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-xs">
            <label className="bg-[#161b22] border border-[#22272e] rounded-lg p-3 flex items-center justify-between cursor-pointer">
              <span className="text-slate-300 font-medium">MA Çizgileri</span>
              <input
                type="checkbox"
                checked={settings.showMa}
                onChange={(e) => update('showMa', e.target.checked)}
                className="w-4 h-4 rounded text-emerald-500"
              />
            </label>
            <div className="bg-[#161b22] border border-[#22272e] rounded-lg p-3 flex items-center justify-between">
              <label className="text-slate-300 font-medium">MA1:</label>
              <input type="color" value={settings.ma1Color} onChange={(e) => update('ma1Color', e.target.value)} className="w-8 h-8 rounded cursor-pointer" />
              <input type="number" min={1} max={4} value={settings.ma1Width} onChange={(e) => update('ma1Width', parseInt(e.target.value, 10))} className="w-12 bg-[#11151b] border border-[#2e3640] rounded px-1 text-center" />
            </div>
            <div className="bg-[#161b22] border border-[#22272e] rounded-lg p-3 flex items-center justify-between">
              <label className="text-slate-300 font-medium">MA2:</label>
              <input type="color" value={settings.ma2Color} onChange={(e) => update('ma2Color', e.target.value)} className="w-8 h-8 rounded cursor-pointer" />
              <input type="number" min={1} max={4} value={settings.ma2Width} onChange={(e) => update('ma2Width', parseInt(e.target.value, 10))} className="w-12 bg-[#11151b] border border-[#2e3640] rounded px-1 text-center" />
            </div>
            <div className="bg-[#161b22] border border-[#22272e] rounded-lg p-3 flex items-center justify-between">
              <label className="text-slate-300 font-medium">MA3:</label>
              <input type="color" value={settings.ma3Color} onChange={(e) => update('ma3Color', e.target.value)} className="w-8 h-8 rounded cursor-pointer" />
              <input type="number" min={1} max={4} value={settings.ma3Width} onChange={(e) => update('ma3Width', parseInt(e.target.value, 10))} className="w-12 bg-[#11151b] border border-[#2e3640] rounded px-1 text-center" />
            </div>
            <div className="bg-[#161b22] border border-[#22272e] rounded-lg p-3 flex items-center justify-between">
              <label className="text-slate-300 font-medium">SAR:</label>
              <input type="color" value={settings.sarColor} onChange={(e) => update('sarColor', e.target.value)} className="w-8 h-8 rounded cursor-pointer" />
              <input type="number" min={1} max={4} value={settings.sarWidth} onChange={(e) => update('sarWidth', parseInt(e.target.value, 10))} className="w-12 bg-[#11151b] border border-[#2e3640] rounded px-1 text-center" />
            </div>
            <div className="bg-[#161b22] border border-[#22272e] rounded-lg p-3 flex items-center justify-between">
              <label className="text-slate-300 font-medium">BB:</label>
              <input type="color" value={settings.bbColor} onChange={(e) => update('bbColor', e.target.value)} className="w-8 h-8 rounded cursor-pointer" />
              <input type="number" min={1} max={4} value={settings.bbWidth} onChange={(e) => update('bbWidth', parseInt(e.target.value, 10))} className="w-12 bg-[#11151b] border border-[#2e3640] rounded px-1 text-center" />
            </div>
            <div className="bg-[#161b22] border border-[#22272e] rounded-lg p-3 flex items-center justify-between">
              <label className="text-slate-300 font-medium">VWAP:</label>
              <input type="color" value={settings.vwapColor} onChange={(e) => update('vwapColor', e.target.value)} className="w-8 h-8 rounded cursor-pointer" />
              <input type="number" min={1} max={4} value={settings.vwapWidth} onChange={(e) => update('vwapWidth', parseInt(e.target.value, 10))} className="w-12 bg-[#11151b] border border-[#2e3640] rounded px-1 text-center" />
            </div>
            <div className="bg-[#161b22] border border-[#22272e] rounded-lg p-3 flex items-center justify-between">
              <label className="text-slate-300 font-medium">RSI:</label>
              <input type="color" value={settings.rsiColor} onChange={(e) => update('rsiColor', e.target.value)} className="w-8 h-8 rounded cursor-pointer" />
              <input type="number" min={1} max={4} value={settings.rsiWidth} onChange={(e) => update('rsiWidth', parseInt(e.target.value, 10))} className="w-12 bg-[#11151b] border border-[#2e3640] rounded px-1 text-center" />
            </div>
            <div className="bg-[#161b22] border border-[#22272e] rounded-lg p-3 flex items-center justify-between">
              <label className="text-slate-300 font-medium">MACD:</label>
              <input type="color" value={settings.macdColor} onChange={(e) => update('macdColor', e.target.value)} className="w-8 h-8 rounded cursor-pointer" />
              <input type="number" min={1} max={4} value={settings.macdWidth} onChange={(e) => update('macdWidth', parseInt(e.target.value, 10))} className="w-12 bg-[#11151b] border border-[#2e3640] rounded px-1 text-center" />
            </div>
            <div className="bg-[#161b22] border border-[#22272e] rounded-lg p-3 flex items-center justify-between">
              <label className="text-slate-300 font-medium">MACD Sig:</label>
              <input type="color" value={settings.macdSignalColor} onChange={(e) => update('macdSignalColor', e.target.value)} className="w-8 h-8 rounded cursor-pointer" />
              <input type="number" min={1} max={4} value={settings.macdSignalWidth} onChange={(e) => update('macdSignalWidth', parseInt(e.target.value, 10))} className="w-12 bg-[#11151b] border border-[#2e3640] rounded px-1 text-center" />
            </div>

            <label className="bg-[#161b22] border border-[#22272e] rounded-lg p-3 flex items-center justify-between cursor-pointer">
              <span className="text-slate-300 font-medium">SAR Noktaları</span>
              <input
                type="checkbox"
                checked={settings.showSar}
                onChange={(e) => update('showSar', e.target.checked)}
                className="w-4 h-4 rounded text-emerald-500"
              />
            </label>

            <label className="bg-[#161b22] border border-[#22272e] rounded-lg p-3 flex items-center justify-between cursor-pointer">
              <span className="text-slate-300 font-medium">Hacim Paneli</span>
              <input
                type="checkbox"
                checked={settings.showVol}
                onChange={(e) => update('showVol', e.target.checked)}
                className="w-4 h-4 rounded text-emerald-500"
              />
            </label>

            <label className="bg-[#161b22] border border-[#22272e] rounded-lg p-3 flex items-center justify-between cursor-pointer">
              <span className="text-slate-300 font-medium">Bollinger Bantları</span>
              <input
                type="checkbox"
                checked={settings.showBB}
                onChange={(e) => update('showBB', e.target.checked)}
                className="w-4 h-4 rounded text-emerald-500"
              />
            </label>

            <label className="bg-[#161b22] border border-[#22272e] rounded-lg p-3 flex items-center justify-between cursor-pointer">
              <span className="text-slate-300 font-medium">VWAP Çizgisi</span>
              <input
                type="checkbox"
                checked={settings.showVwap}
                onChange={(e) => update('showVwap', e.target.checked)}
                className="w-4 h-4 rounded text-emerald-500"
              />
            </label>

            <label className="bg-[#161b22] border border-[#22272e] rounded-lg p-3 flex items-center justify-between cursor-pointer">
              <span className="text-slate-300 font-medium">RSI İndikatörü</span>
              <input
                type="checkbox"
                checked={settings.showRsi}
                onChange={(e) => update('showRsi', e.target.checked)}
                className="w-4 h-4 rounded text-emerald-500"
              />
            </label>

            <label className="bg-[#161b22] border border-[#22272e] rounded-lg p-3 flex items-center justify-between cursor-pointer">
              <span className="text-slate-300 font-medium">MACD Paneli</span>
              <input
                type="checkbox"
                checked={settings.showMacd}
                onChange={(e) => update('showMacd', e.target.checked)}
                className="w-4 h-4 rounded text-emerald-500"
              />
            </label>

            <label className="bg-[#161b22] border border-[#22272e] rounded-lg p-3 flex items-center justify-between cursor-pointer">
              <span className="text-slate-300 font-medium">Likidasyon İşaretleri</span>
              <input
                type="checkbox"
                checked={settings.showLiq}
                onChange={(e) => update('showLiq', e.target.checked)}
                className="w-4 h-4 rounded text-emerald-500"
              />
            </label>
          </div>
        </div>
      </div>
    </div>
  );
};
