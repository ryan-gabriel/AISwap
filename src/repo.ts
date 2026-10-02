import { supabase } from './db.js'

export type LicenseTier = 'free' | 'pro'

export interface UserRecord {
  userId: string
  email: string
  licenseTier: LicenseTier
  subscriptionStatus: string
  xenditSubscriptionId: string | null
  xenditCheckoutSessionId: string | null
  graceEndsAt: string | null
  proUntil: string | null
  lastVerifiedAt: string | null
}

export interface InstallationRecord {
  instId: string
  createdAt: string
}

const USERS_TABLE = 'users'
const INSTALLATIONS_TABLE = 'installations'
const WEBHOOK_EVENTS_TABLE = 'webhook_events'
const ACCOUNTS_TABLE = 'accounts'

export async function getUser(userId: string): Promise<UserRecord | null> {
  const { data, error } = await supabase
    .from(USERS_TABLE)
    .select('*')
    .eq('userId', userId)
    .maybeSingle()
  if (error) throw error
  return data as UserRecord | null
}

export async function getUserByXenditSubscriptionId(subscriptionId: string): Promise<UserRecord | null> {
  const { data, error } = await supabase
    .from(USERS_TABLE)
    .select('*')
    .eq('xenditSubscriptionId', subscriptionId)
    .maybeSingle()
  if (error) throw error
  return data as UserRecord | null
}

export async function getUserByCheckoutSessionId(sessionId: string): Promise<UserRecord | null> {
  const { data, error } = await supabase
    .from(USERS_TABLE)
    .select('*')
    .eq('xenditCheckoutSessionId', sessionId)
    .maybeSingle()
  if (error) throw error
  return data as UserRecord | null
}

export async function upsertUser(record: UserRecord): Promise<void> {
  const { error } = await supabase.from(USERS_TABLE).upsert(record, {
    onConflict: 'userId',
  })
  if (error) throw error
}

export async function bindInstallation(
  userId: string,
  instId: string,
): Promise<void> {
  const { error } = await supabase.from(INSTALLATIONS_TABLE).upsert(
    { userId, instId, createdAt: new Date().toISOString() },
    { onConflict: 'instId' },
  )
  if (error) throw error
}

export async function getInstallation(instId: string): Promise<{ userId: string } | null> {
  const { data, error } = await supabase
    .from(INSTALLATIONS_TABLE)
    .select('userId')
    .eq('instId', instId)
    .maybeSingle()
  if (error) throw error
  return data as { userId: string } | null
}

export async function countInstallations(userId: string): Promise<number> {
  const { count, error } = await supabase
    .from(INSTALLATIONS_TABLE)
    .select('*', { count: 'exact', head: true })
    .eq('userId', userId)
  if (error) throw error
  return count ?? 0
}

export async function oldestInstallations(userId: string, limit: number): Promise<InstallationRecord[]> {
  const { data, error } = await supabase
    .from(INSTALLATIONS_TABLE)
    .select('instId, createdAt')
    .eq('userId', userId)
    .order('createdAt', { ascending: true })
    .limit(limit)
  if (error) throw error
  return (data ?? []) as InstallationRecord[]
}

export async function deleteInstallations(userId: string, instIds: string[]): Promise<void> {
  if (instIds.length === 0) return
  const { error } = await supabase
    .from(INSTALLATIONS_TABLE)
    .delete()
    .eq('userId', userId)
    .in('instId', instIds)
  if (error) throw error
}

export async function syncUserAccounts(
  userId: string,
  adapterId: string,
  accountIds: string[],
): Promise<number> {
  const { data, error } = await supabase.rpc('sync_user_accounts', {
    p_user_id: userId,
    p_adapter_id: adapterId,
    p_account_ids: accountIds,
  })
  if (error) throw error
  return (data as number | null) ?? 0
}

export async function countAccounts(userId: string): Promise<number> {
  const { count, error } = await supabase
    .from(ACCOUNTS_TABLE)
    .select('*', { count: 'exact', head: true })
    .eq('userId', userId)
  if (error) throw error
  return count ?? 0
}

export async function countAccountsForAdapter(userId: string, adapterId: string): Promise<number> {
  const { count, error } = await supabase
    .from(ACCOUNTS_TABLE)
    .select('*', { count: 'exact', head: true })
    .eq('userId', userId)
    .eq('adapterId', adapterId)
  if (error) throw error
  return count ?? 0
}

export async function hasProcessedEvent(eventId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from(WEBHOOK_EVENTS_TABLE)
    .select('eventId')
    .eq('eventId', eventId)
    .maybeSingle()
  if (error) throw error
  return data !== null
}

export async function insertEventProcessed(eventId: string, userId: string): Promise<boolean> {
  const { error } = await supabase
    .from(WEBHOOK_EVENTS_TABLE)
    .insert({ eventId, userId, processedAt: new Date().toISOString() })
  if (!error) return true
  if (error.code === '23505') return false
  throw error
}