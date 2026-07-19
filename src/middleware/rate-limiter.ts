import type { Context, Next } from 'hono';
import type { CloudflareBindings } from '../types';

export async function rateLimitMiddleware(
  c: Context<{ Bindings: CloudflareBindings }>,
  next: Next
): Promise<Response | void> {
  const userId = c.req.header('X-User-Id') || 'anonymous';
  const doId = c.env.RATE_LIMITER.idFromName(userId);
  const stub = c.env.RATE_LIMITER.get(doId);

  const res = await stub.fetch('http://internal/check');
  const { allowed } = await res.json() as { allowed: boolean; count: number };

  if (!allowed) {
    return c.json({
      error: 'Rate limit exceeded',
      message: 'Maksimal 20 request per menit. Silakan tunggu.',
      retryAfter: 60,
    }, 429);
  }

  await next();
}
