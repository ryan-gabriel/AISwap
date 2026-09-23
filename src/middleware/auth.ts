import type { NextFunction, Request, Response } from 'express'
import { verifyAppToken } from '../lib/jwt.js'
import { getInstallation } from '../repo.js'

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId?: string
      instId?: string
    }
  }
}

export async function requireAppToken(req: Request, res: Response, next: NextFunction): Promise<void> {
  const header = req.headers.authorization
  const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined
  if (!token) {
    res.status(401).json({ error: 'missing-token' })
    return
  }
  let payload
  try {
    payload = verifyAppToken(token)
  } catch {
    res.status(401).json({ error: 'invalid-token' })
    return
  }
  const installation = await getInstallation(payload.instId)
  if (!installation || installation.userId !== payload.sub) {
    res.status(401).json({ error: 'invalid-token' })
    return
  }
  req.userId = payload.sub
  req.instId = payload.instId
  next()
}