import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { deduceJourney, parseSprints, wikiToText } from '../src/engine/tickets/deduce';
import { fakeTransport, httpError, JiraClient, type HttpResponse } from '../src/engine/tickets/jira';
import { listTickets, readCampaign, setCampaign } from '../src/engine/tickets';
import { pilot } from '../src/journeys/pilot';

const FAKE = fileURLToPath(new URL('../fixtures/corpus/jira', import.meta.url));
const tmp = mkdtempSync(join(tmpdir(), 'cc-tickets-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));
const noSleep = async () => {};

describe('JiraClient', () => {
  it('reprend sur 429 / 503 avec Retry-After, puis abandonne', async () => {
    const waits: number[] = [];
    const seq: HttpResponse[] = [
      { status: 429, text: '', headers: { 'retry-after': '2' } },
      { status: 503, text: '', headers: {} },
      { status: 200, text: '{"ok":true}', headers: {} },
    ];
    const c = new JiraClient({ baseUrl: 'https://j', token: 't', transport: async () => seq.shift()!, sleep: async (ms) => void waits.push(ms) });
    expect(await c.get('x')).toEqual({ ok: true });
    expect(waits).toEqual([2000, 2000]);
    const always = new JiraClient({ baseUrl: 'https://j', token: 't', transport: async () => ({ status: 429, text: 'trop', headers: {} }), sleep: noSleep, retries: 2 });
    await expect(always.get('x')).rejects.toThrow('HTTP 429 : trop');
  });

  it('envoie le jeton en porteur, jamais dans l’URL', async () => {
    let seen: { url: string; headers: Record<string, string> } | null = null;
    const c = new JiraClient({ baseUrl: 'https://j/', token: 'SECRET', transport: async (url, headers) => ((seen = { url, headers }), { status: 200, text: '{}', headers: {} }) });
    await c.get('search?x=1');
    expect(seen!.url).toBe('https://j/rest/api/2/search?x=1');
    expect(seen!.url).not.toContain('SECRET');
    expect(seen!.headers.Authorization).toBe('Bearer SECRET');
  });

  it('formate une erreur : code + 300 caractères sans HTML', () => {
    const e = httpError(401, `<html><style>x{}</style><body><h1>Non autorisé</h1>${'a'.repeat(400)}</body></html>`);
    expect(e.message.startsWith('HTTP 401 : Non autorisé a')).toBe(true);
    expect(e.message.length).toBe('HTTP 401 : '.length + 300);
  });
});

describe('déduction du parcours', () => {
  const ctx = { journeys: [pilot], caseKeys: new Map([['@PILOT-TC-12', new Set([pilot.id])]]), epics: new Map() };
  const map = { bpmn: 'b', taxonomy: 't' };

  it('le premier indice qui désigne un seul parcours l’emporte ; les autres sont gardés', () => {
    const r = deduceJourney('[Ouverture] x', 'voir pilot-account-opening', { b: 'pilot-account-opening' }, map, ctx);
    expect(r).toMatchObject({ journey: pilot.id, decidedBy: 'bpmn-field', divergent: false });
    expect(r.hints.map((h) => h.kind)).toEqual(['bpmn-field', 'description', 'title-bracket']);
  });

  it('un indice qui ne désigne aucun parcours configuré laisse la main au suivant', () => {
    expect(deduceJourney('x', 'cite PILOT-TC-12', { b: 'loan' }, map, ctx)).toMatchObject({ journey: pilot.id, decidedBy: 'case-keys' });
    expect(deduceJourney('x', 'rien', {}, map, ctx)).toMatchObject({ journey: null, decidedBy: null, hints: [] });
  });

  it('signale des indices divergents', () => {
    const other = { ...pilot, id: 'loan', label: 'Prêt' };
    const r = deduceJourney('[Prêt] x', 'pilot-account-opening', {}, map, { ...ctx, journeys: [pilot, other] });
    expect(r).toMatchObject({ journey: pilot.id, decidedBy: 'description', divergent: true });
  });

  it('lit les sprints DC (chaînes) et récents (objets), nettoie le wiki', () => {
    expect(parseSprints(['x.Sprint@1[id=1,state=ACTIVE,name=Sprint 48,startDate=…]', { name: 'S49', state: 'future' }])).toEqual([
      { name: 'Sprint 48', state: 'ACTIVE' },
      { name: 'S49', state: 'FUTURE' },
    ]);
    expect(wikiToText('h3. Titre\n*gras* [lien|https://x]')).toBe('Titre\ngras lien');
  });
});

describe('listTickets (faux Jira du corpus)', () => {
  const dataDir = join(tmp, 'data');

  it('non configuré sans variable', async () => {
    expect(await listTickets([pilot], dataDir, {})).toEqual({ configured: false, source: null, tickets: [], campaign: {} });
  });

  it('lit, déduit et utilise l’epic du ticket de campagne', async () => {
    setCampaign(dataDir, pilot.id, 'PILOT-501');
    const r = await listTickets([pilot], dataDir, { CC_JIRA_FAKE: FAKE });
    expect(r.source).toBe('fake');
    const t = (k: string) => r.tickets.find((x) => x.key === k)!;
    expect(t('PILOT-150')).toMatchObject({ journey: pilot.id, decidedBy: 'bpmn-field', statusCategory: 'indeterminate', sprints: [{ name: 'Sprint 48', state: 'ACTIVE' }] });
    expect(t('LOAN-77').journey).toBeNull();
    expect(t('PILOT-501').decidedBy).toBe('epic');
    expect(t('PILOT-150').url).toBe('https://jira.example.invalid/browse/PILOT-150');
  });

  it('remonte une erreur HTTP sans rien casser', async () => {
    const dir = join(tmp, 'fake-err');
    rmSync(dir, { recursive: true, force: true });
    const { mkdirSync } = await import('node:fs');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'status.json'), JSON.stringify({ status: 500, body: '<p>Erreur interne</p>' }));
    const r = await listTickets([pilot], dataDir, { CC_JIRA_FAKE: dir }, noSleep);
    expect(r).toMatchObject({ configured: true, tickets: [], error: 'HTTP 500 : Erreur interne' });
    expect(await fakeTransport(dir)('https://j/rest/api/2/search', {})).toMatchObject({ status: 500 });
  });

  it('ticket de campagne : clé valide seulement, retrait', () => {
    expect(() => setCampaign(dataDir, pilot.id, 'pas une clé')).toThrow(/mal formée/);
    setCampaign(dataDir, pilot.id, null);
    expect(readCampaign(dataDir)).toEqual({});
  });
});
