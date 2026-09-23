import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { env } from './env.js'

export const supabase: SupabaseClient = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
  auth: { persistSession: false },
})