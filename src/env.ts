import { config } from 'dotenv'

// dotenv v18 defaults to `override: true`, which lets a local .env silently shadow a real
// environment variable injected by Vercel, CI, or the shell. Ask for the conventional
// precedence explicitly: the real environment wins, and .env is only a local fallback.
config({ override: false })

const isProd = process.env.NODE_ENV === 'production'

const COMMON_PLACEHOLDERS = [
  'change-me',
  'your-service-role-key',
  'sk_live_xxx',
  'xnd_test_unit',
  'xnd_whtok_unit',
  'your_lemonsqueezy_api_key',
  'your_webhook_signing_secret',
  '<google-oauth-client-id>',
]

function assertProdValue(name: string, value: string, extra: { minLength?: number } = {}): void {
  if (!isProd) return
  if (COMMON_PLACEHOLDERS.includes(value.trim())) {
    throw new Error(`${name} must not use a placeholder value in production`)
  }
  if (extra.minLength && value.length < extra.minLength) {
    throw new Error(`${name} must be at least ${extra.minLength} characters in production`)
  }
}

function required(name: string, extra: { minLength?: number } = {}): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`${name} not configured in environment`)
  }
  assertProdValue(name, value, extra)
  return value
}

// Optional values let the backend boot without a configured payment provider.
// When a value IS supplied in production it is still validated against the
// placeholder/length guards, so a half-configured provider fails loudly.
function optional(name: string, extra: { minLength?: number } = {}): string | null {
  const value = process.env[name]
  if (!value) return null
  assertProdValue(name, value, extra)
  return value
}

function optionalNumber(name: string): number | null {
  const value = optional(name)
  if (value === null) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  isProd,
  port: Number(process.env.PORT ?? 3000),
  supabaseUrl: required('SUPABASE_URL'),
  supabaseServiceRoleKey: required('SUPABASE_SERVICE_ROLE_KEY'),
  googleOAuthClientId: required('GOOGLE_OAUTH_CLIENT_ID'),
  xenditSecretKey: optional('XENDIT_SECRET_KEY'),
  xenditWebhookToken: optional('XENDIT_WEBHOOK_TOKEN'),
  xenditCurrency: process.env.XENDIT_CURRENCY ?? 'USD',
  xenditCountry: process.env.XENDIT_COUNTRY ?? 'ID',
  xenditPriceProMonthlyMinor: optionalNumber('XENDIT_PRICE_PRO_MONTHLY_MINOR'),
  xenditPriceProYearlyMinor: optionalNumber('XENDIT_PRICE_PRO_YEARLY_MINOR'),
  lemonSqueezyApiKey: optional('LEMONSQUEEZY_API_KEY'),
  lemonSqueezyStoreId: optional('LEMONSQUEEZY_STORE_ID'),
  lemonSqueezyWebhookSecret: optional('LEMONSQUEEZY_WEBHOOK_SECRET', { minLength: 6 }),
  lemonSqueezyProductId: optional('LEMONSQUEEZY_PRODUCT_ID'),
  lemonSqueezyVariantProMonthly: optionalNumber('LEMONSQUEEZY_VARIANT_PRO_MONTHLY'),
  lemonSqueezyVariantProYearly: optionalNumber('LEMONSQUEEZY_VARIANT_PRO_YEARLY'),
  lemonSqueezyPortalEnabled: (process.env.LEMONSQUEEZY_PORTAL_ENABLED ?? 'true') === 'true',
  jwtSecret: required('JWT_SECRET', { minLength: 32 }),
  appBaseUrl: process.env.APP_BASE_URL ?? 'http://localhost:3000',
}

// A provider counts as enabled only when every value its runtime path needs is
// configured. Payment routes and lib functions check these flags and return a
// clean 503 / typed error instead of crashing on a missing key.
export const xenditEnabled =
  env.xenditSecretKey !== null &&
  env.xenditWebhookToken !== null &&
  env.xenditPriceProMonthlyMinor !== null &&
  env.xenditPriceProYearlyMinor !== null

export const lemonSqueezyEnabled =
  env.lemonSqueezyApiKey !== null &&
  env.lemonSqueezyStoreId !== null &&
  env.lemonSqueezyWebhookSecret !== null &&
  env.lemonSqueezyProductId !== null &&
  env.lemonSqueezyVariantProMonthly !== null &&
  env.lemonSqueezyVariantProYearly !== null
