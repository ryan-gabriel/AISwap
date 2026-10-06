import { beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'
import { signAppToken } from '../src/lib/jwt.js'
import type { UserRecord } from '../src/repo.js'

vi.mock('../src/repo.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../src/repo.js')>()
  return {
    ...mod,
    getUser: vi.fn(),
    countAccounts: vi.fn(),
    countAccountsForAdapter: vi.fn(),
    syncUserAccounts: vi.fn(),
    upsertUser: vi.fn(),
    getInstallation: vi.fn(),
  }
})

import {
  getUser,
  countAccounts,
  countAccountsForAdapter,
  syncUserAccounts,
  upsertUser,
  getInstallation,
} from '../src/repo.js'
import { createApp } from '../src/app.js'

const mockedGetUser = vi.mocked(getUser)
const mockedCountAccounts = vi.mocked(countAccounts)
const mockedCountForAdapter = vi.mocked(countAccountsForAdapter)
const mockedSync = vi.mocked(syncUserAccounts)
const mockedUpsertUser = vi.mocked(upsertUser)
const mockedGetInstallation = vi.mocked(getInstallation)

function makeToken(userId: string): string {
  return signAppToken({ scope: 'app', sub: userId, instId: 'inst-abcde12345' })
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
  vi.clearAllMocks()
  mockedSync.mockResolvedValue(3)
  mockedCountForAdapter.mockResolvedValue(0)
  mockedGetInstallation.mockResolvedValue({ userId: 'sub-1' })
})

describe('POST /api/accounts/save', () => {
  it('blocks a free-tier user whose server-side count is above the limit', async () => {
    mockedGetUser.mockResolvedValue(makeUser({ licenseTier: 'free' }))
    mockedCountAccounts.mockResolvedValue(4)

    const res = await request(createApp())
      .post('/api/accounts/save')
      .set('Authorization', `Bearer ${makeToken('sub-1')}`)
      .send({ adapterId: 'claude', accountIds: ['a', 'b', 'c', 'd'] })

    expect(res.status).toBe(403)
    expect(res.body).toEqual({ allowed: false, reason: 'free-limit', limit: 3 })
  })

  it('rejects a save that would exceed the cap before persisting anything', async () => {
    mockedGetUser.mockResolvedValue(makeUser({ licenseTier: 'free' }))
    mockedCountAccounts.mockResolvedValue(3)
    mockedCountForAdapter.mockResolvedValue(0)

    const res = await request(createApp())
      .post('/api/accounts/save')
      .set('Authorization', `Bearer ${makeToken('sub-1')}`)
      .send({ adapterId: 'claude', accountIds: ['a', 'b', 'c', 'd'] })

    expect(res.status).toBe(403)
    expect(res.body).toEqual({ allowed: false, reason: 'free-limit', limit: 3 })
    expect(mockedSync).not.toHaveBeenCalled()
  })

  it('allows a free-tier user whose projected total stays within the cap', async () => {
    mockedGetUser.mockResolvedValue(makeUser({ licenseTier: 'free' }))
    mockedCountAccounts.mockResolvedValue(0)
    mockedCountForAdapter.mockResolvedValue(0)

    const res = await request(createApp())
      .post('/api/accounts/save')
      .set('Authorization', `Bearer ${makeToken('sub-1')}`)
      .send({ adapterId: 'chatgpt', accountIds: ['a', 'b', 'c'] })

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ allowed: true, accountCount: 3 })
    expect(mockedSync).toHaveBeenCalledTimes(1)
    expect(mockedSync).toHaveBeenCalledWith('sub-1', 'chatgpt', ['a', 'b', 'c'])
  })

  it('allows a free user replacing an adapters set within the total cap', async () => {
    mockedGetUser.mockResolvedValue(makeUser({ licenseTier: 'free' }))
    mockedCountAccounts.mockResolvedValue(2)
    mockedCountForAdapter.mockResolvedValue(1)

    const res = await request(createApp())
      .post('/api/accounts/save')
      .set('Authorization', `Bearer ${makeToken('sub-1')}`)
      .send({ adapterId: 'chatgpt', accountIds: ['a', 'b'] })

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ allowed: true, accountCount: 3 })
    expect(mockedSync).toHaveBeenCalledTimes(1)
    expect(mockedSync).toHaveBeenCalledWith('sub-1', 'chatgpt', ['a', 'b'])
  })

  it('always allows a free user to reduce their stored count', async () => {
    mockedGetUser.mockResolvedValue(makeUser({ licenseTier: 'free' }))
    mockedCountAccounts.mockResolvedValue(3)
    mockedCountForAdapter.mockResolvedValue(3)

    const res = await request(createApp())
      .post('/api/accounts/save')
      .set('Authorization', `Bearer ${makeToken('sub-1')}`)
      .send({ adapterId: 'claude', accountIds: ['a'] })

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ allowed: true, accountCount: 3 })
    expect(mockedSync).toHaveBeenCalledTimes(1)
    expect(mockedSync).toHaveBeenCalledWith('sub-1', 'claude', ['a'])
  })

  it('allows unlimited saves for pro tier', async () => {
    mockedGetUser.mockResolvedValue(makeUser({ licenseTier: 'pro', subscriptionStatus: 'active' }))
    mockedCountAccounts.mockResolvedValue(99)
    mockedSync.mockResolvedValue(99)

    const res = await request(createApp())
      .post('/api/accounts/save')
      .set('Authorization', `Bearer ${makeToken('sub-1')}`)
      .send({ adapterId: 'gemini', accountIds: [] })

    expect(res.status).toBe(200)
    expect(res.body).toEqual({ allowed: true, accountCount: 99 })
  })

  it('rejects an unknown adapterId with 400', async () => {
    mockedGetUser.mockResolvedValue(makeUser({ licenseTier: 'free' }))

    const res = await request(createApp())
      .post('/api/accounts/save')
      .set('Authorization', `Bearer ${makeToken('sub-1')}`)
      .send({ adapterId: 'nope', accountIds: [] })

    expect(res.status).toBe(400)
    expect(mockedSync).not.toHaveBeenCalled()
  })

  it('rejects a save with more than 200 account ids', async () => {
    mockedGetUser.mockResolvedValue(makeUser({ licenseTier: 'pro', subscriptionStatus: 'active' }))

    const over = Array.from({ length: 201 }, (_, i) => `a-${i}`)
    const res = await request(createApp())
      .post('/api/accounts/save')
      .set('Authorization', `Bearer ${makeToken('sub-1')}`)
      .send({ adapterId: 'claude', accountIds: over })

    expect(res.status).toBe(400)
    expect(mockedSync).not.toHaveBeenCalled()
  })

  it('rejects requests without a token with 401', async () => {
    const res = await request(createApp())
      .post('/api/accounts/save')
      .send({ adapterId: 'claude', accountIds: [] })

    expect(res.status).toBe(401)
  })
})

