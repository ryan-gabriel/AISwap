import { env } from '../env.js'

export interface GoogleUser {
  sub: string
  email: string
}

const TOKENINFO_URL = 'https://oauth2.googleapis.com/tokeninfo'

export class GoogleTokenError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GoogleTokenError'
  }
}

export async function verifyGoogleToken(accessToken: string): Promise<GoogleUser> {
  const url = `${TOKENINFO_URL}?access_token=${encodeURIComponent(accessToken)}`
  let res: Response
  try {
    res = await fetch(url)
  } catch {
    throw new GoogleTokenError('google-tokeninfo-unreachable')
  }
  if (!res.ok) {
    let detail = ''
    try {
      const body = (await res.json()) as { error_description?: unknown; error?: unknown }
      detail =
        typeof body.error_description === 'string'
          ? body.error_description
          : typeof body.error === 'string'
            ? body.error
            : ''
    } catch {
      // tokeninfo body may not be JSON
    }
    throw new GoogleTokenError(
      `invalid-google-token: tokeninfo rejected (status ${res.status})${detail ? `, ${detail}` : ''}`,
    )
  }
  const data = (await res.json()) as {
    sub?: string
    user_id?: string
    email?: string
    email_verified?: unknown
    aud?: unknown
    azp?: unknown
    iss?: unknown
    exp?: unknown
  }
  const sub = data.sub ?? data.user_id
  const email = data.email
  const emailVerified = data.email_verified === true || data.email_verified === 'true'
  if (!sub || !email || !emailVerified) {
    throw new GoogleTokenError(
      `invalid-google-token: identity fields invalid (sub=${typeof sub}, email=${typeof email}, email_verified=${JSON.stringify(data.email_verified)})`,
    )
  }
  if (data.aud !== env.googleOAuthClientId || data.azp !== env.googleOAuthClientId) {
    throw new GoogleTokenError(
      `invalid-google-token: aud/azp mismatch (aud=${data.aud}, azp=${data.azp}, expected=${env.googleOAuthClientId})`,
    )
  }
  if (data.iss !== 'https://accounts.google.com') {
    throw new GoogleTokenError(`invalid-google-token: unexpected issuer (${data.iss})`)
  }
  if (typeof data.exp === 'number' && data.exp * 1000 <= Date.now()) {
    throw new GoogleTokenError(`invalid-google-token: token expired (exp=${data.exp})`)
  }
  return { sub, email }
}