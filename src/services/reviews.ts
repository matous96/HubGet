/**
 * Hodnocení a recenze.
 *
 * Winget žádná hodnocení nemá, hlasy a recenze proto ukládá Supabase (tabulka
 * ratings, supabase/migrations): 1 přihlášený uživatel = 1 hlas a nejvýš
 * 1 recenze (nadpis a text) na aplikaci, průměr a počet vrací veřejná funkce
 * rating_summaries(), recenze bez user_id funkce app_reviews(). Jméno autora
 * doplní databáze z přihlášení. Recenzi se 3 nahlášeními databáze skryje.
 * UI pracuje jen s rozhraním ReviewsService.
 *
 * Bez nastaveného Supabase zůstává ukázková implementace (deterministická
 * data, vlastní recenze v localStorage) – hodnocení se pak v aplikaci
 * nezobrazuje, aby smyšlená čísla nevypadala jako skutečná (ve vývojovém
 * režimu ho zapne localStorage „unibox-dev-sample-reviews“ = „1“).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { hashString } from "@/lib/utils";
import { supabase } from "./supabase";

export interface Review {
  id: string;
  rating: 1 | 2 | 3 | 4 | 5;
  title: string;
  body: string;
  author: string;
  date: string;
  /** Recenze aktuálního uživatele. */
  mine?: boolean;
  /** Aktuální uživatel recenzi nahlásil. */
  reported?: boolean;
}

/** Důvod nahlášení recenze (stejný výčet hlídá databáze). */
export type ReportReason = "spam" | "offensive" | "offtopic" | "other";

export interface RatingSummary {
  average: number;
  count: number;
  /** Počty hodnocení pro 5, 4, 3, 2, 1 hvězdičku (v tomto pořadí). */
  histogram: [number, number, number, number, number];
}

export interface ReviewDraft {
  rating: Review["rating"];
  title: string;
  body: string;
}

export interface ReviewsService {
  /** true = data jsou ukázková (UI to viditelně označí). */
  readonly isSample: boolean;
  /** Umí služba i textové recenze (nadpis, text)? Supabase ano (migrace reviews), ukázková také. */
  readonly supportsText: boolean;
  getSummary(packageId: string, popularity: number): Promise<RatingSummary>;
  /** Souhrny všech hodnocených aplikací najednou (karty v mřížce). */
  getAllSummaries(): Promise<Map<string, RatingSummary>>;
  /** Nejužitečnější recenze (vlastní recenze uživatele vždy první). */
  getReviews(packageId: string): Promise<Review[]>;
  /** Vlastní hodnocení uživatele, pokud existuje. */
  getMine(packageId: string): Promise<ReviewDraft | null>;
  /** Uloží hodnocení / recenzi uživatele (přepíše předchozí; prázdný nadpis = bez recenze). */
  submit(packageId: string, draft: ReviewDraft): Promise<void>;
  /** Nahlásí cizí recenzi (opakované nahlášení nic nezmění). */
  report(reviewId: string, reason: ReportReason): Promise<void>;
}

// ── Ukázková implementace ────────────────────────────────────────────────

const STORAGE_KEY = "unibox-my-reviews";
const REPORTED_KEY = "unibox-sample-reported-reviews";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function loadReported(): string[] {
  try {
    return JSON.parse(localStorage.getItem(REPORTED_KEY) ?? "[]");
  } catch {
    return [];
  }
}

type StoredReview = ReviewDraft & { date: string };

function loadMine(): Record<string, StoredReview> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
  } catch {
    return {};
  }
}

function seeded(seed: number) {
  let s = seed % 2147483647 || 1;
  return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
}

