import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CaseDraft, CaseStatus } from '../../core/cases';
import { readJson, writeJsonAtomic } from '../store/dataDir';

/**
 * Outil de cas de test (§12). Les écritures n'ont lieu que sur clic confirmé
 * (l'UI appelle une sous-commande explicite par action). Prudence : la mise à
 * jour REMPLACE les étapes, donc on relit le cas avec ses pièces jointes avant ;
 * l'API ne sait pas supprimer ; un 404 = « n'existe plus ».
 */

export interface StoredCase {
  key: string;
  folder: string;
  status: CaseStatus;
  tags: string[];
  draft: CaseDraft;
  attachments: { step: number; name: string }[];
  requirements: string[];
}

export interface CaseClient {
  readonly kind: 'fake' | 'real';
  getCase(key: string): Promise<StoredCase | null>;
  createCase(folder: string, draft: CaseDraft, tags: string[]): Promise<string>;
  updateCase(key: string, draft: CaseDraft): Promise<void>;
  attach(key: string, step: number, file: string): Promise<void>;
  /** Écriture groupée : une seule notification côté outil. */
  setStatus(keys: string[], status: CaseStatus): Promise<void>;
  linkRequirement(key: string, issue: string): Promise<void>;
}

/** Faux outil (corpus, tests) : un fichier JSON dans le dossier de données. */
export class FakeCaseClient implements CaseClient {
  readonly kind = 'fake' as const;
  constructor(private readonly file: string, private readonly project = 'PILOT') {}
  private load(): { next: number; cases: Record<string, StoredCase> } {
    return readJson(this.file) ?? { next: 100, cases: {} };
  }
  private save(db: { next: number; cases: Record<string, StoredCase> }) {
    writeJsonAtomic(this.file, db);
  }
  async getCase(key: string) {
    return this.load().cases[key] ?? null;
  }
  async createCase(folder: string, draft: CaseDraft, tags: string[]) {
    const db = this.load();
    const key = `${this.project}-TC-${db.next++}`;
    db.cases[key] = { key, folder, status: 'Brouillon', tags, draft, attachments: [], requirements: [] };
    this.save(db);
    return key;
  }
  async updateCase(key: string, draft: CaseDraft) {
    const db = this.load();
    const c = db.cases[key];
    if (!c) throw new Error(`HTTP 404 : le cas ${key} n'existe plus`);
    // Comme l'outil réel : les étapes sont remplacées ; on garde les pièces jointes relues.
    c.draft = draft;
    this.save(db);
  }
  async attach(key: string, step: number, file: string) {
    const db = this.load();
    const c = db.cases[key];
    if (!c) throw new Error(`HTTP 404 : le cas ${key} n'existe plus`);
    if (!existsSync(file)) throw new Error(`pièce jointe introuvable : ${file}`);
    c.attachments.push({ step, name: file.split('/').at(-1)! });
    this.save(db);
  }
  async setStatus(keys: string[], status: CaseStatus) {
    const db = this.load();
    for (const k of keys) if (db.cases[k]) db.cases[k]!.status = status;
    this.save(db);
  }
  async linkRequirement(key: string, issue: string) {
    const db = this.load();
    const c = db.cases[key];
    if (!c) throw new Error(`HTTP 404 : le cas ${key} n'existe plus`);
    if (!c.requirements.includes(issue)) c.requirements.push(issue);
    this.save(db);
  }
}

/**
 * Client réel : l'API REST de l'outil n'est pas branchée dans cette version
 * (endpoints à confirmer sur l'instance). Il refuse plutôt que de deviner.
 */
export class UnwiredCaseClient implements CaseClient {
  readonly kind = 'real' as const;
  private fail(): never {
    throw new Error("client de l'outil de cas de test non branché : endpoints REST à confirmer sur l'instance (aucune écriture faite)");
  }
  async getCase(): Promise<StoredCase | null> {
    return this.fail();
  }
  async createCase(): Promise<string> {
    return this.fail();
  }
  async updateCase() {
    this.fail();
  }
  async attach() {
    this.fail();
  }
  async setStatus() {
    this.fail();
  }
  async linkRequirement() {
    this.fail();
  }
}

export function caseClient(dataDir: string, env: NodeJS.ProcessEnv = process.env): CaseClient {
  if (env.CC_CASES_FAKE === '1') return new FakeCaseClient(join(dataDir, 'fake-cases.json'), env.CC_CASES_PROJECT ?? 'PILOT');
  return new UnwiredCaseClient();
}

/** Dossier du cas : `<CLIENT> / n. <processus>`, sous-catégorie passants / erreurs d'après les tags. */
export function caseFolder(processId: string, tags: string[], env: NodeJS.ProcessEnv = process.env): string {
  const client = env.CC_CASES_CLIENT ?? 'CLIENT';
  const sad = tags.some((t) => /SAD/i.test(t));
  return `${client} / n. ${processId} / ${sad ? 'Erreurs' : 'Passants'}`;
}

export const readFileMaybe = (p: string) => (existsSync(p) ? readFileSync(p, 'utf8') : null);
