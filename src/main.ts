/**
 * Poly Glance — Polymarket odds at a glance on Even Realities G2.
 *
 * Track 02 · Crypto & DeFi (Heads Up: Even Realities Hackathon, DoraHacks).
 *
 * Interaction model (glasses: ONE capture container per page):
 *  - HOME: native list of top crypto markets (live Gamma API). Tap an item
 *    to open it. Double-tap on Home exits (system dialog, required).
 *  - DETAIL: header shows live odds; action list places $10/$50 PAPER bets,
 *    toggles the watchlist, or goes back. No real money, no wallet.
 *  - WATCHLIST / PAPER BETS: lists with live values; tap an entry for detail.
 *  - VOICE: long-press anywhere to talk — "top", "watchlist", "bets",
 *    "refresh", "back", "yes", "no", or a market number. Mic via the G2
 *    four-mic array; speech-to-text via Web Speech API when the WebView
 *    provides it, otherwise the mic still opens and the tap path remains.
 *  - Double-tap anywhere except Home goes back Home.
 *
 * Runs in the simulator / on G2 through the Even Hub bridge, and in a plain
 * browser as a preview (DOM mirror + clickable dev list, no bridge needed).
 */

import {
  AudioInputSource,
  OsEventTypeList,
  waitForEvenAppBridge,
  type EvenAppBridge,
  type EvenHubEvent,
} from '@evenrealities/even_hub_sdk'
import { Glance, type PageSpec } from './glance'
import {
  endLabel,
  fetchCryptoMarkets,
  fetchMarket,
  fmtMoney,
  fmtUsd,
  pct,
  shortQuestion,
  timeHHMM,
  type Market,
} from './polymarket'
import {
  betCurrentValue,
  bridgeStorage,
  browserStorage,
  isWatched,
  loadState,
  placeBet,
  saveState,
  toggleWatch,
  type AppState,
  type Bet,
  type StorageAdapter,
} from './store'

type Screen =
  | { name: 'home' }
  | { name: 'detail'; market: Market }
  | { name: 'watchlist' }
  | { name: 'bets' }
  | { name: 'betDetail'; bet: Bet }
  | { name: 'confirm'; text: string; market: Market }
  | { name: 'listening'; hint: string }

const REFRESH_MS = 60_000
const VOICE_HOLD_MS = 2_500

interface SpeechRecognitionLike {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null
  onerror: ((e: unknown) => void) | null
  onend: (() => void) | null
  start(): void
  stop(): void
}

function getSpeechRecognition(): (new () => SpeechRecognitionLike) | null {
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike
    webkitSpeechRecognition?: new () => SpeechRecognitionLike
  }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

class App {
  private bridge: EvenAppBridge | null = null
  private glance: Glance
  private storage: StorageAdapter = browserStorage()
  private state: AppState = { balance: 1000, bets: [], watchlist: [], watchMeta: {} }
  private markets: Market[] = []
  private screen: Screen = { name: 'home' }
  private lastUpdated: Date | null = null
  private lastError = ''
  private listening = false
  private returnScreen: Screen = { name: 'home' }
  private audioBytes = 0

  constructor() {
    this.glance = new Glance(null)
  }

