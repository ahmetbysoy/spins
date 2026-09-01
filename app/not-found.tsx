import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0B0E14] p-6">
      <div className="bg-[#161B22] border border-[#22272E] rounded-xl p-8 max-w-md w-full text-center flex flex-col gap-4">
        <div className="text-5xl font-black text-[#4c8ce0]">404</div>
        <h2 className="text-lg font-bold text-slate-200">Sayfa bulunamadı</h2>
        <p className="text-sm text-slate-400">
          Aradığın sayfa taşınmış ya da hiç var olmamış olabilir. Terminale dönüp devam edebilirsin.
        </p>
        <Link
          href="/"
          className="mt-2 inline-block bg-[#4c8ce0] hover:bg-[#3d7ac9] text-white text-sm font-semibold rounded-lg px-4 py-2 transition-colors"
        >
          ← Terminale Dön
        </Link>
      </div>
    </div>
  );
}
