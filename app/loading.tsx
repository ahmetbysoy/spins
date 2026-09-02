export default function Loading() {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-[#0d1117] gap-4">
      <div className="flex items-end gap-1.5" aria-hidden>
        <span className="w-2.5 h-6 rounded-sm bg-emerald-400/80 animate-pulse" />
        <span className="w-2.5 h-9 rounded-sm bg-slate-400/70 animate-pulse [animation-delay:150ms]" />
        <span className="w-2.5 h-5 rounded-sm bg-rose-400/80 animate-pulse [animation-delay:300ms]" />
      </div>
      <p className="text-xs text-slate-500 font-mono">Piyasa verisi yükleniyor…</p>
    </div>
  );
}
