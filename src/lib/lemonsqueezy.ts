import { timingSafeEqual, createHmac } from 'node:crypto'
import { env } from '../env.js'

const BASE_URL = 'https://api.lemonsqueezy.com/v1'

export type SubscriptionInterval = 'monthly' | 'yearly'

export interface CreatedCheckout {
  id: string
  checkoutUrl: string
}

export class LemonSqueezyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LemonSqueezyError'
  }
}

export function verifyLemonSqueezySignature(
  rawBody: Buffer | string | undefined | null,
  header: string | undefined | null,
): boolean {
  if (!rawBody || !header) return false
  const supplied = header.trim()
  if (supplied.length === 0) return false

  let body: Buffer
  if (Buffer.isBuffer(rawBody)) {
    body = rawBody
  } else {
    body = Buffer.from(String(rawBody))
  }

  const secret = env.lemonSqueezyWebhookSecret
  if (!secret) return false
  const expectedHex = createHmac('sha256', secret).update(body).digest('hex')
  const suppliedBuffer = Buffer.from(supplied)
  const expectedBuffer = Buffer.from(expectedHex)

  if (suppliedBuffer.length !== expectedBuffer.length) return false
  try {
    return timingSafeEqual(suppliedBuffer, expectedBuffer)
  } catch {
    return false
  }
}
async function lsFetch<T>(path: string, init: RequestInit): Promise<T> {
  if (!env.lemonSqueezyApiKey) {
    throw new LemonSqueezyError('payments-not-configured')
  }
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${env.lemonSqueezyApiKey}`,
      Accept: 'application/vnd.api+json',
      'Content-Type': 'application/vnd.api+json',
      ...init.headers,
    },
  })
  if (!res.ok) {
    throw new LemonSqueezyError(`lemonsqueezy-api-error ${res.status}`)
  }
  if (res.status === 204) return undefined as T
  return (await res.json()) as T
}

export function variantIdFor(interval: SubscriptionInterval): number {
  const variantId =
    interval === 'yearly' ? env.lemonSqueezyVariantProYearly : env.lemonSqueezyVariantProMonthly
  if (variantId === null) {
    throw new LemonSqueezyError('payments-not-configured')
  }
  return variantId
}

export async function createCheckout(params: {
  userId: string
  email: string
  interval: SubscriptionInterval
}): Promise<CreatedCheckout> {
  const { userId, email, interval } = params
  if (!env.lemonSqueezyStoreId) {
    throw new LemonSqueezyError('payments-not-configured')
  }
  const variantId = variantIdFor(interval)

  const body = JSON.stringify({
    data: {
      type: 'checkouts',
      attributes: {
        checkout_data: {
          email,
          custom: {
            user_id: userId,
          },
        },
        product_options: {
          redirect_url: `${env.appBaseUrl}/checkout-complete`,
        },
      },
      relationships: {
        store: {
          data: {
            type: 'stores',
            id: env.lemonSqueezyStoreId,
          },
        },
        variant: {
          data: {
            type: 'variants',
            id: String(variantId),
          },
        },
      },
    },
  })

  const response = await lsFetch<{
    data: {
      id: string
      attributes: {
        url?: string | null
      }
    }
  }>('/checkouts', {
    method: 'POST',
    body,
  })

  if (!response.data?.id) {
    throw new LemonSqueezyError('lemonsqueezy-no-checkout-id')
  }
  if (!response.data.attributes?.url) {
    throw new LemonSqueezyError('lemonsqueezy-no-checkout-url')
  }

  return {
    id: response.data.id,
    checkoutUrl: response.data.attributes.url,
  }
}

export async function getSubscription(subscriptionId: string): Promise<any> {
  return lsFetch(`/subscriptions/${encodeURIComponent(subscriptionId)}`, {
    method: 'GET',
  })
}

export async function cancelSubscription(subscriptionId: string): Promise<void> {
  await lsFetch(`/subscriptions/${encodeURIComponent(subscriptionId)}`, {
    method: 'DELETE',
  })
}