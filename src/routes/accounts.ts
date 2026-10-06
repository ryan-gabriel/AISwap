import { Router } from 'express'
import { z } from 'zod'
import { requireAppToken } from '../middleware/auth.js'
import { getUser, countAccounts, countAccountsForAdapter, syncUserAccounts } from '../repo.js'
import { isAccountSaveAllowed, FREE_ACCOUNT_LIMIT } from '../license.js'

const SaveBody = z.object({
  adapterId: z.enum(['claude', 'chatgpt', 'gemini', 'perplexity']),
  accountIds: z.array(z.string().min(1).max(64)).max(200).optional().default([]),
})

const router = Router()

router.post('/save', requireAppToken, async (req, res) => {
  const parsed = SaveBody.safeParse(req.body ?? {})
  if (!parsed.success) {
    res.status(400).json({ error: 'invalid-body' })
    return
  }
  const userId = req.userId!
  const user = await getUser(userId)
  if (!user) {
    res.status(401).json({ error: 'user-not-found' })
    return
  }

  const currentTotal = await countAccounts(userId)
  const adapterCount = await countAccountsForAdapter(userId, parsed.data.adapterId)
  const projected = currentTotal - adapterCount + parsed.data.accountIds.length

  if (!isAccountSaveAllowed(user, projected)) {
    res.status(403).json({ allowed: false, reason: 'free-limit', limit: FREE_ACCOUNT_LIMIT })
    return
  }

  const serverCount = await syncUserAccounts(userId, parsed.data.adapterId, parsed.data.accountIds)
  res.status(200).json({ allowed: true, accountCount: serverCount })
})

export default router