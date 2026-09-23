import { Router } from 'express'
import { signAppToken, verifyAppTokenForRefresh } from '../lib/jwt.js'
import { getInstallation } from '../repo.js'
import { rateLimit } from '../middleware/rate-limit.js'

const router = Router()

router.post(
  '/',
  rateLimit(10, 60_000, (_req) => 'refresh'),
  async (req, res) => {
    const header = req.headers.authorization
    const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined
    if (!token) {
      res.status(401).json({ error: 'missing-token' })
      return
    }
    let payload
    try {
      payload = verifyAppTokenForRefresh(token)
    } catch {
      res.status(401).json({ error: 'invalid-token' })
      return
    }
    const installation = await getInstallation(payload.instId)
    if (!installation || installation.userId !== payload.sub) {
      res.status(401).json({ error: 'invalid-token' })
      return
    }
    const fresh = signAppToken({ scope: 'app', sub: payload.sub, instId: payload.instId })
    res.status(200).json({ token: fresh })
  },
)

export default router