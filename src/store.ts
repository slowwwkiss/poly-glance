/**
 * Paper-trading store: virtual balance, paper bets, watchlist.
 *
 * PAPER ONLY — no wallet, no real money, no on-chain transaction ever.
 * Starting balance is $1,000 of play money. Bets are recorded locally and
 * marked against LIVE prices; a bet's current paper value is
 * stake * (currentPrice / entryPrice) for the chosen side.
 *
 * Persistence: Even Hub bridge localStorage when a bridge exists, otherwise
 * window.localStorage (simulator dev / browser preview). Both hold the same
 * JSON shape so state survives a restart on the phone.
 */

import type { Market } from './polymarket'

export interface Bet {
  id: string
  marketId: string
  question: string
  side: string // outcome label, e.g. "Yes"
  price: number // entry price 0..1
  stake: number // paper USD
  placedAt: string // ISO
}

export interface AppState {
  balance: number
  bets: Bet[]
  watchlist: string[] // market ids
  watchMeta: Record<string, { q: string; price: number }>
}

export const PAPER_START_BALANCE = 1000
const STORE_KEY = 'polyglance.v1'

export interface StorageAdapter {
  get(key: string): Promise<string | null>
  set(key: string, value: string): Promise<void>
}

export function browserStorage(): StorageAdapter {
  return {
    async get(key) {
      try {
        return window.localStorage.getItem(key)
      } catch {
        return null
      }
    },
    async set(key, value) {
      try {
        window.localStorage.setItem(key, value)
      } catch {
        /* storage unavailable — state lives in memory only */
      }
    },
  }
}

export function bridgeStorage(bridge: {
  getLocalStorage(key: string): Promise<string>
  setLocalStorage(key: string, value: string): Promise<boolean>
}): StorageAdapter {
  const fallback = browserStorage()
  return {
    async get(key) {
      try {
        const v = await bridge.getLocalStorage(key)
        if (v) return v
      } catch {
        /* fall through */
      }
      return fallback.get(key)
    },
    async set(key, value) {
      try {
        await bridge.setLocalStorage(key, value)
      } catch {
        /* fall through */
      }
      await fallback.set(key, value)
    },
  }
}

export function emptyState(): AppState {
  return { balance: PAPER_START_BALANCE, bets: [], watchlist: [], watchMeta: {} }
}

export async function loadState(storage: StorageAdapter): Promise<AppState> {
  try {
    const raw = await storage.get(STORE_KEY)
    if (!raw) return emptyState()
    const parsed = JSON.parse(raw) as Partial<AppState>
    return {
      balance: typeof parsed.balance === 'number' ? parsed.balance : PAPER_START_BALANCE,
      bets: Array.isArray(parsed.bets) ? parsed.bets : [],
      watchlist: Array.isArray(parsed.watchlist) ? parsed.watchlist : [],
      watchMeta:
        parsed.watchMeta && typeof parsed.watchMeta === 'object' ? parsed.watchMeta : {},
    }
  } catch {
    return emptyState()
  }
}

export async function saveState(storage: StorageAdapter, state: AppState): Promise<void> {
  await storage.set(STORE_KEY, JSON.stringify(state))
}

/** Place a $stake paper bet. Returns the bet, or null when balance is short. */
export function placeBet(
  state: AppState,
  market: Market,
  sideIndex: number,
  stake: number,
): Bet | null {
  if (stake <= 0 || state.balance < stake) return null
  if (sideIndex < 0 || sideIndex >= market.outcomes.length) return null
  const bet: Bet = {
    id: `bet-${Date.now().toString(36)}`,
    marketId: market.id,
    question: market.question,
    side: market.outcomes[sideIndex],
    price: market.prices[sideIndex],
    stake,
    placedAt: new Date().toISOString(),
  }
  state.balance = Math.round((state.balance - stake) * 100) / 100
  state.bets.unshift(bet)
  return bet
}

/** Current paper value of a bet at a live price (same side). */
export function betCurrentValue(bet: Bet, livePrice: number): number {
  if (bet.price <= 0) return 0
  return Math.round(((bet.stake * livePrice) / bet.price) * 100) / 100
}

export function toggleWatch(state: AppState, market: Market): boolean {
  const i = state.watchlist.indexOf(market.id)
  if (i >= 0) {
    state.watchlist.splice(i, 1)
    delete state.watchMeta[market.id]
    return false
  }
  state.watchlist.push(market.id)
  state.watchMeta[market.id] = { q: market.question, price: market.prices[0] }
  return true
}

export function isWatched(state: AppState, marketId: string): boolean {
  return state.watchlist.includes(marketId)
}
