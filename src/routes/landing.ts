import { Router } from 'express'

const router = Router()

router.get('/', (_req, res) => {
  res
    .status(200)
    .type('html')
    .send(
      `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AISwap</title><style>body{font-family:system-ui,-apple-system,sans-serif;max-width:40rem;margin:8rem auto;padding:0 1rem;line-height:1.6;color:#111}h1{margin:0 0 .5rem}a{color:#0066cc}</style></head><body><h1>AISwap</h1><p>AI Account Switcher backend. The service is online.</p><p><a href="/health">Check API status</a></p></body></html>`,
    )
})

export default router
