import { Router } from 'express'
import { requireAppToken } from '../middleware/auth.js'
import { rateLimit } from '../middleware/rate-limit.js'
import { getUser, upsertUser } from '../repo.js'
import { accountLimitFor, demoted, expiresAtFor, needsDemotion } from '../license.js'

const router = Router()

router.get(
  '/',
  requireAppToken,
  rateLimit(30, 60_000, (req) => `license:${req.userId ?? 'anon'}`),
  async (req, res) => {
    const user = await getUser(req.userId!)
    if (!user) {
      res.status(401).json({ error: 'user-not-found' })
      return
    }
    let effective = user
    if (needsDemotion(user)) {
      effective = demoted(user)
      await upsertUser(effective)
    }
    res.status(200).json({
      licenseTier: effective.licenseTier,
      subscriptionStatus: effective.subscriptionStatus,
      accountLimit: accountLimitFor(effective.licenseTier),
      expiresAt: expiresAtFor(effective),
    })
  },
)

export default router