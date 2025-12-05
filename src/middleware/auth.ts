import type { Context, Next } from 'hono'

export type CurrentUser = {
  id: string
  email?: string
  roles?: string[]
}

export const auth = async (c: Context, next: Next) => {
  // Placeholder auth: attach a minimal user to context for downstream handlers.
  const headerUserId = c.req.header('x-user-id')

  const currentUser: CurrentUser = {
    id: headerUserId ?? 'system',
    email: c.req.header('x-user-email') ?? undefined,
    roles: c.req.header('x-user-roles')?.split(',').map((r) => r.trim()).filter(Boolean)
  }

  c.set('currentUser', currentUser)
  await next()
}
