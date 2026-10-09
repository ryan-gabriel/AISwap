import { Router, type RequestHandler } from 'express'
import { z } from 'zod'
import { requireAppToken } from '../middleware/auth.js'
import { rateLimit } from '../middleware/rate-limit.js'
import { getUser, upsertUser } from '../repo.js'
import { createCheckout } from '../lib/lemonsqueezy.js'
import type { SubscriptionInterval } from '../lib/lemonsqueezy.js'
import { lemonSqueezyEnabled } from '../env.js'

const UpgradeQuery = z.object({
  interval: z.enum(['monthly', 'yearly']).optional().default('monthly'),
})

const router = Router()

const requirePayments: RequestHandler = (_req, res, next) => {
  if (!lemonSqueezyEnabled) {
    res.status(503).json({ error: 'payments-not-configured' })
    return
  }
  next()
}

router.get(
  '/',
  requirePayments,
  requireAppToken,
  rateLimit(10, 60_000, (req) => `upgrade:${req.userId ?? 'anon'}`),
  async (req, res) => {
  const parsed = UpgradeQuery.safeParse(req.query ?? {})
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid-query' })
    return
  }
  const user = await getUser(req.userId!)
  if (!user) {
    res.status(401).json({ error: 'user-not-found' })
    return
  }

  if (user.subscriptionStatus === 'active' || user.subscriptionStatus === 'past_due') {
    res.status(409).json({ error: 'already-subscribed' })
    return
  }

  const interval = parsed.data.interval as SubscriptionInterval
  const checkout = await createCheckout({
    userId: user.userId,
    email: user.email,
    interval,
  })

  await upsertUser({ ...user, lemonsqueezyCheckoutId: checkout.id })

  res.status(200).json({ checkoutUrl: checkout.checkoutUrl })
  },
)

export default router