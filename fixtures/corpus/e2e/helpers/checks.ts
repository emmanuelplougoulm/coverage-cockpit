import { expect, type APIRequestContext } from '@playwright/test';

/** Contrôles back-office / API / document / e-mail : ce que les tests workflow prouvent. */

export async function checkDecision(request: APIRequestContext, expected: string): Promise<void> {
  const res = await request.get('/api/case/decision');
  expect((await res.json()).decision).toBe(expected);
}

export async function checkCaseStatus(request: APIRequestContext, status: string): Promise<void> {
  const res = await request.get('/api/case');
  expect((await res.json()).status).toBe(status);
}

export async function checkEmailContent(request: APIRequestContext, mailId: string, text: string): Promise<void> {
  const res = await request.get(`/api/mailbox/${mailId}`);
  expect(await res.text()).toContain(text);
}

/** Ne vérifie que la présence du document : un contrôle faible. */
export async function checkSignedDocument(request: APIRequestContext): Promise<void> {
  const res = await request.get('/api/case/documents/contract.pdf');
  expect(res.ok()).toBeTruthy();
}
