import { beforeEach, describe, expect, it, vi } from "vitest"
import type { UserRecord } from '../src/repo.js'

const h = vi.hoisted(() => {
  const METHODS = ['select', 'eq', 'in', 'not', 'order', 'limit', 'maybeSingle', 'insert', 'upsert', 'delete']
  const state: { outcome: ((table: string) => unknown) | null } = { outcome: null }
  function makeQuery(table: string): unknown {
    const api: Record<string, (...args: unknown[]) => unknown> = {}
    for (const m of METHODS) {
      api[m] = (..._args: unknown[]) => makeQuery(table)
    }
    return new Proxy(api, {
      get(target, prop) {
        if (prop === 'then') {
          return (resolve: (v: unknown) => void, reject: (e: unknown) => void) =>
            Promise.resolve(state.outcome?.(table) ?? { data: null, error: null }).then(resolve, reject)
        }
        return target[prop as string]
      },
    })
  }
  return {
    from(table: string): unknown {
      return makeQuery(table)
    },
    rpc(procedure: string): unknown {
      return makeQuery(`rpc:${procedure}`)
    },
    state,
  }
})

vi.mock('../src/db.js', () => ({
  supabase: {
    from: h.from,
    rpc: h.rpc,
  },
}))

import {
  getUser,
  getUserByXenditSubscriptionId,
  upsertUser,
  bindInstallation,
  countInstallations,
  oldestInstallations,
  deleteInstallations,
  syncUserAccounts,
  countAccounts,
  countAccountsForAdapter,
  hasProcessedEvent,
  insertEventProcessed,
} from '../src/repo.js'

function makeUser(): UserRecord {
  return {
    userId: 'user-1',
    email: 'a@b.com',
    licenseTier: 'free',
    subscriptionStatus: 'free',
    xenditSubscriptionId: null,
    graceEndsAt: null,
    proUntil: null,
    lastVerifiedAt: null,
  }
}

beforeEach(() => {
  h.state.outcome = () => ({ data: null, error: null })
})

describe('getUser', () => {
  it('returns the matching user', async () => {
    h.state.outcome = () => ({ data: makeUser(), error: null })
    await expect(getUser('user-1')).resolves.toEqual(makeUser())
  })

  it('returns null when no user exists', async () => {
    await expect(getUser('user-1')).resolves.toBeNull()
  })

  it('throws when the database errors', async () => {
    h.state.outcome = () => ({ data: null, error: new Error('db down') })
    await expect(getUser('user-1')).rejects.toThrow('db down')
  })
})

describe('getUserByXenditSubscriptionId', () => {
  it('returns the user for a subscription id', async () => {
    h.state.outcome = () => ({ data: makeUser(), error: null })
    await expect(getUserByXenditSubscriptionId('xnd_sub_1')).resolves.toEqual(makeUser())
  })

  it('returns null when not found', async () => {
    await expect(getUserByXenditSubscriptionId('xnd_sub_1')).resolves.toBeNull()
  })

  it('throws on error', async () => {
    h.state.outcome = () => ({ data: null, error: new Error('x') })
    await expect(getUserByXenditSubscriptionId('xnd_sub_1')).rejects.toThrow('x')
  })
})

describe('upsertUser', () => {
  it('persists the record', async () => {
    await expect(upsertUser(makeUser())).resolves.toBeUndefined()
  })

  it('throws on error', async () => {
    h.state.outcome = () => ({ data: null, error: new Error('conflict') })
    await expect(upsertUser(makeUser())).rejects.toThrow('conflict')
  })
})

describe('bindInstallation', () => {
  it('upserts the installation', async () => {
    await expect(bindInstallation('user-1', 'inst-1')).resolves.toBeUndefined()
  })

  it('throws on error', async () => {
    h.state.outcome = () => ({ data: null, error: new Error('e') })
    await expect(bindInstallation('user-1', 'inst-1')).rejects.toThrow('e')
  })
})

describe('countInstallations', () => {
  it('returns the exact count', async () => {
    h.state.outcome = () => ({ count: 2, error: null })
    await expect(countInstallations('user-1')).resolves.toBe(2)
  })

  it('returns zero when count is absent', async () => {
    h.state.outcome = () => ({ count: null, error: null })
    await expect(countInstallations('user-1')).resolves.toBe(0)
  })

  it('throws on error', async () => {
    h.state.outcome = () => ({ count: null, error: new Error('e') })
    await expect(countInstallations('user-1')).rejects.toThrow('e')
  })
})

