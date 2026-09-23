import { Router } from 'express'
import { z } from 'zod'
import { verifyGoogleToken, GoogleTokenError } from '../lib/google.js'
import { signAppToken } from '../lib/jwt.js'
import {
  bindInstallation,
  countInstallations,
  deleteInstallations,
  getUser,
  oldestInstallations,
  upsertUser,
  type UserRecord,
} from '../repo.js'
import { MAX_DEVICE_BINDINGS, trialEndFor } from '../license.js'
import { rateLimit } from '../middleware/rate-limit.js'

const VerifyBody = z.object({
  instId: z.string().min(8).max(128),
})

const router = Router()

router.post(
  '/verify',
  rateLimit(10, 5 * 60_000, (req) => `verify:${req.ip}:${req.userId ?? 'anon'}`),
  async (req, res) => {
    const parsed = VerifyBody.safeParse(req.body ?? {})
    if (!parsed.success) {
      res.status(400).json({ error: 'invalid-body' })
      return
    }
    const header = req.headers.authorization
    const googleToken = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined
    if (!googleToken) {
      res.status(400).json({ error: 'missing-google-token' })
      return
    }

    let googleUser
    try {
      googleUser = await verifyGoogleToken(googleToken)
    } catch (error) {
      if (error instanceof GoogleTokenError) {
        res.status(401).json({ error: error.message })
        return
      }
      throw error
    }

    const { sub, email } = googleUser
    const now = new Date().toISOString()
    let user = await getUser(sub)
    if (!user) {
      const fresh: UserRecord = {
        userId: sub,
        email,
        licenseTier: 'free',
        subscriptionStatus: 'none',
        xenditSubscriptionId: null,
        graceEndsAt: null,
        proUntil: null,
        lastVerifiedAt: now,
      }
      await upsertUser(fresh)
      user = fresh
    } else {
      await upsertUser({ ...user, email, lastVerifiedAt: now })
    }

    await bindInstallation(sub, parsed.data.instId)
    const installs = await countInstallations(sub)
    if (installs > MAX_DEVICE_BINDINGS) {
      const excess = installs - MAX_DEVICE_BINDINGS
      const oldest = await oldestInstallations(sub, excess)
      await deleteInstallations(
        sub,
        oldest.map((row) => row.instId),
      )
    }

    const appToken = signAppToken({ scope: 'app', sub, instId: parsed.data.instId })

    res.status(200).json({
      userId: sub,
      email,
      licenseTier: user.licenseTier,
      trialEnd: trialEndFor(user),
      token: appToken,
    })
  },
)

export default router