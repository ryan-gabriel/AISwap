import { describe, expect, it } from 'vitest'
import jwt from 'jsonwebtoken'
import { signAppToken, verifyAppToken, verifyAppTokenForRefresh, REFRESH_GRACE_SECONDS } from '../src/lib/jwt.js'

describe('app jwt', () => {
  it('signs and verifies a token round-trip', () => {
    const token = signAppToken({ scope: 'app', sub: 'google-sub-1', instId: 'inst-abc' })
    const payload = verifyAppToken(token)
    expect(payload.sub).toBe('google-sub-1')
    expect(payload.instId).toBe('inst-abc')
    expect(payload.scope).toBe('app')
  })

  it('rejects a token signed with a different secret', () => {
    const token = jwt.sign(
      { scope: 'app', sub: 'x', instId: 'y' },
      'wrong-secret',
      { expiresIn: 60 },
    )
    expect(() => verifyAppToken(token)).toThrow()
  })

  it('rejects an expired token', () => {
    const token = jwt.sign({ scope: 'app', sub: 'x', instId: 'y' }, process.env.JWT_SECRET!, {
      expiresIn: -1,
    })
    expect(() => verifyAppToken(token)).toThrow()
  })
})

describe('app jwt refresh', () => {
  it('accepts a token still within the refresh grace window', () => {
    const token = jwt.sign(
      { scope: 'app', sub: 'sub-1', instId: 'inst-1' },
      process.env.JWT_SECRET!,
      { expiresIn: -30 },
    )
    const payload = verifyAppTokenForRefresh(token)
    expect(payload.sub).toBe('sub-1')
    expect(payload.instId).toBe('inst-1')
  })

  it('rejects a token expired beyond the refresh grace window', () => {
    const farExpired = -(REFRESH_GRACE_SECONDS + 60)
    const token = jwt.sign({ scope: 'app', sub: 'sub-1', instId: 'inst-1' }, process.env.JWT_SECRET!, {
      expiresIn: farExpired,
    })
    expect(() => verifyAppTokenForRefresh(token)).toThrow()
  })

  it('rejects a token signed with a different secret even when refreshing', () => {
    const token = jwt.sign(
      { scope: 'app', sub: 'x', instId: 'y' },
      'wrong-secret',
      { expiresIn: -1 },
    )
    expect(() => verifyAppTokenForRefresh(token)).toThrow()
  })
})