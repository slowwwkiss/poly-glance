/**
 * Glance renderer — turns screens into Even Hub SDK containers.
 *
 * The G2 does NOT render HTML. Every screen is composed from SDK containers
 * on a 576x288 canvas (4-bit greyscale green):
 *  - Text page: one full-screen text container (capture = text).
 *  - List page: a dim header text container + one native list container
 *    (capture = list, firmware scroll + highlight, max 20 items x 64 chars).
 *
 * Exactly ONE container per page has isEventCapture: 1. First render uses
 * createStartUpPageContainer; every later render uses rebuildPageContainer.
 * Cheap text-only refreshes use textContainerUpgrade (flicker-free).
 *
 * Every render also mirrors the same text into the DOM (#mirror) so the app
 * is testable in a plain browser (browser-preview mode) and recordable.
 */

import {
  CreateStartUpPageContainer,
  ListContainerProperty,
  ListItemContainerProperty,
  RebuildPageContainer,
  StartUpPageCreateResult,
  TextContainerProperty,
  TextContainerUpgrade,
  type EvenAppBridge,
} from '@evenrealities/even_hub_sdk'

export type PageSpec =
  | { kind: 'text'; content: string }
  | { kind: 'list'; header: string; items: string[] }

const W = 576
const H = 288
const MAX_LIST_ITEMS = 20
const MAX_ITEM_CHARS = 64

function clipItem(s: string): string {
  const oneLine = s.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim()
  return oneLine.length > MAX_ITEM_CHARS
    ? oneLine.slice(0, MAX_ITEM_CHARS - 1).trimEnd() + '…'
    : oneLine
}

export class Glance {
  private bridge: EvenAppBridge | null
  private started = false
  private mirrorEl: HTMLElement | null
  private lastMirror = ''

  constructor(bridge: EvenAppBridge | null) {
    this.bridge = bridge
    this.mirrorEl =
      typeof document !== 'undefined' ? document.getElementById('mirror') : null
  }

  get hasBridge(): boolean {
    return this.bridge !== null
  }

  /** Render a page. Returns false when the SDK rejected the page. */
  async render(page: PageSpec): Promise<boolean> {
    const mirrorText =
      page.kind === 'text'
        ? page.content
        : `${page.header}\n${'─'.repeat(40)}\n${page.items
            .map((it, i) => `${i + 1}. ${clipItem(it)}`)
            .join('\n')}`
    this.mirror(mirrorText)
    if (!this.bridge) return true // browser-preview mode: DOM mirror is the display

    try {
      if (!this.started) {
        const res = await this.bridge.createStartUpPageContainer(
          new CreateStartUpPageContainer(this.containersFor(page)),
        )
        if (res === StartUpPageCreateResult.success) {
          this.started = true
          return true
        }
        // The host rejects a second startup-page create in one session
        // (e.g. after a WebView/HMR reload the old page still exists).
        // Rebuild the existing page instead — same containers, same result.
        console.warn('[glance] create failed:', res, '- falling back to rebuild')
        const ok = await this.bridge.rebuildPageContainer(
          new RebuildPageContainer(this.containersFor(page)),
        )
        if (ok) this.started = true
        else console.error('[glance] rebuild fallback failed')
        return ok
      }
      const ok = await this.bridge.rebuildPageContainer(
        new RebuildPageContainer(this.containersFor(page)),
      )
      if (!ok) console.error('[glance] rebuildPageContainer failed')
      return ok
    } catch (err) {
      console.error('[glance] render failed', err)
      return false
    }
  }

  /** Flicker-free in-place text update (text pages only). */
  async upgradeText(content: string): Promise<void> {
    this.mirror(content)
    if (!this.bridge || !this.started) return
    try {
      await this.bridge.textContainerUpgrade(
        new TextContainerUpgrade({ containerID: 1, containerName: 'main', content }),
      )
    } catch (err) {
      console.error('[glance] textContainerUpgrade failed', err)
    }
  }

  private containersFor(page: PageSpec): {
    containerTotalNum: number
    textObject?: TextContainerProperty[]
    listObject?: ListContainerProperty[]
  } {
    if (page.kind === 'text') {
      return {
        containerTotalNum: 1,
        textObject: [
          new TextContainerProperty({
            xPosition: 0,
            yPosition: 0,
            width: W,
            height: H,
            borderWidth: 0,
            borderColor: 5,
            paddingLength: 6,
            containerID: 1,
            containerName: 'main',
            content: page.content,
            isEventCapture: 1,
          }),
        ],
      }
    }
    const items = page.items.slice(0, MAX_LIST_ITEMS).map(clipItem)
    return {
      containerTotalNum: 2,
      textObject: [
        new TextContainerProperty({
          xPosition: 0,
          yPosition: 0,
          width: W,
          height: 58,
          borderWidth: 0,
          borderColor: 5,
          paddingLength: 6,
          containerID: 1,
          containerName: 'header',
          content: page.header,
          textColor: 2,
          isEventCapture: 0,
        }),
      ],
      listObject: [
        new ListContainerProperty({
          xPosition: 0,
          yPosition: 60,
          width: W,
          height: H - 60,
          borderWidth: 0,
          borderColor: 5,
          paddingLength: 0,
          containerID: 2,
          containerName: 'list',
          itemContainer: new ListItemContainerProperty({
            itemCount: items.length,
            itemWidth: W,
            isItemSelectBorderEn: 1,
            itemName: items,
          }),
          isEventCapture: 1,
        }),
      ],
    }
  }

  private mirror(text: string): void {
    if (text === this.lastMirror) return
    this.lastMirror = text
    if (this.mirrorEl) this.mirrorEl.textContent = text
  }
}
