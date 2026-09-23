import { Router } from 'express'
import { requireAppToken } from '../middleware/auth.js'
import { rateLimit } from '../middleware/rate-limit.js'
import { getUser, upsertUser } from '../repo.js'
import { cancelSubscription, isPlanId } from '../lib/xendit.js'

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
  if (!isPlanId(user.xenditSubscriptionId)) {
    res.status(400).json({ error: 'no-subscription' })
    return
  }
  if (user.subscriptionStatus === 'canceled') {
    res.status(200).json({ ok: true })
    return
  }
  try {
    await cancelSubscription(user.xenditSubscriptionId)
  } catch {
    res.status(502).json({ error: 'xendit-cancel-failed' })
    return
  }
  await upsertUser({ ...user, subscriptionStatus: 'canceled' })
  res.status(200).json({ ok: true })
  },
)

export default router