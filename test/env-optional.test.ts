import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'

// Payment providers are optional: the backend must boot and serve non-payment
// routes when none of the payment env vars are present. test/setup.ts seeds all
// of them; dotenv also loads a local .env, so we shadow the payment keys with
// empty strings (which `optional()` treats as unset) and restore afterwards.
// vi.resetModules re-evaluates src/env.js against the current process.env.

const PAYMENT_KEYS = [
  'XENDIT_SECRET_KEY',
  'XENDIT_WEBHOOK_TOKEN',
  'XENDIT_PRICE_PRO_MONTHLY_MINOR',
  'XENDIT_PRICE_PRO_YEARLY_MINOR',
  'LEMONSQUEEZY_API_KEY',
  'LEMONSQUEEZY_WEBHOOK_SECRET',
  'LEMONSQUEEZY_STORE_ID',
  'LEMONSQUEEZY_PRODUCT_ID',
  'LEMONSQUEEZY_VARIANT_PRO_MONTHLY',
  'LEMONSQUEEZY_VARIANT_PRO_YEARLY',
]

let snapshot: Array<[string, string | undefined]> = []
let savedNodeEnv: string | undefined

beforeEach(() => {
  snapshot = PAYMENT_KEYS.map((key) => [key, process.env[key]])
  savedNodeEnv = process.env.NODE_ENV
  for (const key of PAYMENT_KEYS) process.env[key] = ''
})

afterEach(() => {
  for (const [key, value] of snapshot) {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
  process.env.NODE_ENV = savedNodeEnv
  vi.resetModules()
})

async function loadEnv() {
  vi.resetModules()
  return import('../src/env.js')
}

async function loadApp() {
  vi.resetModules()
  const mod = await import('../src/app.js')
  return mod.default ?? mod.createApp()
}

describe('env without payment providers', () => {
  it('boots with only required vars and reports both providers disabled', async () => {
    const { env, xenditEnabled, lemonSqueezyEnabled } = await loadEnv()

    expect(env.lemonSqueezyApiKey).toBeNull()
    expect(env.xenditSecretKey).toBeNull()
    expect(lemonSqueezyEnabled).toBe(false)
    expect(xenditEnabled).toBe(false)
  })

  it('still rejects a placeholder payment value in production', async () => {
    process.env.NODE_ENV = 'production'
    process.env.JWT_SECRET = 'a'.repeat(48)
    process.env.LEMONSQUEEZY_API_KEY = 'your_lemonsqueezy_api_key'

    await expect(loadEnv()).rejects.toThrow(/must not use a placeholder/)
  })

  it('reports a provider enabled once every value it needs is present', async () => {
    process.env.LEMONSQUEEZY_API_KEY = 'ls_live_key'
    process.env.LEMONSQUEEZY_WEBHOOK_SECRET = 'whsec'
    process.env.LEMONSQUEEZY_STORE_ID = '1'
    process.env.LEMONSQUEEZY_PRODUCT_ID = '2'
    process.env.LEMONSQUEEZY_VARIANT_PRO_MONTHLY = '3'
    process.env.LEMONSQUEEZY_VARIANT_PRO_YEARLY = '4'

    const { lemonSqueezyEnabled } = await loadEnv()
    expect(lemonSqueezyEnabled).toBe(true)
  })
})

describe('app boots without payments', () => {
  it('serves health and short-circuits payment routes with 503', async () => {
    const app = await loadApp()

    const health = await request(app).get('/health')
    expect(health.status).toBe(200)
    expect(health.body).toEqual({ ok: true })

    const upgrade = await request(app).get('/api/upgrade')
    expect(upgrade.status).toBe(503)
    expect(upgrade.body).toEqual({ error: 'payments-not-configured' })

    const xendit = await request(app).post('/api/webhooks/xendit').send({})
    expect(xendit.status).toBe(503)
    expect(xendit.body).toEqual({ error: 'payments-not-configured' })

    const lemon = await request(app)
      .post('/api/webhooks/lemonsqueezy')
      .set('Content-Type', 'application/json')
      .send('{}')
    expect(lemon.status).toBe(503)
    expect(lemon.body).toEqual({ error: 'payments-not-configured' })
  }, 20000)
})
