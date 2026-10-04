import { Router } from 'express'
import { requireAppToken } from '../middleware/auth.js'
import { getUser } from '../repo.js'
import { signAppToken } from '../lib/jwt.js'
import { env } from '../env.js'

const router = Router()

router.get('/', requireAppToken, async (req, res) => {
  const user = await getUser(req.userId!)
  if (!user) {
    res.status(401).json({ error: 'user-not-found' })
    return
  }
  if (!user.lemonsqueezySubscriptionId && !user.xenditSubscriptionId) {
    res.status(400).json({ error: 'no-subscription' })
    return
  }
  const token = signAppToken({ scope: 'app', sub: user.userId, instId: req.instId! })
  const url = `${env.appBaseUrl}/account#token=${encodeURIComponent(token)}`
  res.status(200).json({ url })
})

export default router