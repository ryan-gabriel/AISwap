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
    throw new GoogleTokenError('invalid-google-token')
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
  if (!sub || !email || data.email_verified !== true) {
    throw new GoogleTokenError('invalid-google-token')
  }
  if (data.aud !== env.googleOAuthClientId || data.azp !== env.googleOAuthClientId) {
    throw new GoogleTokenError('invalid-google-token')
  }
  if (data.iss !== 'https://accounts.google.com') {
    throw new GoogleTokenError('invalid-google-token')
  }
  if (typeof data.exp === 'number' && data.exp * 1000 <= Date.now()) {
    throw new GoogleTokenError('invalid-google-token')
  }
  return { sub, email }
}