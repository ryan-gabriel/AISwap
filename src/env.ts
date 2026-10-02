import 'dotenv/config'

const isProd = process.env.NODE_ENV === 'production'

const COMMON_PLACEHOLDERS = [
  'change-me',
  'your-service-role-key',
  'sk_live_xxx',
  'xnd_test_unit',
  'xnd_whtok_unit',
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
  jwtSecret: required('JWT_SECRET', { minLength: 32 }),
  appBaseUrl: process.env.APP_BASE_URL ?? 'http://localhost:3000',
}