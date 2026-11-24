import { expect, type APIRequestContext } from '@playwright/test';

export async function submitSession(request: APIRequestContext, sessionName: string): Promise<void> {
  await request.post('/api/sessions/submit', { data: { sessionName } });
  // Garde : l'action attend que le moteur ait traité la session ; ce n'est pas un contrôle.
  await expect.poll(async () => (await request.get('/api/sessions/state')).status()).toBe(200);
}

export async function sendDecision(request: APIRequestContext, decision: string, data: object = {}): Promise<void> {
  await request.post('/api/back-office/decision', { data: { decision, ...data } });
}
