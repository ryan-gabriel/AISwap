import { beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'
import type { UserRecord } from '../src/repo.js'

vi.mock('../src/lib/xendit.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../src/lib/xendit.js')>()
  return {
    ...mod,
    verifyXenditWebhookToken: vi.fn(),
    getPlan: vi.fn(),
  }
})

vi.mock('../src/repo.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../src/repo.js')>()
  return {
    ...mod,
    getUser: vi.fn(),
    getUserByXenditSubscriptionId: vi.fn(),
    getUserByCheckoutSessionId: vi.fn(),
    upsertUser: vi.fn(),
    insertEventProcessed: vi.fn(),
    hasProcessedEvent: vi.fn(),
  }
})

import { verifyXenditWebhookToken, getPlan } from '../src/lib/xendit.js'
import {
  getUser,
  getUserByXenditSubscriptionId,
  getUserByCheckoutSessionId,
  upsertUser,
  insertEventProcessed,
  hasProcessedEvent,
} from '../src/repo.js'
import { createApp } from '../src/app.js'

const mockedVerify = vi.mocked(verifyXenditWebhookToken)
const mockedGetPlan = vi.mocked(getPlan)
const mockedGetUser = vi.mocked(getUser)
const mockedFindBySub = vi.mocked(getUserByXenditSubscriptionId)
const mockedFindBySession = vi.mocked(getUserByCheckoutSessionId)
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

const TOKEN = 'valid-token'

function payload(event: string, data: Record<string, unknown>): string {
  return JSON.stringify({ event, business_id: 'biz-1', created: '2026-01-01T00:00:00Z', data })
}

function post(event: string, data: Record<string, unknown>, overrides: Record<string, string> = {}): request.Test {
  return request(createApp())
    .post('/api/webhooks/xendit')
    .set('Content-Type', 'application/json')
    .set('x-callback-token', TOKEN)
    .set(overrides)
    .send(payload(event, data))
}

beforeEach(() => {
  vi.clearAllMocks()
  mockedVerify.mockImplementation((header: string | undefined) => header === TOKEN)
  mockedInsert.mockResolvedValue(true)
  mockedHasProcessed.mockResolvedValue(false)
  mockedGetUser.mockResolvedValue(makeUser())
  mockedFindBySub.mockResolvedValue(null)
  mockedFindBySession.mockResolvedValue(null)
})

describe('POST /api/webhooks/xendit verification', () => {
  it('rejects a missing x-callback-token with 400', async () => {
    const res = await request(createApp())
      .post('/api/webhooks/xendit')
      .set('Content-Type', 'application/json')
      .send(payload('recurring.plan.activated', { reference_id: 'sub-1', id: 'plan-1' }))

    expect(res.status).toBe(400)
    expect(mockedInsert).not.toHaveBeenCalled()
  })

  it('rejects when the token does not match', async () => {
    mockedVerify.mockReturnValue(false)
    const res = await post('recurring.plan.activated', { reference_id: 'sub-1', id: 'plan-1' })
    expect(res.status).toBe(400)
    expect(mockedInsert).not.toHaveBeenCalled()
  })

  it('rejects a malformed body with 400', async () => {
    const res = await request(createApp())
      .post('/api/webhooks/xendit')
      .set('Content-Type', 'application/json')
      .set('x-callback-token', TOKEN)
      .send('not-json')
    expect(res.status).toBe(400)
  })

  it('returns 400 unlinked-event when the payload has no user mapping', async () => {
    const res = await post('recurring.cycle.created', { id: 'cycle-1' })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe('unlinked-event')
  })

  it('resolves via external_id when reference_id is absent', async () => {
    const res = await post('recurring.cycle.created', {
      id: 'cycle-1',
      plan_id: 'plan-1',
      external_id: 'sub-1',
    })

    expect(res.status).toBe(200)
    expect(mockedUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'sub-1' }),
    )
  })
})

