import { DecisionEvaluation } from './types';

export const POOL = {
  AL_HIGH: [
    "Kanka yeşil minibüs durağa yanaştı; AL tarafında hem tabela hem akış aynı yere bakıyor.",
    "Boğa Kadıköy vapuru gibi kalkmış; skor yüksek, ama yine de can simidi stopsuz binme.",
    "Reis mahallede alıcılar davulu çalıyor; MA/SAR tamam, raw flow da arkadan itiyor.",
    "Bu AL boş naradan değil; CVD/OBI de omuz vermiş, sokak şimdilik yukarı diyor.",
    "Abi kurgu üçlü çay gibi demli: cross, SAR, flow. Frene basmayı unutma yeter.",
    "Boğa kapıyı tekmelememiş, anahtarla açmış; güven yüksek, plan net olsun.",
    "Alıcı tayfa sahaya inmiş kanka; skor güçlü, trade defterine temiz yazılır.",
    "Sarıyer yokuşu değil, şimdilik asansör modu; AL güvenli görünüyor ama rehavet yok.",
    "Flow arkadan selektör yakıyor: AL yolu açık, makas atma; kontrollü git.",
    "Grafik 'ben yukarı giderim' diye imza atmış; raw flow da şahit olmuş."
  ],
  AL_MID: [
    "AL var kanka ama mahalle tam ikna değil; poz küçük, göz büyük olsun.",
    "Boğa kafayı uzattı, flow fena değil; yine de kapıyı açık bırakma.",
    "Cross/SAR tamam, raw flow orta şeker; kahveyi iç ama falına fazla güvenme.",
    "Yukarı niyet var reis; skor orta, stop cebinde dursun.",
    "Alıcılar masada ama hesabı henüz ödemedi; sinyal var, temkin de var.",
    "Bu AL 'olur gibi' diyor; İstanbul trafiği misali her an sıkışabilir.",
    "Mahalle yukarı bakıyor ama herkes bağırmıyor; dozunda gir, abartma.",
    "Boğa korna çaldı, konvoy küçük; güven orta, planlı git.",
    "AL sinyali pişti ama altı kısık; aceleci olmayan kazanır.",
    "Reis yeşil ışık yandı, ama kavşakta kamyon var; skoru ciddiye al."
  ],
  AL_LOW: [
    "AL çıktı ama flow yan çiziyor kanka; bıçak mı, fırsat mı dikkat et.",
    "Boğa ses verdi fakat sokak kalabalık değil; düşük güven, gaza abanma.",
    "Grafik AL diyor, raw flow 'bir dakika abi' diyor; küçük oyna ya da izle.",
    "Bu yeşil sinyalde sis var; stop yoksa mahalle karışır.",
    "Alıcılar kapıyı çaldı ama içeriden ses az; güven zayıf, şov yapma.",
    "Kanka bu AL çay ocağı dedikodusu gibi: var ama teyit zayıf.",
    "Sinyal var, omuz zayıf; balıklama atlayan ıslanır.",
    "Boğa tek başına gelmiş, ekip yok; düşük skorla kahramanlık yapma.",
    "Yeşil ok geldi ama flow ters bakıyor; kontrollü değilsen pas geç.",
    "AL tabelası asıldı, müşteri az; bu dükkâna küçük sermaye yakışır."
  ],
  SAT_HIGH: [
    "Kanka ayı kepengi indirdi; SAT tarafında hem grafik hem flow aynı ağızdan konuşuyor.",
    "Death cross boş gelmemiş; raw flow da aşağı mahalleye taşınmış.",
    "Satıcılar Eminönü kalabalığı gibi bastı; skor yüksek, plan net olsun.",
    "Ayı kapıda değil, salonda oturuyor reis; SAT güveni sağlam.",
    "Bu SAT tabelası neon gibi yanıyor; CVD/OBI arkadan destek vermiş.",
    "Grafik aşağı imza atmış, flow mührü basmış; stopsuz artistlik yok.",
    "Kırılım devam kokuyor abi; satıcı tayfa direksiyonda.",
    "Ayı yokuştan frensiz iniyor; yüksek güven ama risk kemeri takılı.",
    "SAT kurgusu üçlü pres yaptı; alıcılar şimdilik köşeye sıkışmış.",
    "Piyasa aşağıya adres sormuyor, yolu biliyor; skor güçlü."
  ],
  SAT_MID: [
    "SAT var kanka, ama ayı da temkinli yürüyor; skoru orta oku.",
    "Death cross tamam, flow fena değil; fazla artistlik yapmadan takip.",
    "Aşağı niyet var reis; ama mahallede hâlâ karşı ses duyuluyor.",
    "Satıcılar masaya oturdu, pazarlık bitmedi; orta güven.",
    "Bu SAT 'olabilir' diyor; stopu kapının önüne koy.",
    "Ayı korna çaldı ama konvoy kısa; pozisyonu da kısa tut.",
    "Kırılım var, teyit yarım demli; aceleyle dükkân kapatma.",
    "Aşağı sinyal pişti ama servis sıcak değil; kontrollü git.",
    "Sokak biraz ayı biraz kararsız; skor orta, risk net olsun.",
    "SAT oku geldi, flow orta şeker; kahramanlık değil disiplin zamanı."
  ],
  SAT_LOW: [
    "SAT çıktı ama flow omuz vermiyor kanka; ayı tek başına kalmış olabilir.",
    "Aşağı ok var, teyit zayıf; ters squeeze tokadına dikkat.",
    "Grafik SAT diyor, raw flow 'dur hele' diyor; düşük güven.",
    "Bu kırmızı sinyal biraz sisli; acele eden Bağcılar trafiğine kalır.",
    "Satıcılar bağırdı ama kalabalık değil; skor zayıf, doz küçük.",
    "Death cross geldi diye dükkânı yakma; flow teyidi ince.",
    "Ayı kapıyı tıklattı, içeri girmedi; düşük skorla sakin kal.",
    "SAT tabelası var ama elektrik titriyor; plan yoksa pas geç.",
    "Aşağı niyet zayıf teyitli; ters rüzgârda şemsiye kırılır.",
    "Kanka bu SAT dedikodu gibi: kulağa geliyor ama belge az."
  ],
  IZLEMEDE: [
    "Cross geldi ama SAR daha ikna olmadı — çayını koy, bekliyoruz.",
    "Yarım kurgu abi, yarım. Whipsaw'a gelmeyelim, pencere dolana kadar sabır.",
    "Bir ayak bastı, öbürü havada. Erken atlayan ıslanır.",
    "Sinyal fırında, pişmeden servis yok.",
    "Mahallede söylenti var ama imza yok; izlemede kal.",
    "Kanka daha nikâh kıyılmadı, sadece söz kesildi; SAR flip bekleniyor.",
    "Grafik kapıyı araladı, içeri girmedi; sabırsız trade tokat yer.",
    "Sarı ışık yanıyor reis; gaza değil frene yakın dur.",
    "Kesişim var, teyit yok; sokak dilinde bunun adı beklemedir.",
    "Kurgu mayalanıyor; ham ham yenirse mide bozar."
  ],
  NOTR: [
    "Piyasa esniyor abi, ortada iş yok — kenarda dur.",
    "Ne cross ne flip; boşa kürek çekme, izle.",
    "Sokak sessiz, ortalamalar uykuda. Uyandıran olursa haber veririm.",
    "Şu an trade değil, sabır zamanı reis.",
    "Grafik çay molasında; sinyal çıkmadan gürültü yapma.",
    "Mahalle sakin, dükkânlar kapalı; tetikleyici yok.",
    "Kanka şu an piyasa 'bana bulaşma' modunda.",
    "Ortada net yol yok; İstanbul tabelası gibi her ok başka yere bakıyor.",
    "Nötr alan, en iyi pozisyon bazen pozisyonsuzluktur.",
    "Sinyal yok, yorum çok; parayı dedikoduya yatırmıyoruz."
  ],
  HAM: [
    "Ham mod açık kanka; MA/SAR konuştu, flow mahkemeye çağrılmadı.",
    "Raw flow kapalı, karar çıplak grafikle geldi; stopu iki kere kontrol et.",
    "Bu sinyal sade kahve: telvesi MA/SAR, şekeri yok.",
    "Flow teyidi yok reis; tabela var ama zabıta imzası eksik.",
    "Ham sinyal geldi; mahalle yoklaması yapılmadan yürüyorsun.",
    "MA/SAR tamam, raw flow dışarıda kaldı; temkin modunu aç.",
    "Bu karar çıplak motor kararı; gürültüyü ölçmedik.",
    "Flow kapalıyken güven skoru yok; direksiyonda tamamen sen varsın."
  ]
};

