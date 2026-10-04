import { describe, expect, it, vi } from 'vitest'

vi.stubGlobal('fetch', vi.fn())

const mockedFetch = vi.mocked(fetch)

function resetFetch() {
  mockedFetch.mockReset()
}

describe('lemonsqueezy client', () => {
  beforeEach(() => {
    resetFetch()
  })

  it('createCheckout sends correct payload and returns checkout url', async () => {
    mockedFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            id: 'ch_123',
            attributes: { url: 'https://checkout.lemonsqueezy.com/checkout/ch_123' },
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    )
    const { createCheckout } = await import('../src/lib/lemonsqueezy.js')
    const result = await createCheckout({ userId: 'u1', email: 'a@b.com', interval: 'monthly' })
    expect(result.checkoutUrl).toBe('https://checkout.lemonsqueezy.com/checkout/ch_123')
    expect(mockedFetch).toHaveBeenCalled()
    const call = mockedFetch.mock.calls[0]
    expect(call?.[1]?.method).toBe('POST')
    expect(call?.[1]?.headers).toMatchObject({
      Authorization: expect.any(String),
      Accept: 'application/vnd.api+json',
    })
  })

  it('createCheckout throws when url missing', async () => {
    mockedFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          data: { id: 'ch_123', attributes: {} },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    )
    const { createCheckout } = await import('../src/lib/lemonsqueezy.js')
    await expect(createCheckout({ userId: 'u1', email: 'a@b.com', interval: 'yearly' })).rejects.toThrow()
  })

  it('non-ok response throws LemonSqueezyError', async () => {
    mockedFetch.mockResolvedValue(new Response('error', { status: 500 }))
    const { LemonSqueezyError, createCheckout } = await import('../src/lib/lemonsqueezy.js')
    await expect(createCheckout({ userId: 'u1', email: 'a@b.com', interval: 'monthly' })).rejects.toBeInstanceOf(LemonSqueezyError)
  })
})
