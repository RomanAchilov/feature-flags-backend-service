import { Hono } from 'hono'
import type { CurrentUser } from './middleware/auth'
import { auth } from './middleware/auth'
import { health } from './routes/health'
import { flagsRoute } from './routes/flags'
import { evaluateRoute } from './routes/evaluate'

// Central app instance with shared context typing.
export const app = new Hono<{ Variables: { currentUser: CurrentUser } }>()

app.use('*', auth)
app.route('/health', health)
app.route('/flags', flagsRoute)
app.route('/evaluate', evaluateRoute)
