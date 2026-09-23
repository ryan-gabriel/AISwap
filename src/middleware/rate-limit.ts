import type { NextFunction, Request, Response } from 'express'

interface Window {
  windowStartsAt: number
  hits: number
}

class SlidingCounter {
  private windows = new Map<string, Window>()

  constructor(private readonly limit: number, private readonly windowMs: number) {}

  hit(key: string): boolean {
    const now = Date.now()
    this.prune(now)
    const current = this.windows.get(key)
    if (!current || now - current.windowStartsAt >= this.windowMs) {
      this.windows.set(key, { windowStartsAt: now, hits: 1 })
      return true
    }
    current.hits += 1
    return current.hits <= this.limit
  }

  private prune(now: number): void {
    for (const [key, window] of this.windows) {
      if (now - window.windowStartsAt >= this.windowMs) {
        this.windows.delete(key)
      }
    }
  }
}

const perAppCounters = new WeakMap<object, Map<Middleware, SlidingCounter>>()

export type Middleware = (req: Request, res: Response, next: NextFunction) => void

export function rateLimit(limit: number, windowMs: number, keyOf: (req: Request) => string): Middleware {
  const middleware: Middleware = (req, res, next) => {
    let counters = perAppCounters.get(req.app)
    if (!counters) {
      counters = new Map()
      perAppCounters.set(req.app, counters)
    }
    let counter = counters.get(middleware)
    if (!counter) {
      counter = new SlidingCounter(limit, windowMs)
      counters.set(middleware, counter)
    }
    const key = `${req.ip}:${keyOf(req)}`
    if (!counter.hit(key)) {
      res.status(429).json({ error: 'rate-limited' })
      return
    }
    next()
  }
  return middleware
}