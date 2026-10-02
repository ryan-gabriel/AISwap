import { beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'
import { signAppToken } from '../src/lib/jwt.js'
import type { UserRecord } from '../src/repo.js'

vi.mock('../src/lib/xendit.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../src/lib/xendit.js')>()
  return { ...mod, createSubscription: vi.fn() }
})

vi.mock('../src/repo.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../src/repo.js')>()
  return { ...mod, getUser: vi.fn(), upsertUser: vi.fn(), getInstallation: vi.fn() }
})

import { createSubscription } from '../src/lib/xendit.js'
import { getUser, upsertUser, getInstallation } from '../src/repo.js'
import { createApp } from '../src/app.js'

const mockedCreate = vi.mocked(createSubscription)
const mockedGetUser = vi.mocked(getUser)
const mockedUpsert = vi.mocked(upsertUser)
const mockedGetInstallation = vi.mocked(getInstallation)

function token(sub = 'sub-1', instId = 'inst-abcde12345'): string {
  return signAppToken({ scope: 'app', sub, instId })
}

function makeUser(overrides: Partial<UserRecord> = {}): UserRecord {
  return {
    userId: 'sub-1',
    email: 'a@b.com',
    licenseTier: 'free',
    subscriptionStatus: 'none',
    xenditSubscriptionId: null,
    xenditCheckoutSessionId: null,
    graceEndsAt: null,
    proUntil: null,
    lastVerifiedAt: null,
    ...overrides,
  }
}

beforeEach(() => {
  vi.resetAllMocks()
  mockedGetUser.mockResolvedValue(makeUser())
  mockedUpsert.mockResolvedValue()
  mockedCreate.mockResolvedValue({ id: 'session-1', checkoutUrl: 'https://checkout.example/start' })
  mockedGetInstallation.mockResolvedValue({ userId: 'sub-1' })
})

describe('GET /api/upgrade', () => {
  it('returns a hosted checkout url for the monthly plan', async () => {
    const res = await request(createApp())
      .get('/api/upgrade?interval=monthly')
      .set('Authorization', `Bearer ${token()}`)

    expect(res.status).toBe(200)
    expect(res.body.checkoutUrl).toBe('https://checkout.example/start')
    expect(mockedCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        referenceId: 'sub-1',
        email: 'a@b.com',
        interval: 'monthly',
      }),
    )
  })

  it('returns a hosted checkout url for the yearly plan', async () => {
    const res = await request(createApp())
      .get('/api/upgrade?interval=yearly')
      .set('Authorization', `Bearer ${token()}`)

    expect(res.status).toBe(200)
    expect(mockedCreate).toHaveBeenCalledWith(
      expect.objectContaining({ interval: 'yearly' }),
    )
  })

  it('persists the checkout session id, not a shared plan id', async () => {
    await request(createApp())
      .get('/api/upgrade')
      .set('Authorization', `Bearer ${token()}`)

    expect(mockedUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'sub-1', xenditCheckoutSessionId: 'session-1' }),
    )
    expect(mockedUpsert).toHaveBeenCalledWith(
      expect.not.objectContaining({ xenditSubscriptionId: 'session-1' }),
    )
  })

  it('persists the yearly checkout session id for the yearly interval', async () => {
    mockedCreate.mockResolvedValue({
      id: 'session-yearly',
      checkoutUrl: 'https://checkout.example/start',
    })
    await request(createApp())
      .get('/api/upgrade?interval=yearly')
      .set('Authorization', `Bearer ${token()}`)

    expect(mockedUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'sub-1', xenditCheckoutSessionId: 'session-yearly' }),
    )
  })

  it('stores a distinct pending session per user without a shared unique value', async () => {
    const first = await request(createApp())
      .get('/api/upgrade')
      .set('Authorization', `Bearer ${token()}`)
    expect(first.status).toBe(200)

    mockedGetInstallation.mockResolvedValueOnce({ userId: 'sub-2' })
    mockedGetUser.mockResolvedValueOnce(
      makeUser({ userId: 'sub-2', email: 'b@c.com' }),
    )
    mockedCreate.mockResolvedValueOnce({
      id: 'session-2',
      checkoutUrl: 'https://checkout.example/start',
    })

    const second = await request(createApp())
      .get('/api/upgrade')
      .set('Authorization', `Bearer ${token('sub-2', 'inst-abcde12346')}`)
    expect(second.status).toBe(200)

    expect(mockedUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'sub-2',
        xenditCheckoutSessionId: 'session-2',
        xenditSubscriptionId: null,
      }),
    )
    const distinct = new Set(
      mockedUpsert.mock.calls.map((call) => (call[0] as UserRecord).xenditCheckoutSessionId),
    )
    expect(distinct).toEqual(new Set(['session-1', 'session-2']))
  })

  it('refuses a duplicate upgrade for an already-active subscription', async () => {
    mockedGetUser.mockResolvedValue(
      makeUser({ licenseTier: 'pro', subscriptionStatus: 'active', xenditSubscriptionId: 'plan-1' }),
    )
    const res = await request(createApp())
      .get('/api/upgrade')
      .set('Authorization', `Bearer ${token()}`)

    expect(res.status).toBe(409)
    expect(mockedCreate).not.toHaveBeenCalled()
  })

  it('rejects an invalid interval with 400', async () => {
    const res = await request(createApp())
      .get('/api/upgrade?interval=weekly')
      .set('Authorization', `Bearer ${token()}`)

    expect(res.status).toBe(400)
  })

  it('rejects requests without a token with 401', async () => {
    const res = await request(createApp()).get('/api/upgrade')
    expect(res.status).toBe(401)
  })

  it('rate-limits repeated checkout generations for the same user', async () => {
    const app = createApp()
    for (let i = 0; i < 10; i++) {
      const res = await request(app)
        .get('/api/upgrade')
        .set('Authorization', `Bearer ${token()}`)
      expect(res.status).toBe(200)
    }
    const limited = await request(app)
      .get('/api/upgrade')
      .set('Authorization', `Bearer ${token()}`)
    expect(limited.status).toBe(429)
    expect(limited.body).toEqual({ error: 'rate-limited' })
  })
})