import { timingSafeEqual } from 'node:crypto'
import { env } from '../env.js'

const BASE_URL = 'https://api.xendit.co'
const API_VERSION = '2026-01-01'

export type SubscriptionInterval = 'monthly' | 'yearly'

export interface CreatedSubscription {
  id: string
  checkoutUrl: string
}

export function isPlanId(value: string | null | undefined): value is string {
  if (!value) return false
  return value.startsWith('repl_')
}

export interface XenditPlan {
  id: string
  reference_id: string
  status?: string
  schedule?: { interval?: string; interval_count?: number }
}

export class XenditError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'XenditError'
  }
}

function basicAuth(): string {
  return `Basic ${Buffer.from(`${env.xenditSecretKey}:`).toString('base64')}`
}

async function xenditFetch<T>(path: string, init: RequestInit): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      Authorization: basicAuth(),
      'Content-Type': 'application/json',
      'api-version': API_VERSION,
      ...init.headers,
    },
  })
  if (!res.ok) {
    throw new XenditError(`xendit-api-error ${res.status}`)
  }
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

export function verifyXenditWebhookToken(header: string | undefined): boolean {
  const supplied = header ?? ''
  const expected = env.xenditWebhookToken
  const suppliedBuffer = Buffer.from(supplied)
  const expectedBuffer = Buffer.from(expected)
  if (suppliedBuffer.length !== expectedBuffer.length) return false
  return timingSafeEqual(suppliedBuffer, expectedBuffer)
}

export async function createSubscription(params: {
  referenceId: string
  email: string
  interval: SubscriptionInterval
}): Promise<CreatedSubscription> {
  const { referenceId, email, interval } = params
  const amount =
    interval === 'yearly' ? env.xenditPriceProYearlyMinor : env.xenditPriceProMonthlyMinor
  const session = await xenditFetch<{ id: string; payment_link_url?: string | null }>('/sessions', {
    method: 'POST',
    body: JSON.stringify({
      reference_id: referenceId,
      session_type: 'SUBSCRIPTION',
      mode: 'PAYMENT_LINK',
      amount,
      currency: env.xenditCurrency,
      country: env.xenditCountry,
      description: `ai-account-switcher pro ${interval}`,
      customer: { reference_id: referenceId, type: 'INDIVIDUAL', email },
      subscription: {
        schedule: {
          interval: interval === 'monthly' ? 'MONTH' : 'YEAR',
          interval_count: 1,
          failed_attempt_notifications: [1, 2, 3],
          retry_interval: 'DAY',
          retry_interval_count: 1,
          total_retry: 3,
        },
        failed_cycle_action: 'RESUME',
      },
      success_return_url: `${env.appBaseUrl}/checkout-complete`,
      cancel_return_url: `${env.appBaseUrl}/checkout-complete`,
    }),
  })
  if (!session.id) throw new XenditError('xendit-no-session-id')
  if (!session.payment_link_url) throw new XenditError('xendit-no-checkout-url')
  return { id: session.id, checkoutUrl: session.payment_link_url }
}

export async function getPlan(planId: string): Promise<XenditPlan> {
  return xenditFetch<XenditPlan>(`/recurring/plans/${encodeURIComponent(planId)}`, { method: 'GET' })
}

export async function cancelSubscription(planId: string): Promise<void> {
  await xenditFetch(`/recurring/plans/${encodeURIComponent(planId)}/inactivate`, { method: 'POST' })
}

export function billingPeriodMsFor(interval?: string, intervalCount?: number): number {
  const count = intervalCount ?? 1
  if (interval === 'YEAR' || interval === 'yearly') return count * 365 * 24 * 60 * 60 * 1000
  if (interval === 'WEEK' || interval === 'weekly') return count * 7 * 24 * 60 * 60 * 1000
  return count * 30 * 24 * 60 * 60 * 1000
}