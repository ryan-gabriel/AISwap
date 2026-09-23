import { Router } from 'express'
import { z } from 'zod'
import { requireAppToken } from '../middleware/auth.js'
import { rateLimit } from '../middleware/rate-limit.js'
import { getUser, upsertUser } from '../repo.js'
import { createSubscription, type SubscriptionInterval } from '../lib/xendit.js'
import { env } from '../env.js'

const UpgradeQuery = z.object({
  interval: z.enum(['monthly', 'yearly']).optional().default('monthly'),
})

const router = Router()

router.get(
  '/',
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
  const planId =
    interval === 'yearly' ? env.xenditPlanProYearly : env.xenditPlanProMonthly

  const subscription = await createSubscription({
    planId,
    referenceId: user.userId,
    email: user.email,
    interval,
  })

  if (user.xenditSubscriptionId !== planId) {
    await upsertUser({ ...user, xenditSubscriptionId: planId })
  }

  res.status(200).json({ checkoutUrl: subscription.checkoutUrl })
  },
)

export default router