import type { NotionSession, WorkoutBlock } from './types';

const NOTION_VERSION = '2022-06-28';
const BASE = 'https://api.notion.com/v1';

function headers(apiKey: string) {
  return {
    Authorization: `Bearer ${apiKey}`,
    'Notion-Version': NOTION_VERSION,
    'Content-Type': 'application/json',
  };
}

function notionPageUrl(pageId: string): string {
  return `https://notion.so/${pageId.replace(/-/g, '')}`;
}

function parseSession(page: any): NotionSession {
  const p = page.properties;
  return {
    id: page.id,
    url: notionPageUrl(page.id),
    date: p.Date?.date?.start ?? '',
    split: p.Split?.select?.name ?? 'Other',
    gym: p.Gym?.select?.name ?? 'Other',
    duration: p['Duration (min)']?.number ?? undefined,
    kneeFeel: p['Knee Feel']?.select?.name ?? 'N/A',
    notes: (p.Notes?.rich_text ?? []).map((r: any) => r.text?.content ?? '').join(''),
    session: (p.Session?.title ?? []).map((r: any) => r.text?.content ?? '').join(''),
    isPR: p.PR?.checkbox ?? false,
  };
}

async function getPageContent(apiKey: string, pageId: string): Promise<string> {
  try {
    const res = await fetch(`${BASE}/blocks/${pageId}/children?page_size=50`, {
      headers: headers(apiKey),
    });
    const data = await res.json() as { results?: any[] };
    return (data.results ?? [])
      .filter((b: any) => b.type === 'paragraph')
      .map((b: any) =>
        (b.paragraph?.rich_text ?? []).map((r: any) => r.text?.content ?? '').join(''),
      )
      .filter((line: string) => line.trim().length > 0)
      .join('\n');
  } catch {
    return '';
  }
}

export async function getRecentSessions(
  apiKey: string,
  databaseId: string,
  days = 14,
): Promise<NotionSession[]> {
  const since = new Date();
  since.setDate(since.getDate() - days);

  const res = await fetch(`${BASE}/databases/${databaseId}/query`, {
    method: 'POST',
    headers: headers(apiKey),
    body: JSON.stringify({
      filter: { property: 'Date', date: { on_or_after: since.toISOString().split('T')[0] } },
      sorts: [{ property: 'Date', direction: 'descending' }],
      page_size: 30,
    }),
  });

  const data = await res.json() as { results?: any[] };
  const sessions = (data.results ?? []).map(parseSession);

  // Fetch page body content for the last 2 sessions of each split.
  // Results are sorted newest-first. We need 2 per split so Claude can:
  // 1. See exact weights used last session (progressive overload)
  // 2. See which exercises were chosen last time (rotation — don't repeat same B1)
  const splitCounts = new Map<string, number>();
  const contentFetches: Promise<void>[] = [];

  for (const session of sessions) {
    if (['Rest/Recovery', 'Other'].includes(session.split)) continue;
    const count = splitCounts.get(session.split) ?? 0;
    if (count < 2) {
      splitCounts.set(session.split, count + 1);
      contentFetches.push(
        getPageContent(apiKey, session.id).then((content) => {
          session.pageContent = content;
        }),
      );
    }
  }

  await Promise.all(contentFetches);
  return sessions;
}

export async function createWorkoutPage(
  apiKey: string,
  databaseId: string,
  sessionTitle: string,
  date: string,
  split: string,
  gym: string,
  blocks: WorkoutBlock[],
  extras: string[],
): Promise<string> {
  const paragraphs = (texts: string[]) =>
    texts.map((t) => ({
      object: 'block',
      type: 'paragraph',
      paragraph: { rich_text: [{ type: 'text', text: { content: t } }] },
    }));

  const children = [
    ...paragraphs(blocks.map((b) => `${b.label} — ${b.exercise} — ${b.prescription}`)),
    { object: 'block', type: 'divider', divider: {} },
    ...paragraphs(extras),
  ];

  const res = await fetch(`${BASE}/pages`, {
    method: 'POST',
    headers: headers(apiKey),
    body: JSON.stringify({
      parent: { database_id: databaseId },
      properties: {
        Session: { title: [{ text: { content: sessionTitle } }] },
        Date: { date: { start: date } },
        Split: { select: { name: split } },
        Gym: { select: { name: gym } },
        'Knee Feel': { select: { name: 'N/A' } },
      },
      children,
    }),
  });

  const page = await res.json() as { id: string };
  return page.id;
}

export async function updateWorkoutPage(
  apiKey: string,
  pageId: string,
  updates: { duration?: number; kneeFeel?: string; notes?: string; isPR?: boolean },
): Promise<void> {
  const properties: Record<string, unknown> = {};
  if (updates.duration !== undefined) properties['Duration (min)'] = { number: updates.duration };
  if (updates.kneeFeel) properties['Knee Feel'] = { select: { name: updates.kneeFeel } };
  if (updates.notes) properties['Notes'] = { rich_text: [{ text: { content: updates.notes } }] };
  if (updates.isPR !== undefined) properties['PR'] = { checkbox: updates.isPR };

  await fetch(`${BASE}/pages/${pageId}`, {
    method: 'PATCH',
    headers: headers(apiKey),
    body: JSON.stringify({ properties }),
  });
}

export { notionPageUrl };