describe('POST /api/webhooks/xendit license transitions', () => {
  it('acknowledges a duplicate event without reprocessing', async () => {
    mockedHasProcessed.mockResolvedValue(true)
    const res = await post('recurring.plan.activated', { reference_id: 'sub-1', id: 'plan-1' })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ received: true, duplicate: true })
    expect(mockedUpsert).not.toHaveBeenCalled()
    expect(mockedInsert).not.toHaveBeenCalled()
  })

  it('marks the event processed only after the user is updated', async () => {
    const res = await post('recurring.plan.activated', {
      reference_id: 'sub-1',
      id: 'plan-1',
      schedule: { interval: 'MONTH', interval_count: 1 },
    })

    expect(res.status).toBe(200)
    expect(mockedUpsert).toHaveBeenCalled()
    const insertOrder = mockedInsert.mock.invocationCallOrder[0]
    const upsertOrder = mockedUpsert.mock.invocationCallOrder[0]
    expect(insertOrder).toBeGreaterThan(upsertOrder)
    expect(mockedInsert).toHaveBeenCalledWith('xendit:recurring.plan.activated:plan-1', 'sub-1')
  })

  it('a concurrent duplicate insert cannot overwrite a newer update', async () => {
    mockedHasProcessed.mockResolvedValue(false)
    mockedInsert.mockResolvedValue(false)
    const res = await post('recurring.plan.activated', {
      reference_id: 'sub-1',
      id: 'plan-1',
      schedule: { interval: 'MONTH', interval_count: 1 },
    })

    expect(res.status).toBe(200)
    expect(mockedUpsert).toHaveBeenCalled()
  })

  it('recurring.plan.activated upgrades the user and links the plan', async () => {
    mockedGetUser.mockResolvedValue(
      makeUser({ xenditCheckoutSessionId: 'ps-pending-session' }),
    )
    mockedGetPlan.mockResolvedValue({
      id: 'plan-1',
      reference_id: 'sub-1',
      status: 'ACTIVE',
      schedule: { interval: 'MONTH', interval_count: 1 },
    })
    const res = await post('recurring.plan.activated', {
      reference_id: 'sub-1',
      id: 'plan-1',
      schedule: { interval: 'MONTH', interval_count: 1 },
    })

    expect(res.status).toBe(200)
    expect(mockedUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        licenseTier: 'pro',
        subscriptionStatus: 'active',
        xenditSubscriptionId: 'plan-1',
        xenditCheckoutSessionId: null,
      }),
    )
  })

  it('links an event by checkout session id when reference_id is absent', async () => {
    mockedFindBySession.mockResolvedValue(makeUser())
    const res = await post('recurring.cycle.created', {
      id: 'ps-pending-session',
      plan_id: 'plan-1',
    })

    expect(res.status).toBe(200)
    expect(mockedFindBySession).toHaveBeenCalledWith('ps-pending-session')
    expect(mockedUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'sub-1' }),
    )
  })

  it('recurring.cycle.succeeded keeps the user active', async () => {
    mockedGetUser.mockResolvedValue(
      makeUser({ licenseTier: 'pro', subscriptionStatus: 'active', xenditSubscriptionId: 'plan-1' }),
    )
    const res = await post('recurring.cycle.succeeded', {
      reference_id: 'sub-1',
      id: 'cycle-1',
      plan_id: 'plan-1',
    })

    expect(res.status).toBe(200)
    expect(mockedUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ licenseTier: 'pro', subscriptionStatus: 'active', graceEndsAt: null }),
    )
  })

  it('cycle.succeeded prefers a payload period end over now + period', async () => {
    mockedGetUser.mockResolvedValue(
      makeUser({ licenseTier: 'pro', subscriptionStatus: 'active', xenditSubscriptionId: 'plan-1' }),
    )
    const periodEnd = new Date(Date.now() + 25 * 24 * 60 * 60 * 1000).toISOString()
    const res = await post('recurring.cycle.succeeded', {
      reference_id: 'sub-1',
      id: 'cycle-1',
      plan_id: 'plan-1',
      period_end: periodEnd,
    })

    expect(res.status).toBe(200)
    expect(mockedUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ proUntil: periodEnd }),
    )
  })

  it('cycle.succeeded falls back to now + period when no period end is present', async () => {
    mockedGetUser.mockResolvedValue(
      makeUser({ licenseTier: 'pro', subscriptionStatus: 'active', xenditSubscriptionId: 'plan-1' }),
    )
    const before = Date.now()
    const res = await post('recurring.cycle.succeeded', {
      reference_id: 'sub-1',
      id: 'cycle-1',
      plan_id: 'plan-1',
    })

    expect(res.status).toBe(200)
    const updated = mockedUpsert.mock.calls[0]?.[0] as { proUntil: string }
    const proUntilMs = Date.parse(updated.proUntil)
    const expected = before + 30 * 24 * 60 * 60 * 1000
    expect(Math.abs(proUntilMs - expected)).toBeLessThanOrEqual(2000)
  })

  it('recurring.cycle.failed flags past_due with grace window', async () => {
    mockedGetUser.mockResolvedValue(
      makeUser({ licenseTier: 'pro', subscriptionStatus: 'active', xenditSubscriptionId: 'plan-1' }),
    )
    const res = await post('recurring.cycle.failed', {
      reference_id: 'sub-1',
      id: 'cycle-1',
      plan_id: 'plan-1',
    })

    expect(res.status).toBe(200)
    expect(mockedUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ subscriptionStatus: 'past_due', graceEndsAt: expect.any(String) }),
    )
  })

  it('recurring.cycle.force_attempt_failed also flags past_due', async () => {
    const res = await post('recurring.cycle.force_attempt_failed', {
      reference_id: 'sub-1',
      id: 'cycle-1',
      plan_id: 'plan-1',
    })
    expect(res.status).toBe(200)
    expect(mockedUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ subscriptionStatus: 'past_due' }),
    )
  })

  it('recurring.cycle.retrying keeps past_due and preserves grace', async () => {
    const grace = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString()
    mockedGetUser.mockResolvedValue(
      makeUser({ licenseTier: 'pro', subscriptionStatus: 'past_due', graceEndsAt: grace }),
    )
    const res = await post('recurring.cycle.retrying', {
      reference_id: 'sub-1',
      id: 'cycle-1',
      plan_id: 'plan-1',
    })

    expect(res.status).toBe(200)
    expect(mockedUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ subscriptionStatus: 'past_due', graceEndsAt: grace }),
    )
  })

  it('recurring.cycle.created is informational and changes nothing', async () => {
    const before = makeUser({ licenseTier: 'pro', subscriptionStatus: 'active' })
    mockedGetUser.mockResolvedValue(before)
    const res = await post('recurring.cycle.created', {
      reference_id: 'sub-1',
      id: 'cycle-1',
      plan_id: 'plan-1',
    })

    expect(res.status).toBe(200)
    expect(mockedUpsert).toHaveBeenCalledWith(before)
  })

  it('recurring.plan.inactivated marks canceled and keeps pro until period end', async () => {
    mockedGetUser.mockResolvedValue(makeUser({ licenseTier: 'pro', subscriptionStatus: 'active' }))
    const res = await post('recurring.plan.inactivated', {
      reference_id: 'sub-1',
      id: 'plan-1',
      schedule: { interval: 'MONTH', interval_count: 1 },
    })

    expect(res.status).toBe(200)
    expect(mockedUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ subscriptionStatus: 'canceled', licenseTier: 'pro' }),
    )
  })

  it('resolves a cycle event without reference_id via the stored plan id', async () => {
    mockedFindBySub.mockResolvedValue(
      makeUser({ licenseTier: 'pro', subscriptionStatus: 'active', xenditSubscriptionId: 'plan-1' }),
    )
    const res = await post('recurring.cycle.succeeded', {
      id: 'cycle-1',
      plan_id: 'plan-1',
    })

    expect(res.status).toBe(200)
    expect(mockedFindBySub).toHaveBeenCalledWith('plan-1')
    expect(mockedUpsert).toHaveBeenCalledWith(
      expect.objectContaining({ licenseTier: 'pro', subscriptionStatus: 'active', userId: 'sub-1' }),
    )
  })

  it('acknowledges and logs an unmapped event without writing a user', async () => {
    const res = await post('recurring.cycle.unknown_future_event', {
      reference_id: 'sub-1',
      id: 'x-1',
    })
    expect(res.status).toBe(200)
    expect(mockedUpsert).not.toHaveBeenCalled()
  })
})