import { Router, type Request, type RequestHandler } from 'express'
import {
  verifyLemonSqueezySignature,
  getSubscription,
} from '../lib/lemonsqueezy.js'
import {
  getUser,
  getUserByLemonSqueezySubscriptionId,
  getUserByLemonSqueezyCheckoutId,
  getUserByLemonSqueezyCustomerId,
  upsertUser,
  insertEventProcessed,
  hasProcessedEvent,
  type UserRecord,
} from '../repo.js'
import { PAST_DUE_GRACE_MS } from '../license.js'
import { lemonSqueezyEnabled } from '../env.js'

const router = Router()

interface LemonSqueezyWebhookPayload {
  meta?: Record<string, unknown>
  data?: Record<string, unknown>
}

function parsePayload(body: unknown): LemonSqueezyWebhookPayload | null {
  if (!body) return null
  if (typeof body === 'string') {
    try {
      return JSON.parse(body) as LemonSqueezyWebhookPayload
    } catch {
      return null
    }
  }
  if (Buffer.isBuffer(body)) {
    try {
      return JSON.parse(body.toString('utf8')) as LemonSqueezyWebhookPayload
    } catch {
      return null
    }
  }
  if (typeof body === 'object') return body as LemonSqueezyWebhookPayload
  return null
}

function stringField(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function getHeader(req: Request, name: string): string | undefined {
  const v = req.headers[name.toLowerCase()]
  if (Array.isArray(v)) return v[0]
  return v
}

function isoFrom(value: unknown): string | null {
  const raw = stringField(value)
  if (!raw) return null
  const parsed = Date.parse(raw)
  if (!Number.isFinite(parsed)) return null
  return new Date(parsed).toISOString()
}

async function resolveUserId(data: Record<string, unknown>, meta: Record<string, unknown>): Promise<string | null> {
  const custom = meta?.custom_data as Record<string, unknown> | undefined
  const userIdFromCustom = stringField(custom?.user_id)
  if (userIdFromCustom) return userIdFromCustom

  const subId = stringField(data?.id)
  if (subId) {
    const bySub = await getUserByLemonSqueezySubscriptionId(subId)
    if (bySub) return bySub.userId
  }
  const relationships = data?.relationships as Record<string, unknown> | undefined
  const checkout = relationships?.checkout as { data?: { id?: unknown } } | undefined
  const checkoutId = stringField(checkout?.data?.id)
  if (checkoutId) {
    const byCheckout = await getUserByLemonSqueezyCheckoutId(checkoutId)
    if (byCheckout) return byCheckout.userId
  }
  const customer = relationships?.customer as { data?: { id?: unknown } } | undefined
  const customerId = stringField(customer?.data?.id)
  if (customerId) {
    const byCustomer = await getUserByLemonSqueezyCustomerId(customerId)
    if (byCustomer) return byCustomer.userId
  }
  return null
}

router.post('/', async (req: Request, res) => {
  if (!lemonSqueezyEnabled) {
    res.status(503).json({ error: 'payments-not-configured' })
    return
  }
  const rawBody = req.body
  const sig = getHeader(req, 'x-lemonsqueezy-signature') || getHeader(req, 'x-signature')
  if (!verifyLemonSqueezySignature(rawBody as any, sig)) {
    res.status(400).json({ error: 'invalid-signature' })
    return
  }

  const payload = parsePayload(rawBody)
  if (!payload) {
    res.status(400).json({ error: 'invalid-body' })
    return
  }

  const meta = payload.meta ?? {}
  const eventName = stringField(meta.event_name)
  if (!eventName) {
    res.status(400).json({ error: 'invalid-event' })
    return
  }

  const data = payload.data ?? {}
  const dataId = stringField(data.id)
  const eventId = `lemonsqueezy:${eventName}:${dataId ?? 'unknown'}`

  const userId = await resolveUserId(data, meta)
  if (!userId) {
    res.status(400).json({ error: 'unlinked-event' })
    return
  }

  if (await hasProcessedEvent(eventId)) {
    res.status(200).json({ received: true, duplicate: true })
    return
  }

  const existing = await getUser(userId)
  const now = Date.now()

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

  const attributes = (data.attributes ?? {}) as Record<string, unknown>

  if (eventName === 'subscription_created') {
    const subId = stringField(data.id)
    const customerId = stringField((data.relationships as any)?.customer?.data?.id)
    const variantId = stringField((data.relationships as any)?.variant?.data?.id)
    user.lemonsqueezySubscriptionId = subId ?? user.lemonsqueezySubscriptionId
    user.lemonsqueezyCustomerId = customerId ?? user.lemonsqueezyCustomerId
    user.lemonsqueezyVariantId = variantId ?? user.lemonsqueezyVariantId
    user.lemonsqueezyCheckoutId = null
    user.subscriptionStatus = 'active'
    user.licenseTier = 'pro'
    user.graceEndsAt = null
    const renewsAt = isoFrom(attributes.renews_at)
    const endsAt = isoFrom(attributes.ends_at)
    user.proUntil = renewsAt ?? endsAt ?? new Date(now).toISOString()
  } else if (eventName === 'subscription_updated') {
    const status = stringField(attributes.status)
    if (status === 'active') {
      user.subscriptionStatus = 'active'
      user.licenseTier = 'pro'
      user.graceEndsAt = null
      const renewsAt = isoFrom(attributes.renews_at)
      if (renewsAt) user.proUntil = renewsAt
    } else if (status === 'past_due' || status === 'paused' || status === 'unpaid') {
      user.subscriptionStatus = 'past_due'
      if (user.licenseTier !== 'free') {
        user.licenseTier = 'pro'
      }
      const existingGrace = existing?.graceEndsAt ? Date.parse(existing.graceEndsAt) : NaN
      if (Number.isNaN(existingGrace) || existingGrace < now) {
        user.graceEndsAt = new Date(now + PAST_DUE_GRACE_MS).toISOString()
      }
    }
  } else if (eventName === 'subscription_cancelled') {
    user.subscriptionStatus = 'canceled'
    if (user.licenseTier !== 'free') {
      user.licenseTier = 'pro'
    }
    const endsAt = isoFrom(attributes.ends_at)
    if (endsAt) user.proUntil = endsAt
  } else if (eventName === 'subscription_expired') {
    user.subscriptionStatus = 'expired'
    user.licenseTier = 'free'
    const endsAt = isoFrom(attributes.ends_at)
    if (endsAt) {
      user.proUntil = endsAt
    } else {
      user.proUntil = new Date(now).toISOString()
    }
    user.graceEndsAt = null
  } else if (eventName === 'subscription_resumed') {
    user.subscriptionStatus = 'active'
    user.licenseTier = 'pro'
    user.graceEndsAt = null
    const renewsAt = isoFrom(attributes.renews_at)
    if (renewsAt) user.proUntil = renewsAt
  } else if (eventName === 'order_refunded') {
    user.subscriptionStatus = 'refunded'
    user.licenseTier = 'free'
    user.proUntil = new Date(now).toISOString()
    user.graceEndsAt = null
  } else {
    console.log(`lemonsqueezy webhook: unmapped event ${eventName}`)
  }

  await upsertUser(user)
  await insertEventProcessed(eventId, userId)

  res.status(200).json({ received: true })
})

export default router
