import { chromium } from 'playwright'
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const base = new URL('../screenshots/', import.meta.url)
await mkdir(base, { recursive: true })
const shot = (name) => fileURLToPath(new URL(name, base))

const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 })
const errors = []
page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
page.on('pageerror', (error) => errors.push(error.message))

await page.goto('http://127.0.0.1:4174/', { waitUntil: 'networkidle' })
await page.waitForFunction(() => Number.parseFloat(getComputedStyle(document.querySelector('.context-stage')).opacity) > .99)

await page.getByRole('button', { name: 'Import chats' }).click()
await page.locator('.import-modal').waitFor({ state: 'visible' })
const focusOnOpen = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'))
await page.keyboard.press('Tab')
const focusAfterTab = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'))
await page.getByText('Context from chats').waitFor({ state: 'visible' })
await page.waitForTimeout(500)
await page.evaluate(() => window.scrollTo(0, 0))
await page.screenshot({ path: shot('refine-01-context.png') })

await page.getByRole('button', { name: '发送购买意图' }).click()
await page.getByText('Moment').waitFor({ state: 'visible' })
await page.getByText('↓ ¥60 · best').waitFor({ state: 'visible' })
await page.waitForTimeout(350)
await page.evaluate(() => window.scrollTo(0, 0))
await page.screenshot({ path: shot('refine-02-market.png') })

await page.getByText('18 buyers', { exact: true }).waitFor({ state: 'visible', timeout: 10000 })
await page.waitForFunction(() => document.querySelector('.price-drop')?.classList.contains('complete'))
await page.waitForTimeout(280)
await page.evaluate(() => window.scrollTo(0, 0))
await page.screenshot({ path: shot('refine-03-collective.png') })

await page.getByRole('button', { name: 'Authorize plan · ¥775' }).waitFor({ state: 'visible', timeout: 10000 })
await page.waitForFunction(() => Number.parseFloat(getComputedStyle(document.querySelector('.recommendation')).opacity) > .99)
await page.evaluate(() => window.scrollTo(0, 0))
await page.screenshot({ path: shot('refine-04-final.png') })
await page.getByRole('button', { name: 'Authorize plan · ¥775' }).click()
await page.getByRole('button', { name: 'Plan authorized' }).waitFor({ state: 'visible' })

const metrics = await page.evaluate(() => ({
  width: document.documentElement.scrollWidth,
  height: document.documentElement.scrollHeight,
  viewportWidth: window.innerWidth,
  viewportHeight: window.innerHeight,
  scrollY: window.scrollY,
  stage: document.querySelector('main')?.className,
  footerCount: document.querySelectorAll('footer').length,
  header: (() => {
    const el = document.querySelector('header')
    if (!el) return null
    const rect = el.getBoundingClientRect()
    return { top: rect.top, bottom: rect.bottom, display: getComputedStyle(el).display, opacity: getComputedStyle(el).opacity }
  })(),
}))

const mobile = await browser.newPage({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 1 })
await mobile.goto('http://127.0.0.1:4174/', { waitUntil: 'networkidle' })
await mobile.waitForFunction(() => Number.parseFloat(getComputedStyle(document.querySelector('.context-stage')).opacity) > .99)
await mobile.getByRole('button', { name: '发送购买意图' }).click()
await mobile.getByRole('button', { name: 'Authorize plan · ¥775' }).waitFor({ state: 'visible', timeout: 10000 })
await mobile.waitForFunction(() => Number.parseFloat(getComputedStyle(document.querySelector('.recommendation')).opacity) > .99)
await mobile.evaluate(() => window.scrollTo(0, 0))
await mobile.screenshot({ path: shot('refine-mobile-final.png'), fullPage: true })
const mobileMetrics = await mobile.evaluate(() => ({
  width: document.documentElement.scrollWidth,
  viewportWidth: window.innerWidth,
  height: document.documentElement.scrollHeight,
}))

const reduced = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' })
await reduced.goto('http://127.0.0.1:4174/', { waitUntil: 'networkidle' })
await reduced.getByRole('button', { name: '发送购买意图' }).click()
await reduced.getByRole('button', { name: 'Authorize plan · ¥775' }).waitFor({ state: 'visible', timeout: 4000 })

console.log(JSON.stringify({ metrics, mobileMetrics, focus: { focusOnOpen, focusAfterTab }, reducedMotionReachedFinal: true, errors }, null, 2))
await browser.close()
