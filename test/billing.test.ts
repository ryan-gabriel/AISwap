import { beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'
import { signAppToken } from '../src/lib/jwt.js'
import type { UserRecord } from '../src/repo.js'

vi.mock('../src/lib/xendit.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../src/lib/xendit.js')>()
  return { ...mod, cancelSubscription: vi.fn() }
})

vi.mock('../src/repo.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../src/repo.js')>()
  return { ...mod, getUser: vi.fn(), upsertUser: vi.fn(), getInstallation: vi.fn() }
})

import { cancelSubscription } from '../src/lib/xendit.js'
import { getUser, upsertUser, getInstallation } from '../src/repo.js'
import { createApp } from '../src/app.js'

const mockedCancel = vi.mocked(cancelSubscription)
const mockedGetUser = vi.mocked(getUser)
const mockedUpsert = vi.mocked(upsertUser)
const mockedGetInstallation = vi.mocked(getInstallation)

describe('authenticated middleware', () => {
  it('rejects a token whose installation was revoked', async () => {
    mockedGetInstallation.mockResolvedValue(null)
    const res = await request(createApp())
      .get('/api/portal')
      .set('Authorization', `Bearer ${token()}`)
    expect(res.status).toBe(401)
  })

  it('rejects a token whose installation belongs to another user', async () => {
    mockedGetInstallation.mockResolvedValue({ userId: 'someone-else' })
    const res = await request(createApp())
      .get('/api/portal')
      .set('Authorization', `Bearer ${token()}`)
    expect(res.status).toBe(401)
  })
})

function token(): string {
  return signAppToken({ scope: 'app', sub: 'sub-1', instId: 'inst-abcde12345' })
}

function makeUser(overrides: Partial<UserRecord> = {}): UserRecord {
  return {
    userId: 'sub-1',
    email: 'a@b.com',
    licenseTier: 'pro',
    subscriptionStatus: 'active',
    xenditSubscriptionId: 'plan-1',
    graceEndsAt: null,
    proUntil: null,
    lastVerifiedAt: null,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockedGetUser.mockResolvedValue(makeUser())
  mockedUpsert.mockResolvedValue()
  mockedCancel.mockResolvedValue()
  mockedGetInstallation.mockResolvedValue({ userId: 'sub-1' })
})

describe('GET /api/portal', () => {
  it('returns a self-hosted /account url carrying a short-lived token', async () => {
    const res = await request(createApp())
      .get('/api/portal')
      .set('Authorization', `Bearer ${token()}`)

    expect(res.status).toBe(200)
    expect(typeof res.body.url).toBe('string')
    expect(res.body.url).toContain('/account#token=')
    expect(res.body.url).not.toContain('/account?token=')
  })

  it('returns 400 for a user without a subscription', async () => {
    mockedGetUser.mockResolvedValue(makeUser({ xenditSubscriptionId: null }))
    const res = await request(createApp())
      .get('/api/portal')
      .set('Authorization', `Bearer ${token()}`)

    expect(res.status).toBe(400)
    expect(res.body.error).toBe('no-subscription')
  })

  it('rejects requests without a token with 401', async () => {
    const res = await request(createApp()).get('/api/portal')
    expect(res.status).toBe(401)
  })
})

describe('POST /api/account/cancel', () => {
  it('cancels the xendit subscription and marks the user canceled', async () => {
    const res = await request(createApp())
      .post('/api/account/cancel')
      .set('Authorization', `Bearer ${token()}`)

    expect(res.status).toBe(200)
    expect(mockedCancel).toHaveBeenCalledWith('plan-1')
    expect(mockedUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ subscriptionStatus: 'canceled' }),
    )
  })

  it('returns 400 when the user has no subscription', async () => {
    mockedGetUser.mockResolvedValue(makeUser({ xenditSubscriptionId: null }))
    const res = await request(createApp())
      .post('/api/account/cancel')
      .set('Authorization', `Bearer ${token()}`)

    expect(res.status).toBe(400)
    expect(mockedCancel).not.toHaveBeenCalled()
  })

  it('returns 400 for a stored payment-session id instead of calling xendit', async () => {
    mockedGetUser.mockResolvedValue(makeUser({ xenditSubscriptionId: 'ps-legacy-session' }))
    const res = await request(createApp())
      .post('/api/account/cancel')
      .set('Authorization', `Bearer ${token()}`)

    expect(res.status).toBe(400)
    expect(res.body.error).toBe('no-subscription')
    expect(mockedCancel).not.toHaveBeenCalled()
  })

  it('returns 502 when xendit cancel fails', async () => {
    mockedCancel.mockRejectedValue(new Error('boom'))
    const res = await request(createApp())
      .post('/api/account/cancel')
      .set('Authorization', `Bearer ${token()}`)

    expect(res.status).toBe(502)
    expect(mockedUpsert).not.toHaveBeenCalled()
  })

  it('is idempotent for an already-canceled subscription', async () => {
    mockedGetUser.mockResolvedValue(
      makeUser({ subscriptionStatus: 'canceled' }),
    )
    const res = await request(createApp())
      .post('/api/account/cancel')
      .set('Authorization', `Bearer ${token()}`)

    expect(res.status).toBe(200)
    expect(mockedCancel).not.toHaveBeenCalled()
  })

  it('rate-limits repeated cancels for the same user', async () => {
    const app = createApp()
    for (let i = 0; i < 10; i++) {
      const res = await request(app)
        .post('/api/account/cancel')
        .set('Authorization', `Bearer ${token()}`)
      expect(res.status).toBe(200)
    }
    const limited = await request(app)
      .post('/api/account/cancel')
      .set('Authorization', `Bearer ${token()}`)
    expect(limited.status).toBe(429)
    expect(limited.body).toEqual({ error: 'rate-limited' })
  })
})

describe('GET /account', () => {
  it('serves the billing management html page', async () => {
    const res = await request(createApp()).get('/account')
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toContain('text/html')
    expect(res.text).toContain('Manage subscription')
  })
})