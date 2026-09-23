import jwt from 'jsonwebtoken'
import { env } from '../env.js'

export const APP_TOKEN_TTL_SECONDS = 15 * 60
export const REFRESH_GRACE_SECONDS = 5 * 60

export interface AppTokenPayload {
  scope: 'app'
  sub: string
  instId: string
}

export function signAppToken(payload: AppTokenPayload): string {
  return jwt.sign(payload, env.jwtSecret, { expiresIn: APP_TOKEN_TTL_SECONDS, algorithm: 'HS256' })
}

export function verifyAppToken(token: string): AppTokenPayload {
  const payload = jwt.verify(token, env.jwtSecret, { algorithms: ['HS256'] }) as Partial<AppTokenPayload>
  if (payload.scope !== 'app' || typeof payload.sub !== 'string' || typeof payload.instId !== 'string') {
    throw new Error('invalid-token-scope')
  }
  return payload as AppTokenPayload
}

export function verifyAppTokenForRefresh(token: string): AppTokenPayload {
  const payload = jwt.verify(token, env.jwtSecret, {
    algorithms: ['HS256'],
    clockTolerance: REFRESH_GRACE_SECONDS,
  }) as Partial<AppTokenPayload>
  if (payload.scope !== 'app' || typeof payload.sub !== 'string' || typeof payload.instId !== 'string') {
    throw new Error('invalid-token-scope')
  }
  return payload as AppTokenPayload
}