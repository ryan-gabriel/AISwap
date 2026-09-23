import express, { type NextFunction, type Request, type Response } from 'express'
import authRouter from './routes/auth.js'
import refreshRouter from './routes/refresh.js'
import logoutRouter from './routes/logout.js'
import licenseRouter from './routes/license.js'
import accountsRouter from './routes/accounts.js'
import upgradeRouter from './routes/upgrade.js'
import portalRouter from './routes/portal.js'
import webhooksRouter from './routes/webhooks.js'
import accountRouter from './routes/account.js'
import accountActionsRouter from './routes/account-actions.js'
import checkoutCompleteRouter from './routes/checkout-complete.js'
import { env } from './env.js'

export function createApp(): express.Express {
  const app = express()

  app.disable('x-powered-by')
  app.set('trust proxy', env.isProd ? 1 : 0)

  app.get('/checkout-complete', checkoutCompleteRouter)
  app.get('/account', accountRouter)
  app.use(
    '/api/webhooks/xendit',
    express.raw({ type: 'application/json' }),
    webhooksRouter,
  )

  app.use('/api/auth', express.json(), authRouter)
  app.use('/api/auth/refresh', express.json(), refreshRouter)
  app.use('/api/auth/logout', express.json(), logoutRouter)
  app.use('/api/account', express.json(), accountActionsRouter)
  app.use('/api/license', express.json(), licenseRouter)
  app.use('/api/accounts', express.json(), accountsRouter)
  app.use('/api/upgrade', express.json(), upgradeRouter)
  app.use('/api/portal', express.json(), portalRouter)

  app.get('/health', (_req: Request, res: Response) => {
    res.status(200).json({ ok: true })
  })

  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    const maybe = err as unknown as { status?: unknown; statusCode?: unknown }
    const status =
      typeof maybe.status === 'number'
        ? maybe.status
        : typeof maybe.statusCode === 'number'
          ? maybe.statusCode
          : 500
    if (status >= 500) {
      console.error(err)
    }
    res.status(status).json({ error: status >= 500 ? 'internal-error' : 'request-failed' })
  })

  return app
}