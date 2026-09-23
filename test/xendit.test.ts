import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createSubscription,
  getPlan,
  cancelSubscription,
  verifyXenditWebhookToken,
  billingPeriodMsFor,
  XenditError,
} from '../src/lib/xendit.js'
import { env } from '../src/env.js'

function mockFetchOnce(status: number, body: unknown): void {
  const res = {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res))
}

describe('verifyXenditWebhookToken', () => {
  it('accepts the exact token', () => {
    expect(verifyXenditWebhookToken(env.xenditWebhookToken)).toBe(true)
  })

  it('rejects a different token', () => {
    expect(verifyXenditWebhookToken('wrong')).toBe(false)
  })

  it('rejects a missing header', () => {
    expect(verifyXenditWebhookToken(undefined)).toBe(false)
  })

  it('rejects a same-length different token via constant-time compare', () => {
    expect(verifyXenditWebhookToken('xnd_whtok_uni!')).toBe(false)
  })
})

describe('billingPeriodMsFor', () => {
  it('derives month, year, and week periods', () => {
    expect(billingPeriodMsFor('MONTH', 1)).toBe(1 * 30 * 24 * 60 * 60 * 1000)
    expect(billingPeriodMsFor('YEAR', 1)).toBe(1 * 365 * 24 * 60 * 60 * 1000)
    expect(billingPeriodMsFor('WEEK', 2)).toBe(2 * 7 * 24 * 60 * 60 * 1000)
  })

  it('defaults to monthly for unknown intervals', () => {
    expect(billingPeriodMsFor(undefined, undefined)).toBe(30 * 24 * 60 * 60 * 1000)
  })
})

describe('xendit client failures', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('createSubscription throws without a checkout url', async () => {
    mockFetchOnce(201, { id: 'session-1', payment_link_url: null })
    await expect(
      createSubscription({ planId: 'plan-1', referenceId: 'sub-1', email: 'a@b.com', interval: 'monthly' }),
    ).rejects.toThrow(XenditError)
  })

  it('throws an XenditError on a non-ok api response', async () => {
    mockFetchOnce(400, { message: 'bad request' })
    await expect(
      createSubscription({ planId: 'plan-1', referenceId: 'sub-1', email: 'a@b.com', interval: 'monthly' }),
    ).rejects.toThrow(XenditError)
  })
})

describe('xendit client success paths', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('creates a subscription and returns the hosted checkout url', async () => {
    mockFetchOnce(201, { id: 'session-1', payment_link_url: 'https://checkout.xendit.co/x' })
    const result = await createSubscription({
      planId: 'plan-1',
      referenceId: 'sub-1',
      email: 'a@b.com',
      interval: 'monthly',
    })
    expect(result).toEqual({ id: 'session-1', checkoutUrl: 'https://checkout.xendit.co/x' })
  })

  it('getPlan returns the recurring plan', async () => {
    mockFetchOnce(200, { id: 'plan-1', reference_id: 'sub-1', status: 'ACTIVE' })
    const plan = await getPlan('plan-1')
    expect(plan.id).toBe('plan-1')
    expect(plan.status).toBe('ACTIVE')
  })

  it('cancelSubscription succeeds on 200', async () => {
    mockFetchOnce(200, {})
    await expect(cancelSubscription('plan-1')).resolves.toBeUndefined()
  })
})

describe('xendit request construction', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('sends basic auth, api-version, and expected mount path for cancel', async () => {
    let captured: RequestInit | undefined
    const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) => {
      captured = init
      return {
        ok: true,
        status: 200,
        json: async () => ({}),
        text: async () => '{}',
      } as Response
    })
    vi.stubGlobal('fetch', fetchMock)

    await cancelSubscription('plan-1')
    const url = fetchMock.mock.calls[0]?.[0] as string
    expect(url).toBe('https://api.xendit.co/recurring/plans/plan-1/inactivate')
    expect(captured?.headers).toMatchObject({
      Authorization: expect.stringMatching(/^Basic /),
      'Content-Type': 'application/json',
      'api-version': '2026-01-01',
    })
    expect(captured?.method).toBe('POST')
  })

  it('builds the /sessions body with country and env-derived amount and currency', async () => {
    let captured: RequestInit | undefined
    const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) => {
      captured = init
      return {
        ok: true,
        status: 201,
        json: async () => ({ id: 'session-1', payment_link_url: 'https://checkout.xendit.co/x' }),
        text: async () => '{}',
      } as Response
    })
    vi.stubGlobal('fetch', fetchMock)

    await createSubscription({
      planId: 'plan-1',
      referenceId: 'sub-1',
      email: 'a@b.com',
      interval: 'monthly',
    })

    const url = fetchMock.mock.calls[0]?.[0] as string
    expect(url).toBe('https://api.xendit.co/sessions')
    const body = JSON.parse(String(captured?.body)) as Record<string, unknown>
    expect(body.session_type).toBe('SUBSCRIPTION')
    expect(body.amount).toBe(env.xenditPriceProMonthlyMinor)
    expect(body.currency).toBe(env.xenditCurrency)
    expect(body.country).toBe(env.xenditCountry)
    expect(body.country).toBe('ID')
  })

  it('derives the yearly amount from the yearly price env', async () => {
    let body: Record<string, unknown> | undefined
    const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) => {
      body = JSON.parse(String(init?.body)) as Record<string, unknown>
      return {
        ok: true,
        status: 201,
        json: async () => ({ id: 'session-1', payment_link_url: 'https://checkout.xendit.co/x' }),
        text: async () => '{}',
      } as Response
    })
    vi.stubGlobal('fetch', fetchMock)

    await createSubscription({
      planId: 'plan-1',
      referenceId: 'sub-1',
      email: 'a@b.com',
      interval: 'yearly',
    })

    expect(body?.amount).toBe(env.xenditPriceProYearlyMinor)
  })
})