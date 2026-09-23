import { Router } from 'express'
import { requireAppToken } from '../middleware/auth.js'
import { deleteInstallations } from '../repo.js'

const router = Router()

router.post('/', requireAppToken, async (req, res) => {
  await deleteInstallations(req.userId!, [req.instId!])
  res.status(200).json({ ok: true })
})

export default router