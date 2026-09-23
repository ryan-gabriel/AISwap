import { beforeEach, describe, expect, it, vi } from 'vitest'
import request from 'supertest'
import type { GoogleUser } from '../src/lib/google.js'

vi.mock('../src/lib/google.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../src/lib/google.js')>()
  return { ...mod, verifyGoogleToken: vi.fn() }
})

vi.mock('../src/repo.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../src/repo.js')>()
  return {
    ...mod,
    getUser: vi.fn(),
    upsertUser: vi.fn(),
    bindInstallation: vi.fn(),
    countInstallations: vi.fn(),
    oldestInstallations: vi.fn(),
    deleteInstallations: vi.fn(),
    getInstallation: vi.fn(),
  }
})

import { GoogleTokenError } from '../src/lib/google.js'
import { verifyGoogleToken } from '../src/lib/google.js'
import {
  bindInstallation,
  countInstallations,
  oldestInstallations,
  deleteInstallations,
  getInstallation,
  getUser,
  upsertUser,
} from '../src/repo.js'
import { createApp } from '../src/app.js'
import { signAppToken } from '../src/lib/jwt.js'

const mockedVerify = vi.mocked(verifyGoogleToken)
const mockedGetUser = vi.mocked(getUser)
const mockedUpsertUser = vi.mocked(upsertUser)
const mockedBind = vi.mocked(bindInstallation)
const mockedCountInstalls = vi.mocked(countInstallations)
const mockedOldest = vi.mocked(oldestInstallations)
const mockedDeleteInstalls = vi.mocked(deleteInstallations)
const mockedGetInstallation = vi.mocked(getInstallation)

const googleUser: GoogleUser = { sub: 'sub-123', email: 'a@b.com' }

beforeEach(() => {
  vi.clearAllMocks()
  mockedCountInstalls.mockResolvedValue(1)
  mockedOldest.mockResolvedValue([])
  mockedDeleteInstalls.mockResolvedValue()
})

describe('POST /api/auth/verify', () => {
  it('verifies a google token and returns an app token + tier', async () => {
    mockedVerify.mockResolvedValue(googleUser)
    mockedGetUser.mockResolvedValue(null)
    mockedUpsertUser.mockResolvedValue()
    mockedBind.mockResolvedValue()

    const res = await request(createApp())
      .post('/api/auth/verify')
      .set('Authorization', 'Bearer google-access-token')
      .send({ instId: 'inst-abcde12345' })

    expect(res.status).toBe(200)
    expect(res.body.userId).toBe('sub-123')
    expect(res.body.licenseTier).toBe('free')
    expect(typeof res.body.token).toBe('string')
    expect(mockedVerify).toHaveBeenCalledWith('google-access-token')
  })

  it('rejects an invalid google token with 401', async () => {
    mockedVerify.mockRejectedValue(new GoogleTokenError('invalid-google-token'))

    const res = await request(createApp())
      .post('/api/auth/verify')
      .set('Authorization', 'Bearer bad-token')
      .send({ instId: 'inst-abcde12345' })

    expect(res.status).toBe(401)
  })

  it('rejects a missing google token with 400', async () => {
    const res = await request(createApp())
      .post('/api/auth/verify')
      .send({ instId: 'inst-abcde12345' })

    expect(res.status).toBe(400)
  })

  it('rejects an invalid body with 400', async () => {
    const res = await request(createApp())
      .post('/api/auth/verify')
      .set('Authorization', 'Bearer google-access-token')
      .send({ instId: 'short' })

    expect(res.status).toBe(400)
  })
})

describe('POST /api/auth/verify device eviction', () => {
  it('evicts the oldest installs when the device limit is exceeded', async () => {
    mockedVerify.mockResolvedValue(googleUser)
    mockedGetUser.mockResolvedValue(null)
    mockedUpsertUser.mockResolvedValue()
    mockedBind.mockResolvedValue()
    mockedCountInstalls.mockResolvedValue(6)
    mockedOldest.mockResolvedValue([{ instId: 'inst-oldest', createdAt: '2020-01-01T00:00:00.000Z' }])

    await request(createApp())
      .post('/api/auth/verify')
      .set('Authorization', 'Bearer google-access-token')
      .send({ instId: 'inst-abcde12345' })

    expect(mockedDeleteInstalls).toHaveBeenCalledWith('sub-123', ['inst-oldest'])
  })
})

describe('POST /api/auth/logout', () => {
  it('deletes the installation bound to the presented token', async () => {
    mockedGetInstallation.mockResolvedValue({ userId: 'sub-1' })
    const token = signAppToken({ scope: 'app', sub: 'sub-1', instId: 'inst-abcde12345' })

    const res = await request(createApp())
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(200)
    expect(mockedDeleteInstalls).toHaveBeenCalledWith('sub-1', ['inst-abcde12345'])
  })

  it('rejects a token for an unbound installation', async () => {
    mockedGetInstallation.mockResolvedValue(null)
    const token = signAppToken({ scope: 'app', sub: 'sub-1', instId: 'inst-abcde12345' })

    const res = await request(createApp())
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${token}`)

    expect(res.status).toBe(401)
  })
})