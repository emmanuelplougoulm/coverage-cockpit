import type { APIRequestContext } from '@playwright/test';

export async function findEmailBySubject(request: APIRequestContext, subject: string): Promise<string> {
  const res = await request.get('/api/mailbox', { params: { subject } });
  return (await res.json()).id as string;
}