const SAMPLE_REVIEWS: Omit<Review, "id" | "author" | "date">[] = [
  { rating: 5, title: "Nepostradatelná aplikace", body: "Používám denně a nemám si na co stěžovat. Instalace přes winget proběhla bez problémů a aktualizace chodí pravidelně. Rozhraní je přehledné a rychlé, za mě jednoznačně nejlepší ve své kategorii." },
  { rating: 5, title: "Rychlé a spolehlivé", body: "Po přechodu z konkurence jsem příjemně překvapen rychlostí. Vše funguje, jak má, a ani po měsících používání jsem nenarazil na pád." },
  { rating: 4, title: "Skvělé, jen pár drobností", body: "Celkově jsem velmi spokojený. Občas mi chybí možnost podrobnějšího nastavení a některé volby jsou schované hluboko v menu, ale na běžné použití naprosto dostačuje." },
  { rating: 5, title: "Konečně bez starostí", body: "Dřív jsem řešil ruční stahování instalátorů, teď stačí jedno kliknutí. Aplikace samotná je stabilní, dobře vypadá a nežere zbytečně prostředky." },
  { rating: 3, title: "Dobré, ale náročné na paměť", body: "Funkce jsou výborné, jen při delším běhu spotřebovává víc paměti, než bych čekal. Na starším notebooku je to znát. Doufám, že to další verze zlepší." },
  { rating: 4, title: "Doporučuji", body: "Používám v práci i doma. Synchronizace mezi zařízeními funguje spolehlivě a podpora reaguje rychle. Jednu hvězdičku dolů za občasné pomalejší spuštění." },
  { rating: 2, title: "Poslední aktualizace nic moc", body: "Po poslední aktualizaci se mi občas zasekává při spuštění a musím ji ukončit přes Správce úloh. Předchozí verze fungovala bez problémů." },
  { rating: 5, title: "Přesně to, co jsem hledal", body: "Jednoduché, rychlé a zdarma. Nastavení zabralo pár minut a od té doby jsem nemusel nic řešit. Palec nahoru i za tmavý režim." },
  { rating: 4, title: "Velmi povedené", body: "Přehledné rozhraní a spousta užitečných funkcí. Čeština by mohla být místy lepší, ale je to detail, který neovlivňuje používání." },
  { rating: 1, title: "Nefunguje mi", body: "Po instalaci se aplikace nespustí, jen krátce problikne okno. Zkoušel jsem přeinstalovat i restartovat počítač, bez úspěchu." },
];

const AUTHORS = ["petr_n", "jana.k", "TomasDev", "lucie88", "mkovar", "hrac_cz", "ondra", "veronika_s", "Radek.P", "kuba2000", "eliska", "filip_m"];

export const mockReviewsService: ReviewsService = {
  isSample: true,
  supportsText: true,

  // Karty ukázková čísla nezobrazují
  async getAllSummaries() {
    return new Map();
  },

  async getSummary(packageId, popularity) {
    await sleep(200);
    const rand = seeded(hashString(packageId) + 11);
    // Rozložení hodnocení: populárnější aplikace mají víc pětihvězdiček.
    const five = 0.45 + (popularity / 100) * 0.3 + rand() * 0.1;
    const four = (1 - five) * (0.5 + rand() * 0.2);
    const three = (1 - five - four) * 0.5;
    const two = (1 - five - four - three) * 0.4;
    const one = 1 - five - four - three - two;
    const count = Math.round(popularity * popularity * 3 + rand() * 900 + 20);
    const histogram = [five, four, three, two, one].map((share) => Math.round(share * count)) as RatingSummary["histogram"];

    // Započítat i vlastní hodnocení uživatele
    const mine = loadMine()[packageId];
    if (mine) histogram[5 - mine.rating]++;

    const total = histogram.reduce((a, b) => a + b, 0);
    const average = histogram.reduce((sum, n, i) => sum + n * (5 - i), 0) / total;
    return { average, count: total, histogram };
  },

  async getReviews(packageId) {
    await sleep(250);
    const rand = seeded(hashString(packageId) + 3);
    const now = Date.now();
    const pool = [...SAMPLE_REVIEWS].sort(() => rand() - 0.5).slice(0, 6 + Math.floor(rand() * 3));
    const reported = loadReported();
    const reviews: Review[] = pool.map((r, i) => ({
      ...r,
      id: `${packageId}-${i}`,
      author: AUTHORS[Math.floor(rand() * AUTHORS.length)],
      date: new Date(now - Math.floor(rand() * 900) * 86_400_000).toISOString(),
      reported: reported.includes(`${packageId}-${i}`),
    }));

    const mine = loadMine()[packageId];
    if (mine && (mine.title || mine.body)) {
      reviews.unshift({ ...mine, id: `${packageId}-mine`, author: "", mine: true });
    }
    return reviews;
  },

  async getMine(packageId) {
    const mine = loadMine()[packageId];
    return mine ? { rating: mine.rating, title: mine.title, body: mine.body } : null;
  },

  async submit(packageId, draft) {
    await sleep(300);
    const all = loadMine();
    all[packageId] = { ...draft, date: new Date().toISOString() };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  },

  async report(reviewId) {
    await sleep(200);
    localStorage.setItem(REPORTED_KEY, JSON.stringify([...new Set([...loadReported(), reviewId])]));
  },
};

