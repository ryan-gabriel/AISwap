import { readFileSync, existsSync } from 'node:fs'
import { describe, it, expect, beforeAll, vi } from 'vitest'
import request from 'supertest'

vi.mock('../src/repo.js', async () => {
  const actual = await vi.importActual<typeof import('../src/repo.js')>('../src/repo.js')
  return {
    ...actual,
    getUserById: vi.fn(async () => null),
    getUserByEmail: vi.fn(async () => null),
    getUserBySupabaseId: vi.fn(async () => null),
    getUserByAuthUserId: vi.fn(async () => null),
    getUserByXenditAccountId: vi.fn(async () => null),
    getUserByLemonSqueezyCustomerId: vi.fn(async () => null),
    createUser: vi.fn(async (u: any) => ({ id: 'u1', ...u })),
    updateUser: vi.fn(async () => null),
    getUserLicense: vi.fn(async () => null),
    createOrUpdateLicense: vi.fn(async () => null),
    deleteLicense: vi.fn(async () => null),
    upsertLicenseFromWebhook: vi.fn(async () => null),
    getAccount: vi.fn(async () => null),
    getAccountsByUserId: vi.fn(async () => null),
    createAccount: vi.fn(async (a: any) => ({ id: 'a1', ...a })),
    updateAccount: vi.fn(async () => null),
    deleteAccount: vi.fn(async () => null),
  }
})

vi.mock('../src/lib/lemonsqueezy.js', async () => {
  const actual = await vi.importActual<typeof import('../src/lib/lemonsqueezy.js')>('../src/lib/lemonsqueezy.js')
  return {
    ...actual,
    createCheckoutUrl: vi.fn(async () => 'https://checkout.example'),
    createCustomerPortalUrl: vi.fn(async () => 'https://portal.example'),
    verifyWebhookSignature: vi.fn(() => true),
    parseWebhookEvent: vi.fn(() => ({ meta: { event_name: 'test' } as any })),
    getSubscription: vi.fn(async () => null),
    getCustomer: vi.fn(async () => null),
  }
})

describe('deployment routing contract', () => {
  let app: any

  beforeAll(async () => {
    const mod = await import('../src/app.js')
    app = mod.default || mod.createApp()
  })

  it('GET /health returns 200', async () => {
    const res = await request(app).get('/health')
    expect(res.status).not.toBe(404)
    expect(res.status).toBe(200)
  })

  it('GET /account returns non-404', async () => {
    const res = await request(app).get('/account')
    expect(res.status).not.toBe(404)
  })

  it('GET /checkout-complete returns non-404', async () => {
    const res = await request(app).get('/checkout-complete')
    expect(res.status).not.toBe(404)
  })

  it('GET /api/license unauthenticated is non-404', async () => {
    const res = await request(app).get('/api/license')
    expect(res.status).not.toBe(404)
  })

  it('POST /api/auth/verify is non-404', async () => {
    const res = await request(app).post('/api/auth/verify').send({})
    expect(res.status).not.toBe(404)
  })

  it('POST /api/auth/refresh is non-404', async () => {
    const res = await request(app).post('/api/auth/refresh').send({})
    expect(res.status).not.toBe(404)
  })

  it('POST /api/auth/logout is non-404', async () => {
    const res = await request(app).post('/api/auth/logout').send({})
    expect(res.status).not.toBe(404)
  })

  it('POST /api/accounts/save is non-404', async () => {
    const res = await request(app).post('/api/accounts/save').send({})
    expect(res.status).not.toBe(404)
  })

  it('GET /api/upgrade is non-404', async () => {
    const res = await request(app).get('/api/upgrade')
    expect(res.status).not.toBe(404)
  })

  it('GET /api/portal is non-404', async () => {
    const res = await request(app).get('/api/portal')
    expect(res.status).not.toBe(404)
  })

  it('POST /api/webhooks/xendit is non-404', async () => {
    const res = await request(app).post('/api/webhooks/xendit').send({})
    expect(res.status).not.toBe(404)
  })

  it('POST /api/webhooks/lemonsqueezy is non-404', async () => {
    const res = await request(app).post('/api/webhooks/lemonsqueezy').send(JSON.stringify({}))
    expect(res.status).not.toBe(404)
  })
})

describe('vercel.json shape', () => {
  it('must not collapse paths via rewrites', () => {
    const cfg = JSON.parse(readFileSync('vercel.json', 'utf8'))
    expect(cfg.rewrites).toBeUndefined()
    expect(cfg.redirects).toBeUndefined()
  })
})

describe('no legacy api directory', () => {
  it('api/ directory must not exist under the backend root', () => {
    expect(existsSync('api')).toBe(false)
  })
})
