import { afterEach, describe, expect, it, vi } from 'vitest'
import { verifyGoogleToken, GoogleTokenError } from '../src/lib/google.js'
import { env } from '../src/env.js'

function mockFetchOnce(res: Response | Error): void {
  if (res instanceof Error) {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(res))
  } else {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res))
  }
}

function jsonResponse(ok: boolean, body: unknown): Response {
  return {
    ok,
    json: async () => body,
  } as Response
}

function validPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    sub: 'g123',
    email: 'a@b.com',
    email_verified: true,
    aud: env.googleOAuthClientId,
    azp: env.googleOAuthClientId,
    iss: 'https://accounts.google.com',
    ...overrides,
  }
}

describe('verifyGoogleToken', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('returns the user from a valid google tokeninfo payload', async () => {
    mockFetchOnce(jsonResponse(true, validPayload()))
    await expect(verifyGoogleToken('tok')).resolves.toEqual({ sub: 'g123', email: 'a@b.com' })
  })

  it('falls back to user_id when sub is absent', async () => {
    mockFetchOnce(jsonResponse(true, validPayload({ sub: undefined, user_id: 'g456' })))
    await expect(verifyGoogleToken('tok')).resolves.toEqual({ sub: 'g456', email: 'a@b.com' })
  })

  it('throws invalid-google-token on a non-ok response', async () => {
    mockFetchOnce(jsonResponse(false, { error: 'bad' }))
    await expect(verifyGoogleToken('tok')).rejects.toThrow('invalid-google-token')
  })

  it('throws google-tokeninfo-unreachable when fetch fails', async () => {
    mockFetchOnce(new Error('network down'))
    await expect(verifyGoogleToken('tok')).rejects.toThrow('google-tokeninfo-unreachable')
  })

  it('throws invalid-google-token when the email is not verified', async () => {
    mockFetchOnce(jsonResponse(true, validPayload({ email_verified: undefined })))
    await expect(verifyGoogleToken('tok')).rejects.toThrow(GoogleTokenError)
  })

  it('accepts email_verified as the string "true" (tokeninfo quirk)', async () => {
    mockFetchOnce(jsonResponse(true, validPayload({ email_verified: 'true' })))
    await expect(verifyGoogleToken('tok')).resolves.toEqual({ sub: 'g123', email: 'a@b.com' })
  })

  it('rejects email_verified as the string "false"', async () => {
    mockFetchOnce(jsonResponse(true, validPayload({ email_verified: 'false' })))
    await expect(verifyGoogleToken('tok')).rejects.toThrow(GoogleTokenError)
  })

  it('throws invalid-google-token when the payload lacks identity fields', async () => {
    mockFetchOnce(jsonResponse(true, validPayload({ sub: undefined, user_id: undefined })))
    await expect(verifyGoogleToken('tok')).rejects.toThrow('invalid-google-token')
  })

  it('throws invalid-google-token when the token was issued to another client', async () => {
    mockFetchOnce(jsonResponse(true, validPayload({ aud: 'other-client.apps.googleusercontent.com' })))
    await expect(verifyGoogleToken('tok')).rejects.toThrow('invalid-google-token')
  })

  it('throws invalid-google-token when the issuer is unexpected', async () => {
    mockFetchOnce(jsonResponse(true, validPayload({ iss: 'https://evil.example' })))
    await expect(verifyGoogleToken('tok')).rejects.toThrow('invalid-google-token')
  })

  it('accepts a payload without an iss claim (tokeninfo quirk)', async () => {
    mockFetchOnce(jsonResponse(true, validPayload({ iss: undefined })))
    await expect(verifyGoogleToken('tok')).resolves.toEqual({ sub: 'g123', email: 'a@b.com' })
  })

  it('accepts accounts.google.com without scheme as the issuer', async () => {
    mockFetchOnce(jsonResponse(true, validPayload({ iss: 'accounts.google.com' })))
    await expect(verifyGoogleToken('tok')).resolves.toEqual({ sub: 'g123', email: 'a@b.com' })
  })

  it('throws invalid-google-token when the token has expired', async () => {
    mockFetchOnce(jsonResponse(true, validPayload({ exp: Math.floor(Date.now() / 1000) - 10 })))
    await expect(verifyGoogleToken('tok')).rejects.toThrow('invalid-google-token')
  })

  it('accepts a payload without an exp claim', async () => {
    mockFetchOnce(jsonResponse(true, validPayload({ exp: undefined })))
    await expect(verifyGoogleToken('tok')).resolves.toEqual({ sub: 'g123', email: 'a@b.com' })
  })

  it('encodes the access token into the tokeninfo url', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(true, validPayload()))
    vi.stubGlobal('fetch', fetchMock)
    await verifyGoogleToken('tok with spaces')
    const url = fetchMock.mock.calls[0]?.[0] as string
    expect(url).toBe('https://oauth2.googleapis.com/tokeninfo?access_token=tok%20with%20spaces')
  })
})