// ── Supabase ─────────────────────────────────────────────────────────────

/** Řádek z funkce rating_summaries() (numeric přijde jako číslo nebo text). */
interface SummaryRow {
  app_id: string;
  average: number | string;
  count: number;
  stars1: number;
  stars2: number;
  stars3: number;
  stars4: number;
  stars5: number;
}

const toSummary = (row: SummaryRow): RatingSummary => ({
  average: Number(row.average),
  count: row.count,
  histogram: [row.stars5, row.stars4, row.stars3, row.stars2, row.stars1],
});

const NO_RATINGS: RatingSummary = { average: 0, count: 0, histogram: [0, 0, 0, 0, 0] };

/** Řádek z funkce app_reviews() – bez user_id, jméno autora doplnila databáze. */
interface ReviewRow {
  id: string;
  rating: Review["rating"];
  title: string;
  body: string | null;
  author: string;
  updated_at: string;
  mine: boolean;
  reported: boolean;
}

/** Kolik recenzí načíst (vlastní je vždy první). */
const REVIEWS_LIMIT = 30;

/** Chyba Postgresu „unikátní klíč už existuje“ – recenzi už uživatel nahlásil. */
const UNIQUE_VIOLATION = "23505";

export function supabaseReviewsService(client: SupabaseClient): ReviewsService {
  /** Id přihlášeného uživatele (hlasovat a číst vlastní hlas může jen on – RLS). */
  const userId = async () => (await client.auth.getSession()).data.session?.user.id ?? null;

  return {
    isSample: false,
    supportsText: true,

    async getAllSummaries() {
      const { data, error } = await client.rpc("rating_summaries");
      if (error) throw error;
      return new Map((data as SummaryRow[]).map((row) => [row.app_id, toSummary(row)]));
    },

    async getSummary(packageId) {
      const { data, error } = await client.rpc("rating_summaries", { p_app_id: packageId });
      if (error) throw error;
      const row = (data as SummaryRow[])[0];
      return row ? toSummary(row) : NO_RATINGS;
    },

    async getReviews(packageId) {
      const { data, error } = await client.rpc("app_reviews", { p_app_id: packageId, p_limit: REVIEWS_LIMIT });
      if (error) throw error;
      return (data as ReviewRow[]).map((row) => ({
        id: row.id,
        rating: row.rating,
        title: row.title,
        body: row.body ?? "",
        author: row.author,
        date: row.updated_at,
        mine: row.mine,
        reported: row.reported,
      }));
    },

    async getMine(packageId) {
      const user = await userId();
      if (!user) return null;
      const { data, error } = await client
        .from("ratings")
        .select("rating, title, body")
        .eq("app_id", packageId)
        .eq("user_id", user)
        .maybeSingle<{ rating: Review["rating"]; title: string | null; body: string | null }>();
      if (error) throw error;
      return data ? { rating: data.rating, title: data.title ?? "", body: data.body ?? "" } : null;
    },

    async submit(packageId, draft) {
      const user = await userId();
      if (!user) throw new Error("Hodnotit může jen přihlášený uživatel");
      // 1 uživatel = 1 hlas a 1 recenze: nové hodnocení stejné aplikace přepíše předchozí,
      // prázdný nadpis recenzi smaže (hvězdičky zůstanou)
      const title = draft.title.trim() || null;
      const { error } = await client
        .from("ratings")
        .upsert(
          { app_id: packageId, user_id: user, rating: draft.rating, title, body: title ? draft.body.trim() || null : null },
          { onConflict: "app_id,user_id" },
        );
      if (error) throw error;
    },

    async report(reviewId, reason) {
      const { error } = await client.from("review_reports").insert({ review_id: reviewId, reason });
      // Už nahlášeno – stejný výsledek
      if (error && error.code !== UNIQUE_VIOLATION) throw error;
    },
  };
}

/** Vybraná implementace: Supabase, je-li nastavený, jinak ukázková. */
export const reviews: ReviewsService = supabase ? supabaseReviewsService(supabase) : mockReviewsService;
