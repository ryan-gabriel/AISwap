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

function token(): string {
  return signAppToken({ scope: 'app', sub: 'sub-1', instId: 'inst-abcde12345' })
}

function makeUser(overrides: Partial<UserRecord> = {}): UserRecord {
  return {
    userId: 'sub-1',
    email: 'a@b.com',
    licenseTier: 'free',
    subscriptionStatus: 'none',
    xenditSubscriptionId: null,
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
        planId: 'plan_monthly',
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
      expect.objectContaining({ planId: 'plan_yearly', interval: 'yearly' }),
    )
  })

  it('persists the recurring plan id, not the payment-session id', async () => {
    await request(createApp())
      .get('/api/upgrade')
      .set('Authorization', `Bearer ${token()}`)

    expect(mockedUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'sub-1', xenditSubscriptionId: 'plan_monthly' }),
    )
    expect(mockedUpsert).toHaveBeenCalledWith(
      expect.not.objectContaining({ xenditSubscriptionId: 'session-1' }),
    )
  })

  it('persists the yearly plan id for the yearly interval', async () => {
    await request(createApp())
      .get('/api/upgrade?interval=yearly')
      .set('Authorization', `Bearer ${token()}`)

    expect(mockedUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'sub-1', xenditSubscriptionId: 'plan_yearly' }),
    )
  })

  it('does not upsert when the stored plan id already matches', async () => {
    mockedGetUser.mockResolvedValue(
      makeUser({ xenditSubscriptionId: 'plan_monthly' }),
    )

    await request(createApp())
      .get('/api/upgrade')
      .set('Authorization', `Bearer ${token()}`)

    expect(mockedUpsert).not.toHaveBeenCalled()
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