describe('GET /api/license', () => {
  it('returns the user license tier and account limit', async () => {
    mockedGetUser.mockResolvedValue(makeUser({ licenseTier: 'free' }))

    const res = await request(createApp())
      .get('/api/license')
      .set('Authorization', `Bearer ${makeToken('sub-1')}`)

    expect(res.status).toBe(200)
    expect(res.body.accountLimit).toBe(3)
    expect(res.body.licenseTier).toBe('free')
  })

  it('returns null account limit for pro', async () => {
    mockedGetUser.mockResolvedValue(makeUser({ licenseTier: 'pro', subscriptionStatus: 'active' }))

    const res = await request(createApp())
      .get('/api/license')
      .set('Authorization', `Bearer ${makeToken('sub-1')}`)

    expect(res.status).toBe(200)
    expect(res.body.accountLimit).toBeNull()
  })

  it('returns 401 without a token', async () => {
    const res = await request(createApp()).get('/api/license')
    expect(res.status).toBe(401)
  })

  it('returns expiresAt from grace window for past_due', async () => {
    const graceEndsAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString()
    mockedGetUser.mockResolvedValue(
      makeUser({ licenseTier: 'pro', subscriptionStatus: 'past_due', graceEndsAt }),
    )

    const res = await request(createApp())
      .get('/api/license')
      .set('Authorization', `Bearer ${makeToken('sub-1')}`)

    expect(res.status).toBe(200)
    expect(res.body.expiresAt).toBe(graceEndsAt)
  })

  it('demotes a past_due user whose grace window has elapsed', async () => {
    const graceEndsAt = new Date(Date.now() - 1000).toISOString()
    mockedGetUser.mockResolvedValue(
      makeUser({ licenseTier: 'pro', subscriptionStatus: 'past_due', graceEndsAt }),
    )
    mockedUpsertUser.mockResolvedValue()

    const res = await request(createApp())
      .get('/api/license')
      .set('Authorization', `Bearer ${makeToken('sub-1')}`)

    expect(res.status).toBe(200)
    expect(res.body.licenseTier).toBe('free')
    expect(res.body.subscriptionStatus).toBe('none')
    expect(mockedUpsertUser).toHaveBeenCalledWith(
      expect.objectContaining({ licenseTier: 'free', subscriptionStatus: 'none' }),
    )
  })

  it('keeps canceled users pro until period end', async () => {
    const proUntil = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
    mockedGetUser.mockResolvedValue(
      makeUser({ licenseTier: 'pro', subscriptionStatus: 'canceled', proUntil }),
    )

    const res = await request(createApp())
      .get('/api/license')
      .set('Authorization', `Bearer ${makeToken('sub-1')}`)

    expect(res.status).toBe(200)
    expect(res.body.licenseTier).toBe('pro')
    expect(res.body.expiresAt).toBe(proUntil)
  })

  it('demotes a canceled user after paid period ends', async () => {
    const proUntil = new Date(Date.now() - 1000).toISOString()
    mockedGetUser.mockResolvedValue(
      makeUser({ licenseTier: 'pro', subscriptionStatus: 'canceled', proUntil }),
    )
    mockedUpsertUser.mockResolvedValue()

    const res = await request(createApp())
      .get('/api/license')
      .set('Authorization', `Bearer ${makeToken('sub-1')}`)

    expect(res.status).toBe(200)
    expect(res.body.licenseTier).toBe('free')
    expect(res.body.subscriptionStatus).toBe('none')
  })
})