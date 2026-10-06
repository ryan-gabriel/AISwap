import app from './app.js'
import { env } from './env.js'

app.listen(env.port, () => {
  console.log(`backend listening on http://localhost:${env.port}`)
})
