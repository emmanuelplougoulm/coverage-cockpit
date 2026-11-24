import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { JourneyConfig } from '../../core/journey';
import type { TicketsResult } from '../../core/tickets';
import { readJson, writeJsonAtomic } from '../store/dataDir';
import { readLastViews } from '../store/cache';
import { toTicket, type DeduceContext } from './deduce';
import { fakeTransport, fetchTransport, JiraClient, tokenFromKeychain, type JiraFields, type Transport } from './jira';

/**
 * Sous-commandes tickets (§9, §12). Configuration par variables d'environnement :
 * CC_JIRA_URL, CC_JIRA_KEYCHAIN_SERVICE (défaut « coverage-cockpit-jira »),
 * CC_JIRA_FIELD_BPMN / _TAXONOMY / _EPIC / _SPRINT. CC_JIRA_FAKE=<dossier> : faux Jira.
 */

const campaignPath = (dir: string) => join(dir, 'campaign.json');
export const readCampaign = (dir: string): Record<string, string> => readJson<Record<string, string>>(campaignPath(dir)) ?? {};

export function setCampaign(dir: string, journey: string, key: string | null): Record<string, string> {
  if (key !== null && !/^[A-Z][A-Z0-9]+-\d+$/.test(key)) throw new Error(`clé de ticket mal formée : ${key}`);
  const m = readCampaign(dir);
  if (key === null) delete m[journey];
  else m[journey] = key;
  writeJsonAtomic(campaignPath(dir), m);
  return m;
}

interface Setup {
  source: 'jira' | 'fake';
  baseUrl: string;
  token: string | null;
  transport: Transport;
  fields: JiraFields;
}

export function jiraSetup(env: NodeJS.ProcessEnv): Setup | { error: string } | null {
  const fake = env.CC_JIRA_FAKE?.trim();
  if (fake) {
    const f = join(fake, 'fields.json');
    const fields = existsSync(f) ? (JSON.parse(readFileSync(f, 'utf8')) as JiraFields) : {};
    return { source: 'fake', baseUrl: 'https://jira.example.invalid', token: null, transport: fakeTransport(fake), fields };
  }
  const url = env.CC_JIRA_URL?.trim();
  if (!url) return null;
  const service = env.CC_JIRA_KEYCHAIN_SERVICE?.trim() || 'coverage-cockpit-jira';
  const token = tokenFromKeychain(service);
  if (!token) return { error: `jeton introuvable dans le trousseau (service « ${service} »)` };
  const fields: JiraFields = {
    ...(env.CC_JIRA_FIELD_BPMN ? { bpmn: env.CC_JIRA_FIELD_BPMN } : {}),
    ...(env.CC_JIRA_FIELD_TAXONOMY ? { taxonomy: env.CC_JIRA_FIELD_TAXONOMY } : {}),
    ...(env.CC_JIRA_FIELD_EPIC ? { epic: env.CC_JIRA_FIELD_EPIC } : {}),
    ...(env.CC_JIRA_FIELD_SPRINT ? { sprint: env.CC_JIRA_FIELD_SPRINT } : {}),
  };
  return { source: 'jira', baseUrl: url, token, transport: fetchTransport, fields };
}

/** Clés de cas (tags `@<PROJ>-TC-<n>`) → parcours, d'après les dernières vues. */
export function caseKeysFromViews(dataDir: string): Map<string, Set<string>> {
  const m = new Map<string, Set<string>>();
  for (const l of readLastViews(dataDir)) {
    for (const v of Object.values(l.views)) {
      for (const tags of Object.values(v.testTags ?? {})) {
        for (const t of tags) if (/-TC-\d+$/.test(t)) m.set(t, (m.get(t) ?? new Set()).add(l.journey));
      }
    }
  }
  return m;
}

export async function listTickets(journeys: JourneyConfig[], dataDir: string, env: NodeJS.ProcessEnv = process.env, sleep?: (ms: number) => Promise<void>): Promise<TicketsResult> {
  const campaign = readCampaign(dataDir);
  const setup = jiraSetup(env);
  if (!setup) return { configured: false, source: null, tickets: [], campaign };
  if ('error' in setup) return { configured: true, source: 'jira', tickets: [], campaign, error: setup.error };
  try {
    const client = new JiraClient({ baseUrl: setup.baseUrl, token: setup.token, transport: setup.transport, ...(sleep ? { sleep } : {}) });
    const raw = await client.myOpenIssues(setup.fields);
    // Epic → parcours, par les tickets de campagne.
    const epics = new Map<string, Set<string>>();
    for (const r of raw as { key: string; fields: Record<string, unknown> }[]) {
      const journey = Object.entries(campaign).find(([, k]) => k === r.key)?.[0];
      const epic = setup.fields.epic ? r.fields?.[setup.fields.epic] : undefined;
      if (journey && typeof epic === 'string') epics.set(epic, (epics.get(epic) ?? new Set()).add(journey));
    }
    const ctx: DeduceContext = { journeys, caseKeys: caseKeysFromViews(dataDir), epics };
    return { configured: true, source: setup.source, tickets: raw.map((r) => toTicket(r, setup.baseUrl, setup.fields, ctx)), campaign };
  } catch (e) {
    return { configured: true, source: setup.source, tickets: [], campaign, error: e instanceof Error ? e.message : String(e) };
  }
}