describe('oldestInstallations', () => {
  it('returns the oldest installations', async () => {
    h.state.outcome = () => ({ data: [{ instId: 'i1', createdAt: 't1' }], error: null })
    await expect(oldestInstallations('user-1', 2)).resolves.toEqual([
      { instId: 'i1', createdAt: 't1' },
    ])
  })

  it('returns an empty array when no data', async () => {
    await expect(oldestInstallations('user-1', 2)).resolves.toEqual([])
  })

  it('throws on error', async () => {
    h.state.outcome = () => ({ data: null, error: new Error('e') })
    await expect(oldestInstallations('user-1', 2)).rejects.toThrow('e')
  })
})

describe('deleteInstallations', () => {
  it('does nothing for an empty list', async () => {
    await expect(deleteInstallations('user-1', [])).resolves.toBeUndefined()
  })

  it('deletes the requested installations', async () => {
    await expect(deleteInstallations('user-1', ['i1', 'i2'])).resolves.toBeUndefined()
  })

  it('throws on error', async () => {
    h.state.outcome = () => ({ data: null, error: new Error('e') })
    await expect(deleteInstallations('user-1', ['i1'])).rejects.toThrow('e')
  })
})

describe('syncUserAccounts', () => {
  it('reconciles via the rpc and returns the new total', async () => {
    h.state.outcome = () => ({ data: 3, error: null })
    await expect(
      syncUserAccounts('user-1', 'adapter-1', ['a1', 'a2']),
    ).resolves.toBe(3)
  })

  it('returns zero when the rpc returns no data', async () => {
    await expect(syncUserAccounts('user-1', 'adapter-1', [])).resolves.toBe(0)
  })

  it('throws when the rpc errors', async () => {
    h.state.outcome = () => ({ data: null, error: new Error('rpc') })
    await expect(
      syncUserAccounts('user-1', 'adapter-1', ['a1']),
    ).rejects.toThrow('rpc')
  })
})

describe('countAccounts', () => {
  it('returns the exact count', async () => {
    h.state.outcome = () => ({ count: 4, error: null })
    await expect(countAccounts('user-1')).resolves.toBe(4)
  })

  it('returns zero when count is absent', async () => {
    h.state.outcome = () => ({ count: null, error: null })
    await expect(countAccounts('user-1')).resolves.toBe(0)
  })

  it('throws on error', async () => {
    h.state.outcome = () => ({ count: null, error: new Error('e') })
    await expect(countAccounts('user-1')).rejects.toThrow('e')
  })
})

describe('countAccountsForAdapter', () => {
  it('returns the exact count for an adapter', async () => {
    h.state.outcome = () => ({ count: 2, error: null })
    await expect(countAccountsForAdapter('user-1', 'claude')).resolves.toBe(2)
  })

  it('returns zero when count is absent', async () => {
    h.state.outcome = () => ({ count: null, error: null })
    await expect(countAccountsForAdapter('user-1', 'claude')).resolves.toBe(0)
  })

  it('throws on error', async () => {
    h.state.outcome = () => ({ count: null, error: new Error('e') })
    await expect(countAccountsForAdapter('user-1', 'claude')).rejects.toThrow('e')
  })
})

describe('hasProcessedEvent', () => {
  it('returns true when the event exists', async () => {
    h.state.outcome = () => ({ data: { eventId: 'e1' }, error: null })
    await expect(hasProcessedEvent('e1')).resolves.toBe(true)
  })

  it('returns false when the event is new', async () => {
    await expect(hasProcessedEvent('e1')).resolves.toBe(false)
  })

  it('throws on error', async () => {
    h.state.outcome = () => ({ data: null, error: new Error('e') })
    await expect(hasProcessedEvent('e1')).rejects.toThrow('e')
  })
})

describe('insertEventProcessed', () => {
  it('returns true on a clean insert', async () => {
    await expect(insertEventProcessed('e1', 'user-1')).resolves.toBe(true)
  })

  it('returns false on a duplicate key', async () => {
    h.state.outcome = () => ({ data: null, error: { code: '23505' } })
    await expect(insertEventProcessed('e1', 'user-1')).resolves.toBe(false)
  })

  it('throws on any other error', async () => {
    h.state.outcome = () => ({ data: null, error: { code: '50000', message: 'boom' } })
    await expect(insertEventProcessed('e1', 'user-1')).rejects.toThrow()
  })
})