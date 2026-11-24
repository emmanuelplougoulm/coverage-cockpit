import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Client Jira Data Center (API REST v2), LECTURE SEULE. Jeton d'accès
 * personnel porteur, lu dans le trousseau macOS ; jamais affiché ni journalisé.
 * Reprise sur 429 / 503 avec temporisation (Retry-After, sinon exponentielle).
 */

export interface HttpResponse {
  status: number;
  text: string;
  headers: Record<string, string>;
}
export type Transport = (url: string, headers: Record<string, string>) => Promise<HttpResponse>;

export class JiraError extends Error {}

/** « code HTTP + 300 caractères du corps nettoyé du HTML ». */
export function httpError(status: number, body: string): JiraError {
  const clean = body.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return new JiraError(`HTTP ${status} : ${clean.slice(0, 300)}`);
}

export interface JiraFields {
  bpmn?: string;
  taxonomy?: string;
  epic?: string;
  sprint?: string;
}

export interface JiraClientOptions {
  baseUrl: string;
  token: string | null;
  transport: Transport;
  sleep?: (ms: number) => Promise<void>;
  retries?: number;
}

export class JiraClient {
  constructor(private readonly o: JiraClientOptions) {}

  async get(path: string): Promise<unknown> {
    const url = `${this.o.baseUrl.replace(/\/$/, '')}/rest/api/2/${path}`;
    const headers: Record<string, string> = { Accept: 'application/json', ...(this.o.token ? { Authorization: `Bearer ${this.o.token}` } : {}) };
    const sleep = this.o.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
    const retries = this.o.retries ?? 3;
    for (let attempt = 0; ; attempt++) {
      const res = await this.o.transport(url, headers);
      if (res.status >= 200 && res.status < 300) {
        try {
          return JSON.parse(res.text);
        } catch {
          throw new JiraError('réponse Jira illisible (JSON attendu)');
        }
      }
      if ((res.status === 429 || res.status === 503) && attempt < retries) {
        const after = Number(res.headers['retry-after']);
        await sleep(Number.isFinite(after) && after > 0 ? Math.min(after, 30) * 1000 : 1000 * 2 ** attempt);
        continue;
      }
      throw httpError(res.status, res.text);
    }
  }

  /** Tickets assignés à l'utilisateur et non terminés (≤ 100). */
  async myOpenIssues(fields: JiraFields): Promise<unknown[]> {
    const wanted = ['summary', 'description', 'status', 'issuetype', fields.bpmn, fields.taxonomy, fields.epic, fields.sprint].filter(Boolean).join(',');
    const jql = 'assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC';
    const r = (await this.get(`search?jql=${encodeURIComponent(jql)}&maxResults=100&fields=${encodeURIComponent(wanted)}`)) as { issues?: unknown[] };
    return r.issues ?? [];
  }
}

/** Jeton dans le trousseau macOS (`security`) ; null s'il n'y est pas. Jamais journalisé. */
export function tokenFromKeychain(service: string): string | null {
  try {
    const out = execFileSync('security', ['find-generic-password', '-s', service, '-w'], { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    return out || null;
  } catch {
    return null;
  }
}

export const fetchTransport: Transport = async (url, headers) => {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(30_000) });
  const h: Record<string, string> = {};
  res.headers.forEach((v, k) => (h[k.toLowerCase()] = v));
  return { status: res.status, text: await res.text(), headers: h };
};

/**
 * Faux Jira (corpus) : sert `search.json` et `issue-<KEY>.json` d'un dossier,
 * et `status.json` pour simuler une erreur ({ "status": 429, ... }).
 */
export function fakeTransport(dir: string): Transport {
  let calls = 0;
  return async (url) => {
    calls++;
    const forced = join(dir, 'status.json');
    if (existsSync(forced)) {
      const f = JSON.parse(readFileSync(forced, 'utf8')) as { status: number; body?: string; times?: number };
      if (!f.times || calls <= f.times) return { status: f.status, text: f.body ?? '', headers: {} };
    }
    const path = new URL(url).pathname.replace(/^.*\/rest\/api\/2\//, '');
    const file = path.startsWith('search') ? 'search.json' : path.startsWith('issue/') ? `issue-${path.slice(6)}.json` : null;
    if (!file || !existsSync(join(dir, file))) return { status: 404, text: '<html><body><h1>Not found</h1></body></html>', headers: {} };
    return { status: 200, text: readFileSync(join(dir, file), 'utf8'), headers: {} };
  };
}
