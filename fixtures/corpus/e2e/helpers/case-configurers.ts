import type { APIRequestContext } from '@playwright/test';

export interface CaseParameters {
  locale?: string;
  channel?: 'online' | 'branch';
  cardRange?: string;
  documentsCount?: number;
}

/** Configurateur du parcours pilote : la langue par défaut est le français. */
export async function configureAccountOpeningCase(
  request: APIRequestContext,
  { locale = 'fr', channel = 'online', ...rest }: CaseParameters = {},
): Promise<string> {
  return createCase(request, 'pilot-account-opening', { locale, channel, ...rest });
}

/** Configurateur d'un autre parcours (ne doit pas compter pour le pilote). */
export async function configureLoanCase(request: APIRequestContext, params: CaseParameters = {}): Promise<string> {
  return createCase(request, 'loan', { ...params });
}

async function createCase(request: APIRequestContext, processId: string, data: object): Promise<string> {
  const res = await request.post('/api/cases', { data: { processId, ...data } });
  return (await res.json()).url as string;
}
