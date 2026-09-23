import { describe, expect, it, beforeEach, vi } from 'vitest'
import request from 'supertest'
import jwt from 'jsonwebtoken'
import { signAppToken } from '../src/lib/jwt.js'
import { createApp } from '../src/app.js'

vi.mock('../src/repo.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../src/repo.js')>()
  return { ...mod, getInstallation: vi.fn() }
})

import { getInstallation } from '../src/repo.js'

const mockedGetInstallation = vi.mocked(getInstallation)

beforeEach(() => {
  vi.clearAllMocks()
  mockedGetInstallation.mockResolvedValue({ userId: 'sub-1' })
})

function farExpiredToken(userId = 'sub-1', instId = 'inst-abcde12345'): string {
  return jwt.sign({ scope: 'app', sub: userId, instId }, process.env.JWT_SECRET!, { expiresIn: -86400 })
}

describe('POST /api/auth/refresh', () => {
  it('rejects an app JWT expired beyond the grace window', async () => {
    const res = await request(createApp())
      .post('/api/auth/refresh')
      .set('Authorization', `Bearer ${farExpiredToken()}`)

    expect(res.status).toBe(401)
  })

  it('mints a fresh token for a still-valid app JWT', async () => {
    const token = signAppToken({ scope: 'app', sub: 'sub-1', instId: 'inst-abcde12345' })
    const res = await request(createApp())
      .post('/api/auth/refresh')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(typeof res.body.token).toBe('string')
  })

  it('mints a fresh token for a token within the grace window', async () => {
    const token = jwt.sign({ scope: 'app', sub: 'sub-1', instId: 'inst-abcde12345' }, process.env.JWT_SECRET!, {
      expiresIn: -30,
    })
    const res = await request(createApp())
      .post('/api/auth/refresh')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
  })

  it('rejects a token signed with a different secret', async () => {
    const token = jwt.sign({ scope: 'app', sub: 'x', instId: 'y' }, 'wrong-secret', {
      expiresIn: -1,
    })
    const res = await request(createApp())
      .post('/api/auth/refresh')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(401)
  })

  it('rejects a request without a token', async () => {
    const res = await request(createApp()).post('/api/auth/refresh')
    expect(res.status).toBe(401)
  })

  it('rejects a token with a non-app scope', async () => {
    const token = jwt.sign({ scope: 'other', sub: 'x', instId: 'y' }, process.env.JWT_SECRET!, {
      expiresIn: -1,
    })
    const res = await request(createApp())
      .post('/api/auth/refresh')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(401)
  })

  it('rejects a token whose installation is no longer bound', async () => {
    mockedGetInstallation.mockResolvedValue(null)
    const token = signAppToken({ scope: 'app', sub: 'sub-1', instId: 'inst-abcde12345' })
    const res = await request(createApp())
      .post('/api/auth/refresh')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(401)
  })

  it('rate limits repeated refresh attempts', async () => {
    const app = createApp()
    const token = signAppToken({ scope: 'app', sub: 'sub-1', instId: 'inst-abcde12345' })
    const attempts = Array.from({ length: 11 }, () =>
      request(app).post('/api/auth/refresh').set('Authorization', `Bearer ${token}`),
    )
    const statuses = await Promise.all(attempts)
    expect(statuses[statuses.length - 1].status).toBe(429)
  })
})