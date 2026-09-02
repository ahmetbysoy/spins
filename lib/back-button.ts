// Android geri tusu koordinatoru — LIFO yigin.
// Overlay'ler (tam ekran, sembol arama, ayar gorunumu...) kendilerini kapatcak
// handler kaydeder; geri tusu en ustekini kapatir, birden fazla katman varsa
// sahte history girisi yeniden silahlanir. Kapatilinca sahte giris temizlenir.
type BackHandler = () => void;

const handlers: BackHandler[] = [];
let armed = false;
let listenerInstalled = false;

function armHistory() {
  if (typeof window === 'undefined' || armed) return;
  try {
    window.history.pushState({ fsBack: 1 }, '');
    armed = true;
  } catch {
    /* bazi gomulu ortamlarda izin yok — geri tusu yine handler'i tetikler */
  }
}

function disarmHistory() {
  if (typeof window === 'undefined' || !armed) return;
  armed = false;
  try {
    window.history.back(); // sahte girisi tuket
  } catch {}
}

function onPop() {
  const h = handlers.pop();
  if (h) h();
  if (handlers.length > 0) armHistory(); // alt katman hala acik → yeniden silahlan
  else armed = false;
}

export function registerBackHandler(handler: BackHandler): () => void {
  if (typeof window !== 'undefined' && !listenerInstalled) {
    listenerInstalled = true;
    window.addEventListener('popstate', onPop);
  }
  handlers.push(handler);
  armHistory();
  return () => {
    const i = handlers.lastIndexOf(handler);
    if (i >= 0) handlers.splice(i, 1);
    if (handlers.length === 0) disarmHistory();
  };
}

/** Testler icin: popstate olmadan yigin mantigini calistirir */
export function __simulatePopForTests(): void {
  onPop();
}

/** Testler icin yigin temizligi */
export function __resetBackHandlersForTests(): void {
  handlers.length = 0;
  armed = false;
}
