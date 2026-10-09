import { Router, type Request, type RequestHandler } from 'express'
import { verifyXenditWebhookToken, getPlan, billingPeriodMsFor } from '../lib/xendit.js'
import {
  getUserByXenditSubscriptionId,
  getUserByCheckoutSessionId,
  getUser,
  upsertUser,
  insertEventProcessed,
  hasProcessedEvent,
  type UserRecord,
} from '../repo.js'
import { PAST_DUE_GRACE_MS } from '../license.js'
import { xenditEnabled } from '../env.js'

const router = Router()

interface XenditWebhookPayload {
  event?: unknown
  data?: Record<string, unknown>
}

export const webhookBodyParser: RequestHandler = (req, _res, next) => {
  const body = req.body
  if (Buffer.isBuffer(body)) {
    req.body = body.toString('utf8')
  }
  next()
}

function parsePayload(body: unknown): XenditWebhookPayload | null {
  if (!body) return null
  if (typeof body === 'string') {
    try {
      return JSON.parse(body) as XenditWebhookPayload
    } catch {
      return null
    }
  }
  if (Buffer.isBuffer(body)) {
    try {
      return JSON.parse(body.toString('utf8')) as XenditWebhookPayload
    } catch {
      return null
    }
  }
  if (typeof body === 'object') return body as XenditWebhookPayload
  return null
}

function stringField(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function scheduleOf(data: Record<string, unknown>): { interval?: string; intervalCount?: number } {
  const schedule = data.schedule as { interval?: unknown; interval_count?: unknown } | undefined
  const interval = typeof schedule?.interval === 'string' ? schedule.interval : undefined
  const intervalCount =
    typeof schedule?.interval_count === 'number' ? schedule.interval_count : undefined
  return { interval, intervalCount }
}

async function resolveUserId(data: Record<string, unknown>): Promise<string | null> {
  const referenceId = stringField(data.reference_id)
  if (referenceId) return referenceId
  const externalId = stringField(data.external_id)
  if (externalId) return externalId
  const planId = stringField(data.plan_id)
  if (planId) {
    const user = await getUserByXenditSubscriptionId(planId)
    if (user) return user.userId
  }
  const id = stringField(data.id)
  if (id) {
    const bySession = await getUserByCheckoutSessionId(id)
    if (bySession) return bySession.userId
    const bySubscription = await getUserByXenditSubscriptionId(id)
    if (bySubscription) return bySubscription.userId
  }
  return null
}

function periodEndFrom(source: Record<string, unknown>): string | null {
  for (const key of ['paid_to', 'period_end', 'period_ends_at', 'next_billing_cycle_at']) {
    const raw = stringField(source[key])
    if (!raw) continue
    const parsed = Date.parse(raw)
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString()
  }
  return null
}

function proUntilFrom(source: Record<string, unknown>, periodMs: number, now = Date.now()): string {
  return periodEndFrom(source) ?? new Date(now + periodMs).toISOString()
}

async function planIdOf(data: Record<string, unknown>): Promise<string | null> {
  const direct = stringField(data.id) ?? stringField(data.plan_id)
  if (direct) return direct
  const plan = data.plan as { id?: unknown } | undefined
  return stringField(plan?.id)
}

router.post('/', async (req: Request, res) => {
  if (!xenditEnabled) {
    res.status(503).json({ error: 'payments-not-configured' })
    return
  }
  const token = req.headers['x-callback-token']
  if (!verifyXenditWebhookToken(typeof token === 'string' ? token : undefined)) {
    res.status(400).json({ error: 'invalid-token' })
    return
  }

  const payload = parsePayload(req.body)
  if (!payload) {
    res.status(400).json({ error: 'invalid-body' })
    return
  }

  const eventName = stringField(payload.event)
  if (!eventName) {
    res.status(400).json({ error: 'invalid-event' })
    return
  }

  const data = payload.data ?? {}
  const dataId = stringField(data.id)
  const eventId = `xendit:${eventName}:${dataId ?? 'unknown'}`
  const userId = await resolveUserId(data)
  if (!userId) {
    res.status(400).json({ error: 'unlinked-event' })
    return
  }

  if (await hasProcessedEvent(eventId)) {
    res.status(200).json({ received: true, duplicate: true })
    return
  }

  const existing = await getUser(userId)
  const user: UserRecord = {
    userId,
    email: existing?.email ?? '',
    licenseTier: existing?.licenseTier ?? 'free',
    subscriptionStatus: existing?.subscriptionStatus ?? 'none',
    xenditSubscriptionId: existing?.xenditSubscriptionId ?? null,
    xenditCheckoutSessionId: existing?.xenditCheckoutSessionId ?? null,
    lemonsqueezySubscriptionId: existing?.lemonsqueezySubscriptionId ?? null,
    lemonsqueezyCheckoutId: existing?.lemonsqueezyCheckoutId ?? null,
    lemonsqueezyCustomerId: existing?.lemonsqueezyCustomerId ?? null,
    lemonsqueezyVariantId: existing?.lemonsqueezyVariantId ?? null,
    graceEndsAt: existing?.graceEndsAt ?? null,
    proUntil: existing?.proUntil ?? null,
    lastVerifiedAt: existing?.lastVerifiedAt ?? null,
  }

  let refetched: Record<string, unknown> | null = null
  if (eventName === 'recurring.plan.activated' || eventName === 'recurring.plan.inactivated') {
    const planId = await planIdOf(data)
    if (planId) {
      try {
        refetched = (await getPlan(planId)) as unknown as Record<string, unknown>
      } catch {
        refetched = null
      }
    }
  }
  const source = refetched ?? data
  const { interval, intervalCount } = scheduleOf(source)
  const periodMs = billingPeriodMsFor(interval, intervalCount)

  switch (eventName) {
    case 'recurring.plan.activated': {
      const planId = stringField(source.id) ?? stringField(data.id)
      user.subscriptionStatus = 'active'
      user.licenseTier = 'pro'
      if (planId) user.xenditSubscriptionId = planId
      user.xenditCheckoutSessionId = null
      user.graceEndsAt = null
      user.proUntil = proUntilFrom(source, periodMs)
      break
    }
    case 'recurring.cycle.succeeded':
      user.subscriptionStatus = 'active'
      user.licenseTier = 'pro'
      user.graceEndsAt = null
      user.proUntil = proUntilFrom(source, periodMs)
      break
    case 'recurring.cycle.failed':
    case 'recurring.cycle.force_attempt_failed':
      user.subscriptionStatus = 'past_due'
      user.graceEndsAt = new Date(Date.now() + PAST_DUE_GRACE_MS).toISOString()
      break
    case 'recurring.cycle.retrying':
      user.subscriptionStatus = 'past_due'
      if (!user.graceEndsAt) {
        user.graceEndsAt = new Date(Date.now() + PAST_DUE_GRACE_MS).toISOString()
      }
      break
    case 'recurring.cycle.created':
      break
    case 'recurring.plan.inactivated':
      user.subscriptionStatus = 'canceled'
      if (!user.proUntil) {
        user.proUntil = proUntilFrom(source, periodMs)
      }
      break
    case 'invoice.paid':
      break
    default:
      console.log(`xendit webhook: unmapped event ${eventName}`)
      res.status(200).json({ received: true })
      return
  }

  await upsertUser(user)
  await insertEventProcessed(eventId, userId)
  res.status(200).json({ received: true })
})

export default router