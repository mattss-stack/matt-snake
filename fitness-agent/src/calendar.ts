import type { CalendarEvent } from './types';

async function getAccessToken(clientEmail: string, privateKey: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);

  const encode = (obj: object) =>
    btoa(JSON.stringify(obj)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

  const header = encode({ alg: 'RS256', typ: 'JWT' });
  const claims = encode({
    iss: clientEmail,
    scope: 'https://www.googleapis.com/auth/calendar.readonly',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  });

  const signingInput = `${header}.${claims}`;

  const pemBody = privateKey
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s/g, '');
  const keyBytes = Uint8Array.from(atob(pemBody), (c) => c.charCodeAt(0));

  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8',
    keyBytes,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );

  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    cryptoKey,
    new TextEncoder().encode(signingInput),
  );

  const sig = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');

  const jwt = `${signingInput}.${sig}`;

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });

  const tokenData = await tokenRes.json() as { access_token?: string; error?: string };
  if (!tokenData.access_token) throw new Error(`Calendar auth failed: ${tokenData.error}`);
  return tokenData.access_token;
}

export async function getCalendarEvents(
  clientEmail: string,
  privateKey: string,
  calendarId: string,
  days = 60,
): Promise<CalendarEvent[]> {
  try {
    const token = await getAccessToken(clientEmail, privateKey);

    const since = new Date();
    since.setDate(since.getDate() - days);

    const params = new URLSearchParams({
      timeMin: since.toISOString(),
      timeMax: new Date().toISOString(),
      singleEvents: 'true',
      orderBy: 'startTime',
      maxResults: '250',
    });

    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${params}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );

    const data = await res.json() as { items?: any[] };

    return (data.items ?? [])
      .filter((e: any) => e.status !== 'cancelled' && (e.summary ?? '').trim())
      .map((e: any) => ({
        date: (e.start?.date ?? e.start?.dateTime ?? '').split('T')[0],
        summary: (e.summary ?? '').trim(),
      }))
      .filter((e: CalendarEvent) => Boolean(e.date));
  } catch {
    return [];
  }
}

export function extractRestDays(events: CalendarEvent[]): string[] {
  return events
    .filter((e) => /rest|recovery|off day|rest day/i.test(e.summary))
    .map((e) => e.date);
}
