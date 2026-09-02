'use client';

import { useEffect } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

export default function Error({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Terminal hatası:', error);
  }, [error]);

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0d1117] p-6">
      <div className="bg-[#161B22] border border-[#22272E] rounded-xl p-8 max-w-md w-full text-center flex flex-col gap-4">
        <div className="mx-auto w-12 h-12 rounded-full bg-rose-500/15 border border-rose-500/30 flex items-center justify-center">
          <AlertTriangle className="w-6 h-6 text-rose-400" />
        </div>
        <h2 className="text-lg font-bold text-slate-200">Bir aksilik oldu</h2>
        <p className="text-sm text-slate-400">
          Terminal beklenmedik bir hatayla karşılaştı. Veri akışı otomatik toparlanır;
          sayfayı yeniden denemek genellikle yeterli.
        </p>
        {error.digest && (
          <p className="text-[10px] text-slate-600 font-mono">Hata kodu: {error.digest}</p>
        )}
        <button
          onClick={reset}
          className="mt-1 inline-flex items-center justify-center gap-2 bg-[#4c8ce0] hover:bg-[#3d7ac9] text-white text-sm font-semibold rounded-lg px-4 py-2.5 transition-colors mx-auto"
        >
          <RotateCcw className="w-4 h-4" />
          Yeniden Dene
        </button>
      </div>
    </div>
  );
}