let lastComment = '';

export function generateCommentary(
  status: 'AL' | 'SAT' | 'IZLEMEDE' | 'NOTR',
  raw: DecisionEvaluation | null
): string {
  let key: keyof typeof POOL;
  if (raw && raw.score === null && (status === 'AL' || status === 'SAT')) {
    key = 'HAM';
  } else if (status === 'AL') {
    key = raw && raw.score !== null && raw.score >= 75
      ? 'AL_HIGH'
      : raw && raw.score !== null && raw.score < 45
      ? 'AL_LOW'
      : 'AL_MID';
  } else if (status === 'SAT') {
    key = raw && raw.score !== null && raw.score >= 75
      ? 'SAT_HIGH'
      : raw && raw.score !== null && raw.score < 45
      ? 'SAT_LOW'
      : 'SAT_MID';
  } else if (status === 'IZLEMEDE') {
    key = 'IZLEMEDE';
  } else {
    key = 'NOTR';
  }

  const pool = POOL[key] || POOL.NOTR;
  let pick: string;
  let attempts = 0;
  do {
    pick = pool[Math.floor(Math.random() * pool.length)];
    attempts++;
  } while (pick === lastComment && pool.length > 1 && attempts < 10);

  lastComment = pick;

  if (raw && raw.score !== null) {
    const firstReason = raw.reasons && raw.reasons[0] ? ` ${raw.reasons[0]}` : '';
    return `${pick} Yön: ${status}, güven ${raw.score}/100 (${raw.grade}).${firstReason}`;
  }
  if (raw && raw.score === null) {
    return `${pick} Yön: ${status}, güven: HAM.`;
  }
  return pick;
}