  async boot(): Promise<void> {
    // Bridge (simulator / G2) with a timeout fallback to browser-preview mode.
    this.bridge = await Promise.race([
      waitForEvenAppBridge().then((b) => b as EvenAppBridge),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000)),
    ]).catch(() => null)
    this.glance = new Glance(this.bridge)
    this.storage = this.bridge ? bridgeStorage(this.bridge) : browserStorage()
    // Dev-only: ?reset=1 clears paper state (clean demo recordings).
    if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('reset')) {
      await this.storage.set('polyglance.v1', '')
    }
    this.state = await loadState(this.storage)

    if (this.bridge) {
      this.bridge.onEvenHubEvent((event) => void this.onEvent(event))
    }
    this.wireBrowserPreview()

    await this.glance.render({
      kind: 'text',
      content:
        'POLY GLANCE\n\nLoading live odds\nfrom Polymarket...\n\nCrypto & DeFi track\nEven Realities G2',
    })
    await this.refreshMarkets()
    setInterval(() => void this.autoRefresh(), REFRESH_MS)
  }

  // ---------------- data ----------------

  private async refreshMarkets(): Promise<void> {
    try {
      const markets = await fetchCryptoMarkets(12)
      this.markets = markets
      this.lastUpdated = new Date()
      this.lastError = ''
      // Keep the detail screen on the fresh copy of the same market.
      if (this.screen.name === 'detail') {
        const cur = this.screen.market
        const fresh = markets.find((m) => m.id === cur.id)
        if (fresh) this.screen = { name: 'detail', market: fresh }
      }
      await this.renderCurrent()
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : String(err)
      await this.glance.render({
        kind: 'text',
        content:
          'NO LIVE DATA\n\nPolymarket Gamma API\nunreachable.\n\n' +
          this.lastError.slice(0, 90) +
          '\n\nTap to retry.\n(No mock data shown.)',
      })
    }
  }

  private async autoRefresh(): Promise<void> {
    if (this.listening) return
    try {
      const markets = await fetchCryptoMarkets(12)
      this.markets = markets
      this.lastUpdated = new Date()
      const cur = this.screen
      if (cur.name === 'detail') {
        const fresh = markets.find((m) => m.id === cur.market.id)
        if (fresh) this.screen = { name: 'detail', market: fresh }
      }
      await this.renderCurrent()
    } catch {
      /* keep last good data on screen; next manual refresh retries */
    }
  }

  // ---------------- rendering ----------------

  private footerLine(): string {
    return this.lastUpdated
      ? `Bal ${fmtMoney(this.state.balance)}  |  Updated ${timeHHMM(this.lastUpdated)}`
      : 'Live from Polymarket Gamma API'
  }

  private async renderCurrent(): Promise<void> {
    const s = this.screen
    let page: PageSpec
    if (s.name === 'home') {
      page = this.homePage()
    } else if (s.name === 'detail') {
      page = this.detailPage(s.market)
    } else if (s.name === 'watchlist') {
      page = this.watchlistPage()
    } else if (s.name === 'bets') {
      page = this.betsPage()
    } else if (s.name === 'betDetail') {
      page = { kind: 'text', content: this.betDetailText(s.bet) + '\n\nTap: back to bets' }
    } else if (s.name === 'confirm') {
      page = { kind: 'text', content: s.text + '\n\nTap to continue' }
    } else {
      page = { kind: 'text', content: s.hint }
    }
    await this.glance.render(page)
    this.syncDevList(page)
  }

  private homePage(): PageSpec {
    const header =
      `POLY GLANCE - TOP CRYPTO ODDS\n` +
      this.footerLine()
    const items = this.markets.map((m) => {
      const a = m.outcomes[0]
      const b = m.outcomes[1]
      return `${shortQuestion(m.question, 42)} ${a} ${pct(m.prices[0])}% / ${b} ${pct(m.prices[1])}%`
    })
    items.push(`* WATCHLIST (${this.state.watchlist.length})`)
    items.push(`$ PAPER BETS - bal ${fmtMoney(this.state.balance)}`)
    items.push('REFRESH ODDS')
    return { kind: 'list', header, items }
  }

  private detailPage(m: Market): PageSpec {
    const a = m.outcomes[0]
    const b = m.outcomes[1]
    const header =
      `${shortQuestion(m.question, 44)}\n` +
      `${a} ${pct(m.prices[0])}%   |   ${b} ${pct(m.prices[1])}%  -  Vol ${fmtUsd(m.volume24h)} - ${endLabel(m.endDate)}`
    const items = [
      `BET ${a} $10 @ ${pct(m.prices[0])}% (PAPER)`,
      `BET ${b} $10 @ ${pct(m.prices[1])}% (PAPER)`,
      `BET ${a} $50 @ ${pct(m.prices[0])}% (PAPER)`,
      isWatched(this.state, m.id) ? 'WATCHLIST: REMOVE' : 'WATCHLIST: ADD',
      'BACK TO MARKETS',
    ]
    return { kind: 'list', header, items }
  }

  private watchlistPage(): PageSpec {
    const header = `WATCHLIST (${this.state.watchlist.length})\nTap a market for odds`
    const items: string[] = []
    for (const id of this.state.watchlist) {
      const m = this.markets.find((x) => x.id === id)
      if (m) {
        items.push(
          `${shortQuestion(m.question, 34)} ${m.outcomes[0]} ${pct(m.prices[0])}%`,
        )
      } else {
        const meta = this.state.watchMeta[id]
        items.push(meta ? `${shortQuestion(meta.q, 40)} (stale)` : `Market ${id} (stale)`)
      }
    }
    if (items.length === 0) items.push('(empty - add from a market)')
    items.push('BACK TO MARKETS')
    return { kind: 'list', header, items }
  }

  private betsPage(): PageSpec {
    const header =
      `PAPER BETS - bal ${fmtMoney(this.state.balance)}\n` +
      `Play money only. No wallet, no real funds.`
    const items: string[] = []
    for (const bet of this.state.bets) {
      const m = this.markets.find((x) => x.id === bet.marketId)
      const value = m ? betCurrentValue(bet, m.prices[this.sideIndex(m, bet)]) : null
      items.push(
        `${bet.side} ${fmtMoney(bet.stake)} @${pct(bet.price)}%` +
          (value !== null ? ` -> now ${fmtMoney(value)}` : ' (closed)') +
          ` | ${shortQuestion(bet.question, 24)}`,
      )
    }
    if (items.length === 0) items.push('(no bets yet - open a market)')
    items.push('BACK TO MARKETS')
    return { kind: 'list', header, items }
  }

  private sideIndex(m: Market, bet: Bet): number {
    const i = m.outcomes.indexOf(bet.side)
    return i >= 0 ? i : 0
  }

  private betDetailText(bet: Bet): string {
    const m = this.markets.find((x) => x.id === bet.marketId)
    const live = m ? m.prices[this.sideIndex(m, bet)] : null
    const value = live !== null ? betCurrentValue(bet, live) : null
    const placed = new Date(bet.placedAt).toLocaleString('en-GB', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    })
    return (
      `PAPER BET (SIMULATION)\n\n` +
      `${bet.question}\n\n` +
      `Side: ${bet.side}\n` +
      `Entry: ${pct(bet.price)}%  -  Stake: ${fmtMoney(bet.stake)}\n` +
      `Placed: ${placed}\n` +
      (live !== null
        ? `Live now: ${pct(live)}%\nPaper value now: ${fmtMoney(value ?? 0)}\n`
        : `Market closed - value frozen.\n`) +
      `\nBalance: ${fmtMoney(this.state.balance)}`
    )
  }

  // ---------------- input: glasses events ----------------

  private async onEvent(event: EvenHubEvent): Promise<void> {
    const listEv = event.listEvent
    if (listEv) {
      const t = listEv.eventType
      if (t === undefined || t === OsEventTypeList.CLICK_EVENT) {
        await this.handleListSelect(listEv.currentSelectItemIndex ?? 0)
        return
      }
      if (t === OsEventTypeList.DOUBLE_CLICK_EVENT) {
        await this.handleDoubleTap()
        return
      }
      return // scrolls are handled natively by firmware
    }
    const textEv = event.textEvent
    if (textEv) {
      const t = textEv.eventType
      if (t === undefined || t === OsEventTypeList.CLICK_EVENT) {
        await this.handleTap()
        return
      }
      if (t === OsEventTypeList.DOUBLE_CLICK_EVENT) {
        await this.handleDoubleTap()
        return
      }
      return
    }
    const sysEv = event.sysEvent
    if (sysEv) {
      const t = sysEv.eventType
      // In the simulator, DOUBLE_CLICK arrives on sysEvent (not on the
      // capturing container); long-press always arrives here too.
      if (t === OsEventTypeList.DOUBLE_CLICK_EVENT) {
        await this.handleDoubleTap()
        return
      }
      if (t === OsEventTypeList.CLICK_EVENT || t === undefined) {
        await this.handleTap()
        return
      }
      if (t === OsEventTypeList.LONG_PRESS_EVENT) {
        await this.startVoice()
        return
      }
      if (t === OsEventTypeList.LONG_PRESS_RELEASE_EVENT) {
        await this.stopVoice()
        return
      }
    }
    const audio = event.audioEvent
    if (audio && this.listening) {
      this.audioBytes += audio.audioPcm?.length ?? 0
    }
  }

  private async handleListSelect(index: number): Promise<void> {
    const s = this.screen
    if (s.name === 'home') {
      if (index < this.markets.length) {
        this.screen = { name: 'detail', market: this.markets[index] }
      } else if (index === this.markets.length) {
        this.screen = { name: 'watchlist' }
      } else if (index === this.markets.length + 1) {
        this.screen = { name: 'bets' }
      } else {
        await this.refreshMarkets()
        return
      }
      await this.renderCurrent()
      return
    }
    if (s.name === 'detail') {
      const m = s.market
      if (index === 0) await this.doBet(m, 0, 10)
      else if (index === 1) await this.doBet(m, 1, 10)
      else if (index === 2) await this.doBet(m, 0, 50)
      else if (index === 3) {
        const added = toggleWatch(this.state, m)
        await saveState(this.storage, this.state)
        this.screen = {
          name: 'confirm',
          text:
            `WATCHLIST ${added ? 'ADDED' : 'REMOVED'}\n\n${shortQuestion(m.question, 56)}`,
          market: m,
        }
        await this.renderCurrent()
      } else {
        this.screen = { name: 'home' }
        await this.renderCurrent()
      }
      return
    }
    if (s.name === 'watchlist') {
      if (index < this.state.watchlist.length) {
        const id = this.state.watchlist[index]
        const m = this.markets.find((x) => x.id === id)
        if (m) {
          this.screen = { name: 'detail', market: m }
        } else {
          // Stale entry: refresh from Gamma, then retry once.
          try {
            const fresh = await fetchMarket(id)
            this.markets = [fresh, ...this.markets.filter((x) => x.id !== id)]
            this.screen = { name: 'detail', market: fresh }
          } catch {
            this.screen = { name: 'watchlist' }
          }
        }
      } else {
        this.screen = { name: 'home' }
      }
      await this.renderCurrent()
      return
    }
    if (s.name === 'bets') {
      if (index < this.state.bets.length) {
        this.screen = { name: 'betDetail', bet: this.state.bets[index] }
      } else {
        this.screen = { name: 'home' }
      }
      await this.renderCurrent()
    }
  }

  private async handleTap(): Promise<void> {
    const s = this.screen
    if (s.name === 'confirm' || s.name === 'betDetail') {
      this.screen =
        s.name === 'confirm' ? { name: 'detail', market: s.market } : { name: 'bets' }
      await this.renderCurrent()
      return
    }
    if (s.name === 'listening') {
      await this.stopVoice()
      return
    }
    if (this.lastError && this.markets.length === 0) {
      await this.refreshMarkets()
    }
  }

  private async handleDoubleTap(): Promise<void> {
    if (this.screen.name === 'home') {
      if (this.bridge) {
        await this.bridge.shutDownPageContainer(1) // system exit dialog (required)
      }
      return
    }
    this.screen = { name: 'home' }
    await this.renderCurrent()
  }

  private async doBet(market: Market, sideIndex: number, stake: number): Promise<void> {
    const bet = placeBet(this.state, market, sideIndex, stake)
    if (!bet) {
      this.screen = {
        name: 'confirm',
        text:
          `NOT ENOUGH PAPER BALANCE\n\n` +
          `Need ${fmtMoney(stake)}, balance ${fmtMoney(this.state.balance)}.\n` +
          `Paper bets never use real money.`,
        market,
      }
      await this.renderCurrent()
      return
    }
    await saveState(this.storage, this.state)
    this.screen = {
      name: 'confirm',
      text:
        `BET PLACED (PAPER)\n\n` +
        `${bet.side} ${fmtMoney(stake)} @ ${pct(bet.price)}%\n` +
        `${shortQuestion(market.question, 56)}\n\n` +
        `Balance now ${fmtMoney(this.state.balance)}\n` +
        `Simulation only - no real funds.`,
      market,
    }
    await this.renderCurrent()
  }

  // ---------------- voice ----------------

  private async startVoice(): Promise<void> {
    if (this.listening) return
    this.listening = true
    this.audioBytes = 0
    this.returnScreen = this.screen.name === 'listening' ? { name: 'home' } : this.screen
    const SR = getSpeechRecognition()
    this.screen = {
      name: 'listening',
      hint:
        'LISTENING...\n\nSay: top, watchlist,\nbets, refresh, back,\nyes, no, or a number.\n\n' +
        (SR ? 'Mic on (G2 array).' : 'Mic on. ASR not in\nthis WebView - tap to go back.'),
    }
    await this.renderCurrent()
    if (this.bridge) {
      try {
        await this.bridge.audioControl(true, AudioInputSource.Glasses)
      } catch {
        /* mic unavailable in this host — voice degrades to tap */
      }
    }
    if (SR) {
      const rec = new SR()
      rec.lang = 'en-US'
      rec.continuous = false
      rec.interimResults = false
      rec.maxAlternatives = 1
      rec.onresult = (e) => {
        const transcript = e.results[0]?.[0]?.transcript ?? ''
        void this.onVoiceCommand(transcript)
      }
      rec.onerror = () => void this.stopVoice()
      rec.onend = () => {
        if (this.listening) void this.stopVoice()
      }
      try {
        rec.start()
      } catch {
        /* ignore */
      }
      this.voiceRec = rec
    } else {
      // No ASR in this WebView: keep the mic open briefly to prove capture,
      // then fall back to the tap path.
      setTimeout(() => {
        if (this.listening) void this.stopVoice()
      }, VOICE_HOLD_MS)
    }
  }

  private voiceRec: SpeechRecognitionLike | null = null

  private async stopVoice(): Promise<void> {
    if (!this.listening) return
    this.listening = false
    try {
      this.voiceRec?.stop()
    } catch {
      /* ignore */
    }
    this.voiceRec = null
    if (this.bridge) {
      try {
        await this.bridge.audioControl(false)
      } catch {
        /* ignore */
      }
    }
    this.screen = this.returnScreen
    await this.renderCurrent()
  }

  private async onVoiceCommand(raw: string): Promise<void> {
    const cmd = raw.toLowerCase().trim()
    if (!cmd) return
    const wasListening = this.listening
    this.listening = false
    try {
      this.voiceRec?.stop()
    } catch {
      /* ignore */
    }
    if (this.bridge) {
      try {
        await this.bridge.audioControl(false)
      } catch {
        /* ignore */
      }
    }
    if (!wasListening) return
    this.screen = this.returnScreen

    const numWord: Record<string, number> = {
      one: 1, two: 2, three: 3, four: 4, five: 5, six: 6,
      seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
    }
    const asNum = /^\d+$/.test(cmd) ? parseInt(cmd, 10) : numWord[cmd] ?? 0

    if (cmd.includes('watchlist') || cmd === 'watch') {
      this.screen = { name: 'watchlist' }
    } else if (cmd.includes('bet')) {
      this.screen = { name: 'bets' }
    } else if (cmd.includes('refresh')) {
      await this.refreshMarkets()
      return
    } else if (cmd.includes('back') || cmd.includes('home') || cmd.includes('top')) {
      this.screen = { name: 'home' }
    } else if (asNum >= 1 && asNum <= this.markets.length && this.screen.name === 'home') {
      this.screen = { name: 'detail', market: this.markets[asNum - 1] }
    } else if (this.screen.name === 'detail') {
      const m = this.screen.market
      const side = m.outcomes.findIndex((o) => cmd.includes(o.toLowerCase()))
      if (side >= 0) {
        await this.doBet(m, side, 10)
        return
      }
      if (cmd.includes('detail') || cmd.includes('first')) {
        /* already on detail */
      }
    } else if (cmd.includes('detail') || cmd.includes('first')) {
      if (this.markets.length > 0) this.screen = { name: 'detail', market: this.markets[0] }
    }
    await this.renderCurrent()
  }

  // ---------------- browser preview (no bridge) ----------------

  private wireBrowserPreview(): void {
    if (this.bridge || typeof document === 'undefined') return
    const mirror = document.getElementById('mirror')
    mirror?.addEventListener('click', () => void this.handleTap())
    mirror?.addEventListener('dblclick', () => void this.handleDoubleTap())
    const talk = document.getElementById('voicetalk')
    talk?.addEventListener('mousedown', () => void this.startVoice())
    talk?.addEventListener('mouseup', () => void this.stopVoice())
    const hint = document.getElementById('devhint')
    if (hint) {
      hint.textContent =
        'BROWSER PREVIEW (no G2 bridge) — click the green screen to tap, ' +
        'double-click to go back/exit, hold TALK for voice. Same code path as the glasses.'
    }
  }

  private syncDevList(page: PageSpec): void {
    if (this.bridge || typeof document === 'undefined') return
    const box = document.getElementById('devlist')
    if (!box) return
    box.innerHTML = ''
    if (page.kind !== 'list') return
    page.items.forEach((item, i) => {
      const b = document.createElement('button')
      b.type = 'button'
      b.textContent = `${i + 1}. ${item}`
      b.addEventListener('click', () => void this.handleListSelect(i))
      box.appendChild(b)
    })
  }
}

new App().boot().catch((err: unknown) => {
  console.error('[poly glance] boot failed', err)
  const el = document.getElementById('mirror')
  if (el) el.textContent = `BOOT FAILED\n\n${err instanceof Error ? err.message : String(err)}`
})
