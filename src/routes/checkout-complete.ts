import { Router } from 'express'

const router = Router()

router.get('/checkout-complete', (_req, res) => {
  res
    .status(200)
    .type('html')
    .send(
      '<!doctype html><html><head><meta charset="utf-8"><title>Almost done</title></head>' +
        '<body style="font-family:system-ui;max-width:40rem;margin:8rem auto;text-align:center;line-height:1.6">' +
        '<h1>Thanks for upgrading</h1>' +
        '<p>Your subscription is active. Close this tab and open the extension to see your Pro status.</p>' +
        '</body></html>',
    )
})

export default router