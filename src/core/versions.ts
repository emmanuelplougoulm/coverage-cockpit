import type { TestRef } from './coverage';

/** Contrat des versions BPMN (§5.1 diff, §12 git), partagé moteur ↔ UI. */

export type DiffReason = 'name' | 'wiring' | 'configuration' | 'condition';

export interface DiffItem {
  id: string;
  type: string;
  name?: string;
  /** Sous-processus englobants. */
  scope: string[];
}

export interface BpmnDiff {
  added: DiffItem[];
  removed: DiffItem[];
  modified: (DiffItem & { reasons: DiffReason[] })[];
  sessions: { added: string[]; removed: string[] };
  emails: { added: string[]; removed: string[] };
  decisions: { added: string[]; removed: string[] };
}

export interface CommitInfo {
  hash: string;
  date: string;
  subject: string;
  /** Clés de tickets citées dans le sujet. */
  tickets: string[];
}

export interface PublishedVersion {
  version: string;
  commit: string;
  date: string;
  /** Commits qui touchent ce BPMN, livrés avec cette version (depuis la précédente). */
  commits: CommitInfo[];
  tickets: string[];
  /** Présente sur la branche principale distante mais pas encore dans le clone local. */
  remoteOnly: boolean;
}

export interface FetchResult {
  attempted: boolean;
  ok: boolean;
  error?: string;
  /** Le clone a avancé jusqu'à la branche distante. */
  updated: boolean;
  /** Pourquoi le clone n'a pas été avancé (sale, commits locaux, autre branche…). */
  skipped?: string;
}

export interface JourneyVersions {
  journey: string;
  /** Version du package.json dans le clone local. */
  localVersion: string | null;
  mainBranch: string | null;
  repo: { branch: string | null; clean: boolean; ahead: number; behind: number; isGit: boolean };
  versions: PublishedVersion[];
  /** Commits qui touchent ce BPMN après la dernière version publiée. */
  unpublished: CommitInfo[];
  /** Branches distantes non fusionnées qui touchent ce BPMN. */
  branches: { branch: string; commits: CommitInfo[]; tickets: string[] }[];
  /** Dernière version « vue » par l'utilisateur. */
  seen: string | null;
  latest: string | null;
  /** Versions publiées après celle vue. */
  newSinceSeen: string[];
  error?: string;
}

export interface VersionsResult {
  fetch: FetchResult;
  journeys: JourneyVersions[];
}

export interface ImpactedElement {
  id: string;
  type: string;
  name?: string;
  change: 'added' | 'removed' | 'modified';
  reasons?: DiffReason[];
  /** Sous-processus englobants. */
  scope: string[];
  /** direct : l'élément est lui-même relié (e-mail, branche, session) ; via : son sous-processus l'est. */
  kind: 'direct' | 'via-subprocess' | 'none';
  /** Sous-processus (session) par lequel passe l'impact. */
  via?: string;
  links: string[];
  tests: TestRef[];
}

export interface ImpactsResult {
  journey: string;
  from: string;
  to: string;
  diff: BpmnDiff;
  elements: ImpactedElement[];
  /** Par test : éléments qui le touchent directement ou par le sous-processus. */
  tests: { test: TestRef; suite: 'ui' | 'workflow'; direct: string[]; via: string[] }[];
}
