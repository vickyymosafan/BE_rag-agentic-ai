import type { Context, Next } from 'hono';
import type { CloudflareBindings } from '../types';

function base64UrlToBase64(str: string): string {
  return str.replace(/-/g, '+').replace(/_/g, '/');
}

async function verifyHMAC(token: string, secret: string): Promise<boolean> {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return false;

    const header = parts[0];
    const payload = parts[1];
    const sigBase64 = base64UrlToBase64(parts[2]);

    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );

    const sigBytes = Uint8Array.from(atob(sigBase64), (c) => c.charCodeAt(0));
    const valid = await crypto.subtle.verify(
      'HMAC',
      key,
      sigBytes,
      new TextEncoder().encode(`${header}.${payload}`)
    );
    return valid;
  } catch {
    return false;
  }
}

export async function adminAuth(
  c: Context<{ Bindings: CloudflareBindings; Variables: { userId: string; userRole: string } }>,
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

  const valid = await verifyHMAC(token, c.env.JWT_SECRET);
  if (!valid) {
    return c.json({ error: 'Unauthorized: invalid token signature' }, 401);
  }

  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    c.set('userId', payload.sub || 'unknown');
    c.set('userRole', payload.role || 'user');
    await next();
  } catch {
    return c.json({ error: 'Unauthorized: invalid token payload' }, 401);
  }
}
