import { beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'
import type { UserRecord } from '../src/repo.js'

vi.mock('../src/lib/lemonsqueezy.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../src/lib/lemonsqueezy.js')>()
  return {
    ...mod,
    verifyLemonSqueezySignature: vi.fn(),
    getSubscription: vi.fn(),
  }
})

vi.mock('../src/repo.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../src/repo.js')>()
  return {
    ...mod,
    getUser: vi.fn(),
    getUserByLemonSqueezySubscriptionId: vi.fn(),
    getUserByLemonSqueezyCheckoutId: vi.fn(),
    getUserByLemonSqueezyCustomerId: vi.fn(),
    upsertUser: vi.fn(),
    insertEventProcessed: vi.fn(),
    hasProcessedEvent: vi.fn(),
  }
})

import { verifyLemonSqueezySignature } from '../src/lib/lemonsqueezy.js'
import {
  getUser,
  getUserByLemonSqueezySubscriptionId,
  getUserByLemonSqueezyCheckoutId,
  getUserByLemonSqueezyCustomerId,
  upsertUser,
  insertEventProcessed,
  hasProcessedEvent,
} from '../src/repo.js'
import { createApp } from '../src/app.js'

const mockedVerify = vi.mocked(verifyLemonSqueezySignature)
const mockedGetUser = vi.mocked(getUser)
const mockedFindBySub = vi.mocked(getUserByLemonSqueezySubscriptionId)
const mockedFindByCheckout = vi.mocked(getUserByLemonSqueezyCheckoutId)
const mockedFindByCustomer = vi.mocked(getUserByLemonSqueezyCustomerId)
const mockedUpsert = vi.mocked(upsertUser)
const mockedInsert = vi.mocked(insertEventProcessed)
const mockedHasProcessed = vi.mocked(hasProcessedEvent)

function makeUser(overrides: Partial<UserRecord> = {}): UserRecord {
  return {
    userId: 'sub-1',
    email: 'a@b.com',
    licenseTier: 'free',
    subscriptionStatus: 'none',
    xenditSubscriptionId: null,
    xenditCheckoutSessionId: null,
    lemonsqueezySubscriptionId: null,
    lemonsqueezyCheckoutId: null,
    lemonsqueezyCustomerId: null,
    lemonsqueezyVariantId: null,
    graceEndsAt: null,
    proUntil: null,
    lastVerifiedAt: null,
    ...overrides,
  }
}

const app = createApp()

describe('POST /api/webhooks/lemonsqueezy', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockedVerify.mockReturnValue(true)
    mockedGetUser.mockResolvedValue(makeUser())
    mockedFindBySub.mockResolvedValue(null)
    mockedFindByCheckout.mockResolvedValue(null)
    mockedFindByCustomer.mockResolvedValue(null)
    mockedUpsert.mockResolvedValue()
    mockedInsert.mockResolvedValue()
    mockedHasProcessed.mockResolvedValue(false)
  })

  it('rejects missing signature', async () => {
    mockedVerify.mockReturnValue(false)
    const res = await request(app).post('/api/webhooks/lemonsqueezy').send({ meta: { event_name: 'subscription_created' } })
    expect(res.status).toBe(400)
  })

  it('subscription_created upgrades user', async () => {
    const res = await request(app)
      .post('/api/webhooks/lemonsqueezy')
      .set('X-LemonSqueezy-Signature', 'sig')
      .send({
        meta: { event_name: 'subscription_created', custom_data: { user_id: 'sub-1' } },
        data: { id: '12345', attributes: { renews_at: '2026-11-01T00:00:00Z' } },
      })
    expect(res.status).toBe(200)
    expect(mockedUpsert).toHaveBeenCalledWith(expect.objectContaining({ licenseTier: 'pro', subscriptionStatus: 'active' }))
  })
})
