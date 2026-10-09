import { Router } from 'express'
import { requireAppToken } from '../middleware/auth.js'
import { rateLimit } from '../middleware/rate-limit.js'
import { getUser, upsertUser } from '../repo.js'
import { cancelSubscription as cancelLemonSqueezy } from '../lib/lemonsqueezy.js'
import { cancelSubscription as cancelXendit, isPlanId } from '../lib/xendit.js'
import { lemonSqueezyEnabled, xenditEnabled } from '../env.js'

const router = Router()

router.post(
  '/cancel',
  requireAppToken,
  rateLimit(10, 60_000, (req) => `cancel:${req.userId ?? 'anon'}`),
  async (req, res) => {
  const user = await getUser(req.userId!)
  if (!user) {
    res.status(401).json({ error: 'user-not-found' })
    return
  }
  if (user.subscriptionStatus === 'canceled') {
    res.status(200).json({ ok: true })
    return
  }

  if (user.lemonsqueezySubscriptionId) {
    if (!lemonSqueezyEnabled) {
      res.status(503).json({ error: 'payments-not-configured' })
      return
    }
    try {
      await cancelLemonSqueezy(user.lemonsqueezySubscriptionId)
    } catch {
      res.status(502).json({ error: 'cancel-failed' })
      return
    }
    await upsertUser({ ...user, subscriptionStatus: 'canceled' })
    res.status(200).json({ ok: true })
    return
  }

  if (isPlanId(user.xenditSubscriptionId)) {
    if (!xenditEnabled) {
      res.status(503).json({ error: 'payments-not-configured' })
      return
    }
    try {
      await cancelXendit(user.xenditSubscriptionId)
    } catch {
      res.status(502).json({ error: 'cancel-failed' })
      return
    }
    await upsertUser({ ...user, subscriptionStatus: 'canceled' })
    res.status(200).json({ ok: true })
    return
  }

  res.status(400).json({ error: 'no-subscription' })
  },
)

export default router