/**
 * Polymarket Gamma API client (public, no auth, no key).
 * https://gamma-api.polymarket.com
 *
 * Strategy:
 *  1. Primary: /events?tag_slug=crypto — real crypto-tagged events, each
 *     carrying its markets. Flattened + sorted by 24h volume.
 *  2. Fallback: /markets top-by-volume + client-side crypto keyword filter
 *     (the /markets endpoint ignores tag_slug, verified 27 Nov 2026).
 *  3. If Gamma is fully down, the caller shows an error screen with retry.
 *     No mock data is ever rendered — a failed fetch is shown as a failure.
 */

export interface Market {
  id: string
  question: string
  outcomes: string[] // e.g. ["Yes","No"] or ["Up","Down"]
  prices: number[] // 0..1, aligned with outcomes
  volume24h: number
  volume: number
  liquidity: number
  endDate: string | null
  slug: string
}

const GAMMA = 'https://gamma-api.polymarket.com'
const CRYPTO_WORDS =
  /(bitcoin|\bbtc\b|ethereum|\beth\b|solana|\bsol\b|crypto|xrp|dogecoin|\bdoge\b|stablecoin|usdc|tether|litecoin|cardano|\bada\b|chainlink|\blink\b)/i

interface RawMarket {
  id?: string | number
  question?: string
  outcomes?: string
  outcomePrices?: string
  volume24hr?: string | number
  volume?: string | number
  liquidity?: string | number
  endDate?: string
  slug?: string
}

function num(v: string | number | undefined | null): number {
  const n = typeof v === 'string' ? parseFloat(v) : typeof v === 'number' ? v : NaN
  return Number.isFinite(n) ? n : 0
}

function parseMarket(m: RawMarket): Market | null {
  if (m == null || typeof m !== 'object') return null
  let outcomes: string[] = []
  let prices: number[] = []
  try {
    outcomes = JSON.parse(m.outcomes ?? '[]') as string[]
    prices = (JSON.parse(m.outcomePrices ?? '[]') as string[]).map((p) => num(p))
  } catch {
    return null
  }
  if (!Array.isArray(outcomes) || outcomes.length < 2) return null
  if (!Array.isArray(prices) || prices.length !== outcomes.length) return null
  if (prices.some((p) => !Number.isFinite(p) || p < 0 || p > 1)) return null
  const id = String(m.id ?? '')
  const question = (m.question ?? '').trim()
  if (!id || !question) return null
  return {
    id,
    question,
    outcomes,
    prices,
    volume24h: num(m.volume24hr),
    volume: num(m.volume),
    liquidity: num(m.liquidity),
    endDate: m.endDate ?? null,
    slug: m.slug ?? '',
  }
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error(`Gamma ${res.status} on ${url}`)
  return (await res.json()) as T
}

/** Top crypto markets by 24h volume. Primary path: crypto-tagged events. */
export async function fetchCryptoMarkets(limit = 12): Promise<Market[]> {
  // Path 1: /events?tag_slug=crypto (tag filter works on /events).
  try {
    const events = await getJson<Array<{ markets?: RawMarket[] }>>(
      `${GAMMA}/events?tag_slug=crypto&active=true&closed=false&limit=12&order=volume24hr&ascending=false`,
    )
    const flat: Market[] = []
    for (const ev of events ?? []) {
      for (const raw of ev.markets ?? []) {
        const m = parseMarket(raw)
        if (m) flat.push(m)
      }
    }
    const dedup = dedupeSort(flat, limit)
    if (dedup.length >= 3) return dedup
    // Too few — fall through to the markets fallback instead of showing a thin list.
  } catch (err) {
    console.warn('[poly] events path failed, trying markets fallback', err)
  }

  // Path 2: /markets top-by-volume + keyword filter.
  const all = await getJson<RawMarket[]>(
    `${GAMMA}/markets?active=true&closed=false&limit=60&order=volume24hr&ascending=false`,
  )
  const crypto = (all ?? [])
    .map(parseMarket)
    .filter((m): m is Market => !!m && CRYPTO_WORDS.test(m.question))
  return dedupeSort(crypto, limit)
}

function dedupeSort(list: Market[], limit: number): Market[] {
  const seen = new Set<string>()
  return list
    .filter((m) => (seen.has(m.id) ? false : (seen.add(m.id), true)))
    .sort((a, b) => b.volume24h - a.volume24h)
    .slice(0, limit)
}

/** Refresh one market by id (used on the detail screen). */
export async function fetchMarket(id: string): Promise<Market> {
  const raw = await getJson<RawMarket>(`${GAMMA}/markets/${encodeURIComponent(id)}`)
  const m = parseMarket(raw)
  if (!m) throw new Error(`Market ${id} unparseable`)
  return m
}

// ---------- formatting helpers (ASCII only — G2 firmware font) ----------

export function pct(p: number): number {
  return Math.max(0, Math.min(100, Math.round(p * 100)))
}

export function fmtUsd(v: number): string {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`
  if (v >= 1_000) return `$${(v / 1_000).toFixed(0)}K`
  if (v >= 1) return `$${v.toFixed(0)}`
  return `$${v.toFixed(2)}`
}

export function fmtMoney(v: number): string {
  return `$${v.toFixed(2)}`
}

/** "Will the price of Bitcoin be between $60,000 and $62,000 on November 27?" -> "BTC $60-62k 11/27?" */
export function shortQuestion(q: string, max = 40): string {
  let s = q
    .replace(/Will the price of Bitcoin be between /i, 'BTC ')
    .replace(/Will the price of Bitcoin /i, 'BTC ')
    .replace(/Will Bitcoin /i, 'BTC ')
    .replace(/Bitcoin/gi, 'BTC')
    .replace(/Ethereum/gi, 'ETH')
    .replace(/Solana/gi, 'SOL')
    .replace(/What price will BTC hit in /i, 'BTC hits ')
    .replace(/What price will BTC hit on /i, 'BTC hits ')
    .replace(/November /g, 'Nov ')
    .replace(/December /g, 'Dec ')
    .replace(/January /g, 'Jan ')
    .replace(/\s+/g, ' ')
    .trim()
  if (s.length > max) s = s.slice(0, max - 1).trimEnd() + '…'
  return s
}

export function endLabel(endDate: string | null): string {
  if (!endDate) return 'no end date'
  const d = new Date(endDate)
  if (Number.isNaN(d.getTime())) return ''
  return `ends ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
}

export function timeHHMM(d = new Date()): string {
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
}
