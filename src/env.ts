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

function required(name: string, extra: { minLength?: number } = {}): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`${name} not configured in environment`)
  }
  if (isProd) {
    if (COMMON_PLACEHOLDERS.includes(value.trim())) {
      throw new Error(`${name} must not use a placeholder value in production`)
    }
    if (extra.minLength && value.length < extra.minLength) {
      throw new Error(`${name} must be at least ${extra.minLength} characters in production`)
    }
  }
  return value
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  isProd,
  port: Number(process.env.PORT ?? 3000),
  supabaseUrl: required('SUPABASE_URL'),
  supabaseServiceRoleKey: required('SUPABASE_SERVICE_ROLE_KEY'),
  googleOAuthClientId: required('GOOGLE_OAUTH_CLIENT_ID'),
  xenditSecretKey: required('XENDIT_SECRET_KEY'),
  xenditWebhookToken: required('XENDIT_WEBHOOK_TOKEN'),
  xenditCurrency: process.env.XENDIT_CURRENCY ?? 'USD',
  xenditCountry: process.env.XENDIT_COUNTRY ?? 'ID',
  xenditPriceProMonthlyMinor: Number(required('XENDIT_PRICE_PRO_MONTHLY_MINOR')),
  xenditPriceProYearlyMinor: Number(required('XENDIT_PRICE_PRO_YEARLY_MINOR')),
  lemonSqueezyApiKey: required('LEMONSQUEEZY_API_KEY'),
  lemonSqueezyStoreId: required('LEMONSQUEEZY_STORE_ID'),
  lemonSqueezyWebhookSecret: required('LEMONSQUEEZY_WEBHOOK_SECRET', { minLength: 6 }),
  lemonSqueezyProductId: required('LEMONSQUEEZY_PRODUCT_ID'),
  lemonSqueezyVariantProMonthly: Number(required('LEMONSQUEEZY_VARIANT_PRO_MONTHLY')),
  lemonSqueezyVariantProYearly: Number(required('LEMONSQUEEZY_VARIANT_PRO_YEARLY')),
  lemonSqueezyPortalEnabled: (process.env.LEMONSQUEEZY_PORTAL_ENABLED ?? 'true') === 'true',
  jwtSecret: required('JWT_SECRET', { minLength: 32 }),
  appBaseUrl: process.env.APP_BASE_URL ?? 'http://localhost:3000',
}
