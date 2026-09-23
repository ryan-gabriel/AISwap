import type { LicenseTier, UserRecord } from './repo.js'

export const FREE_ACCOUNT_LIMIT = 3
export const MAX_DEVICE_BINDINGS = 5
export const PAST_DUE_GRACE_MS = 3 * 24 * 60 * 60 * 1000

export function accountLimitFor(tier: LicenseTier): number | null {
  return tier === 'free' ? FREE_ACCOUNT_LIMIT : null
}

export function isAccountSaveAllowed(user: UserRecord, accountCount: number): boolean {
  const limit = accountLimitFor(user.licenseTier)
  if (limit === null) return true
  return accountCount <= limit
}

export function trialEndFor(user: UserRecord): string | null {
  return null
}

export function expiresAtFor(user: UserRecord): string | null {
  if (user.licenseTier !== 'pro') return null
  if (user.subscriptionStatus === 'past_due') return user.graceEndsAt ?? null
  if (user.subscriptionStatus === 'canceled') return user.proUntil ?? null
  return user.proUntil ?? user.graceEndsAt ?? null
}

export function needsDemotion(user: UserRecord, now = Date.now()): boolean {
  if (user.licenseTier !== 'pro') return false
  if (user.subscriptionStatus === 'past_due' && user.graceEndsAt) {
    return Date.parse(user.graceEndsAt) <= now
  }
  if (user.subscriptionStatus === 'canceled' && user.proUntil) {
    return Date.parse(user.proUntil) <= now
  }
  return false
}

export function demoted(user: UserRecord): UserRecord {
  return {
    ...user,
    licenseTier: 'free',
    subscriptionStatus: 'none',
    graceEndsAt: null,
    proUntil: null,
  }
}