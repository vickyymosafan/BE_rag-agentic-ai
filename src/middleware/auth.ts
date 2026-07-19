import type { Context, Next } from 'hono';
import type { CloudflareBindings } from '../types';

export async function adminAuth(
  c: Context<{ Bindings: CloudflareBindings; Variables: { userId: string } }>,
  next: Next
): Promise<Response | void> {
  const authHeader = c.req.header('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({ error: 'Unauthorized: missing or invalid token' }, 401);
  }

  const token = authHeader.slice(7);
  if (!c.env.JWT_SECRET) {
    return c.json({ error: 'Server misconfiguration: JWT_SECRET not set' }, 500);
  }

  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    c.set('userId', payload.sub || 'unknown');
    await next();
  } catch {
    return c.json({ error: 'Unauthorized: invalid token' }, 401);
  }
}
