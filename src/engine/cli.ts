import { existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { Suite } from '../core/coverage';
import type { JourneyConfig } from '../core/journey';
import { journeyFiles, journeys, PILOT_ID } from '../journeys';
import { summarizeJourneys } from './journeys';
import { resolveRepos } from './repos';
import { cachedCoverage, readHistory, readLastViews } from './store/cache';
import { dataDir, readJson, writeJsonAtomic } from './store/dataDir';
import { readAside, readSmokeValidations, setAside, setSmokeValidation } from './store/decisions';
import { familiesOf, smokeOf, tagIssues } from '../core/families';
import { join } from 'node:path';

/**
 * Moteur en ligne de commande (§11). Chaque sous-commande imprime du JSON sur
 * stdout ; toute erreur sort avec un code ≠ 0 et un message sur stderr.
 * Rejouable à la main : `pnpm -s engine journeys`, ou `pnpm -s corpus coverage <id>`.
 *
 * Les modules lourds (ts-morph, xmldom) ne sont chargés que par les
 * sous-commandes qui analysent : `last-views` répond sans eux.
 */

export class UsageError extends Error {}

type Command = (args: string[]) => unknown | Promise<unknown>;

export const TOOL_ROOT = fileURLToPath(new URL('../../', import.meta.url));

function journeyArg(args: string[], command: string): JourneyConfig {
  const id = args[0];
  if (!id) throw new UsageError(`usage : ${command} <parcours>${command === 'coverage' ? ' [--suite ui|workflow] [--force]' : command === 'history' ? ' [--suite ui|workflow]' : ''}`);
  const config = journeys.find((j) => j.id === id);
  if (!config) throw new UsageError(`parcours inconnu : ${id} (connus : ${journeys.map((j) => j.id).join(', ')})`);
  return config;
}

function opt(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

function suiteArg(args: string[]): Suite {
  const i = args.indexOf('--suite');
  if (i < 0) return 'ui';
  const v = args[i + 1];
  if (v !== 'ui' && v !== 'workflow') throw new UsageError('--suite attend ui ou workflow');
  return v;
}

async function coverage(args: string[]) {
  const config = journeyArg(args, 'coverage');
  const suite = suiteArg(args);
  const { views, cache } = await journeyViews(config, args.includes('--force'));
  return { view: views[suite], cache: cache[suite] };
}

/** Les deux vues d'un parcours, par le cache. */
async function journeyViews(config: JourneyConfig, force: boolean) {
  const repos = resolveRepos();
  return cachedCoverage(config, {
    repos,
    dataDir: dataDir(),
    toolRoot: TOOL_ROOT,
    journeyFile: journeyFiles[config.id] ?? 'src/journeys/index.ts',
    force,
    compute: async (log) => {
      const { loadKnowledge } = await import('./knowledge/load');
      return (await import('./analyze')).analyzeJourney(config, repos, log, loadKnowledge(`${TOOL_ROOT}knowledge`));
    },
  });
}

/** Dernière visite : `visit` la lit, `visit --mark` la remplace par maintenant et rend la précédente. */
function visit(args: string[]) {
  const path = join(dataDir(), 'visit.json');
  const prev = readJson<{ at: string }>(path)?.at ?? null;
  if (args.includes('--mark')) writeJsonAtomic(path, { at: new Date().toISOString() });
  return { previous: prev };
}

/** Plan des gains rapides (aperçu en hunks) ; `--test <titre complet>` (répétable) pour restreindre. */
async function capturesPlan(args: string[], usage: string) {
  const config = journeyArg(args, usage);
  const tests = args.flatMap((a, i) => (args[i - 1] === '--test' ? [a] : []));
  const repos = resolveRepos();
  const { views } = await journeyViews(config, false);
  const src = await import('./sources');
  const cap = await import('./captures');
  const plan = cap.planCaptures(config, views.ui, src.readTests(config, repos), src.readFront(config, repos), tests);
  plan.hunks = cap.hunksOf(repos.e2e.path, plan.insertions);
  return { plan };
}

/** Environnement des agents : dépôts, dossier de données, outil. */
const agentEnv = () => ({ repos: resolveRepos(), dataDir: dataDir(), toolRoot: TOOL_ROOT });

function textArg(args: string[], from: number, usage: string): string {
  const text = args.slice(from).filter((a, i, all) => !a.startsWith('--') && !(i > 0 && ['--branch', '--phase'].includes(all[i - 1]!))).join(' ').trim();
  if (!text) throw new UsageError(usage);
  return text;
}

/** Sous-commandes des agents (§11) : lancement détaché, suite, arrêt, listes, coûts. */
function agentCommands(): Record<string, Command> {
  const a = async () => import('./agents');
  const start = (kind: import('../core/agents').RunKind, usage: string, needsJourney = true) => async (args: string[]) => {
    const config = needsJourney ? journeyArg(args, usage) : null;
    const text = textArg(args, needsJourney ? 1 : 0, `usage : ${usage}`);
    const campaign = (await import('./tickets')).readCampaign(dataDir());
    const branchName = opt(args, '--branch');
    return (await a()).startRun(agentEnv(), kind, config, text, {
      campaignKey: config ? (campaign[config.id] ?? null) : null,
      branch: { stay: args.includes('--stay'), ...(branchName ? { name: branchName } : {}) },
    });
  };
  const reply = (usage: string) => async (args: string[]) => {
    const id = args[0];
    if (!id) throw new UsageError(`usage : ${usage}`);
    const text = args.slice(1).filter((x, i, all) => x !== '--phase' && all[i - 1] !== '--phase').join(' ').trim();
    return (await a()).replyRun(agentEnv(), id, text, opt(args, '--phase'));
  };
  const runId = (args: string[], usage: string) => {
    if (!args[0]) throw new UsageError(`usage : ${usage} <run>`);
    return args[0];
  };
  const list = (kind: import('../core/agents').RunKind) => async (args: string[]) => {
    const { summarize } = await import('./agents/runs');
    return { runs: (await a()).listRuns(agentEnv(), kind).filter((r) => !args[0] || r.journey === args[0]).map(summarize) };
  };
  return {
    'create-test': start('generation', 'create-test <parcours> <demande…> [--branch nom | --stay]'),
    generation: async (args) => (await a()).getRun(agentEnv(), runId(args, 'generation')),
    'generation-reply': reply('generation-reply <run> <texte…> [--phase code]'),
    'generation-stop': async (args) => (await a()).stopRun(agentEnv(), runId(args, 'generation-stop')),
    'generation-close': async (args) => (await a()).setRunStatus(agentEnv(), runId(args, 'generation-close'), 'closed'),
    'generation-reopen': async (args) => (await a()).setRunStatus(agentEnv(), runId(args, 'generation-reopen'), 'waiting'),
    generations: list('generation'),
    ask: start('request', 'ask <parcours> <question…>'),
    'ask-reply': reply('ask-reply <run> <texte…>'),
    'request-close': async (args) => (await a()).setRunStatus(agentEnv(), runId(args, 'request-close'), 'closed'),
    'request-stop': async (args) => (await a()).stopRun(agentEnv(), runId(args, 'request-stop')),
    request: async (args) => (await a()).getRun(agentEnv(), runId(args, 'request')),
    requests: list('request'),
    // Onboarding : parcours configuré OU processus pas encore configuré (survey).
    onboard: async (args) => {
      const id = args[0];
      if (!id) throw new UsageError('usage : onboard <parcours ou processus>');
      const config = journeys.find((j) => j.id === id) ?? null;
      return (await a()).startRun(agentEnv(), 'onboarding', config, id, { title: `Onboarding ${id}` });
    },
    'onboard-reply': reply('onboard-reply <run> <texte…>'),
    'onboarding-stop': async (args) => (await a()).stopRun(agentEnv(), runId(args, 'onboarding-stop')),
    onboarding: async (args) => (await a()).getRun(agentEnv(), runId(args, 'onboarding')),
    onboardings: list('onboarding'),
    'aio-case-draft': start('case-draft', 'aio-case-draft <parcours> <titre complet du test…>'),
    'sdk-analyse': async (args) => {
      const key = args[0];
      if (!key) throw new UsageError('usage : sdk-analyse <CLÉ>');
      const t = (await (await import('./tickets')).listTickets(journeys, dataDir())).tickets.find((x) => x.key === key);
      if (!t) throw new UsageError(`ticket introuvable : ${key}`);
      const repos = resolveRepos();
      const fronts = journeys.map((j) => `${j.id} → ${repos.front.path}/${j.frontPackage}`).join('\n');
      return (await a()).startRun(agentEnv(), 'sdk-analysis', null, `${t.key} — ${t.summary}\n${t.description}\n---\n${fronts}`, { title: `${t.key} — ${t.summary}` });
    },
    'sdk-analyses': list('sdk-analysis'),
    run: async (args) => (await a()).getRun(agentEnv(), runId(args, 'run')),
    'run-stop': async (args) => (await a()).stopRun(agentEnv(), runId(args, 'run-stop')),
    'active-runs': async () => {
      const { summarize } = await import('./agents/runs');
      return { runs: (await a()).listRuns(agentEnv()).filter((r) => r.status === 'running').map(summarize) };
    },
    'recent-runs': async () => {
      const { summarize } = await import('./agents/runs');
      return { runs: (await a()).listRuns(agentEnv()).slice(0, 30).map(summarize) };
    },
    spend: async () => (await import('./agents/runs')).spendOf((await a()).listRuns(agentEnv())),
    notify: async (args) => (await a()).notify(args[0] ?? 'Coverage Cockpit', args.slice(1).join(' ') || ''),
    'branch-choice': async (args) => {
      const config = journeyArg(args, 'branch-choice');
      const campaign = (await import('./tickets')).readCampaign(dataDir());
      return (await import('./agents/branch')).branchChoice(resolveRepos().e2e.path, config.id, (args[1] as import('../core/agents').RunKind) ?? 'generation', campaign[config.id] ?? null);
    },
  };
}

export const commands: Record<string, Command> = {
  journeys: () => summarizeJourneys(journeys, resolveRepos(), existsSync, PILOT_ID),
  bpmn: async (args) => (await import('./sources')).readBpmn(journeyArg(args, 'bpmn'), resolveRepos()),
  front: async (args) => (await import('./sources')).readFront(journeyArg(args, 'front'), resolveRepos()),
  scan: async (args) => (await import('./sources')).readTests(journeyArg(args, 'scan'), resolveRepos()),
  coverage,
  'last-views': () => ({ journeys: readLastViews(dataDir()) }),
  visit,
  aside: (args) => {
    const config = journeyArg(args, 'aside');
    return { journey: config.id, aside: readAside(dataDir(), config.id), smoke: readSmokeValidations(dataDir(), config.id) };
  },
  'aside-set': (args) => {
    const config = journeyArg(args, 'aside-set');
    const [, ref, ...rest] = args;
    if (!ref) throw new UsageError('usage : aside-set <parcours> <GROUP.KEY> <raison…> | --remove');
    const remove = rest.includes('--remove');
    return { journey: config.id, aside: setAside(dataDir(), config.id, ref, remove ? null : rest.join(' ')) };
  },
  'smoke-validate': (args) => {
    const config = journeyArg(args, 'smoke-validate');
    const [, key, ...rest] = args;
    if (!key) throw new UsageError('usage : smoke-validate <parcours> <chemin>|<langue> <titre complet du test> | --remove');
    const remove = rest.includes('--remove');
    return { journey: config.id, smoke: setSmokeValidation(dataDir(), config.id, key, remove ? null : rest.join(' ')) };
  },
  versions: async (args) => (await import('./versions')).allVersions(journeys, resolveRepos(), dataDir(), args.includes('--fetch')),
  seen: async () => ({ seen: (await import('./versions')).readSeen(dataDir()) }),
  'seen-set': async (args) => {
    const config = journeyArg(args, 'seen-set');
    const version = args[1];
    if (!version) throw new UsageError('usage : seen-set <parcours> <version>');
    return { seen: (await import('./versions')).markSeen(dataDir(), config.id, version) };
  },
  'bpmn-diff': async (args) => {
    const config = journeyArg(args, 'bpmn-diff');
    const [, from, to] = args;
    if (!from || !to) throw new UsageError('usage : bpmn-diff <parcours> <de> <à> (version, commit ou « local »)');
    const v = await import('./versions');
    const { diffBpmn } = await import('./versions/diff');
    const repos = resolveRepos();
    return { journey: config.id, from, to, diff: diffBpmn(v.modelAt(config, repos, from).model, v.modelAt(config, repos, to).model) };
  },
  impacts: async (args) => {
    const config = journeyArg(args, 'impacts');
    const v = await import('./versions');
    const repos = resolveRepos();
    const range = v.defaultRange(config, repos, dataDir());
    const { views } = await journeyViews(config, false);
    return v.impactsBetween(config, repos, views, opt(args, '--from') ?? range.from, opt(args, '--to') ?? range.to);
  },
  'bpmn-xml': async (args) => {
    const config = journeyArg(args, 'bpmn-xml');
    const raw = (await import('./versions')).modelAt(config, resolveRepos(), opt(args, '--at') ?? 'local').xml;
    const { withLayout } = await import('./bpmnLayout');
    return { journey: config.id, at: opt(args, '--at') ?? 'local', ...withLayout(raw) };
  },
  ...agentCommands(),
  'onboard-survey': async () => ({ processes: (await import('./onboard')).survey(resolveRepos(), journeys) }),
  'onboard-report': async (args) => {
    const id = args[0];
    if (!id) throw new UsageError('usage : onboard-report <processus>');
    const { readFileMaybe } = await import('./cases/client');
    const dir = `${dataDir()}/onboarding-drafts/${id}`;
    return { process: id, report: readFileMaybe(`${dir}/rapport.md`), draft: readFileMaybe(`${dir}/brouillon.ts`) };
  },
  'aio-cases': async (args) => {
    const config = journeyArg(args, 'aio-cases');
    const { views } = await journeyViews(config, false);
    return { journey: config.id, rows: await (await import('./cases')).caseRows(dataDir(), [views.ui, views.workflow]) };
  },
  'aio-case-push': async (args) => {
    const config = journeyArg(args, 'aio-case-push');
    const runIdArg = args[1];
    if (!runIdArg) throw new UsageError('usage : aio-case-push <parcours> <run du brouillon>');
    const run = (await import('./agents')).getRun(agentEnv(), runIdArg);
    if (run.kind !== 'case-draft' || run.status === 'running') throw new UsageError('le run doit être un brouillon de cas terminé');
    const { views } = await journeyViews(config, false);
    const view = views.ui.tests.some((t) => t.id === run.title) ? views.ui : views.workflow;
    const last = run.turns.at(-1);
    return (await import('./cases')).pushCase(dataDir(), resolveRepos(), view, run.title, last?.result ?? last?.messages.at(-1) ?? '');
  },
  'aio-case-set': async (args) => {
    const status = args[0];
    if (status !== 'Publié' && status !== 'Automatisé' && status !== 'Brouillon') throw new UsageError('usage : aio-case-set <Brouillon|Publié|Automatisé> <clés…>');
    return (await import('./cases')).setCaseStatus(dataDir(), args.slice(1), status);
  },
  'aio-link': async (args) => {
    if (!args[0] || !args[1]) throw new UsageError('usage : aio-link <clé du cas> <clé du ticket>');
    return (await import('./cases')).linkRequirement(dataDir(), args[0], args[1]);
  },
  'aio-case-key': async (args) => {
    const config = journeyArg(args, 'aio-case-key');
    const test = opt(args, '--test');
    if (!test) throw new UsageError('usage : aio-case-key <parcours> --test <titre complet> [--apply]');
    const cases = await import('./cases');
    const link = cases.readLinks(dataDir())[test];
    if (!link) throw new UsageError('aucun cas lié à ce test');
    const { views } = await journeyViews(config, false);
    const ref = [...views.ui.tests, ...views.workflow.tests].find((t) => t.id === test);
    if (!ref) throw new UsageError('test introuvable');
    return cases.writeKey(resolveRepos(), ref.file, ref.line, link.key, args.includes('--apply'));
  },
  captures: async (args) => capturesPlan(args, 'captures'),
  'apply-captures': async (args) => {
    const { plan } = await capturesPlan(args, 'apply-captures');
    return (await import('./captures')).applyCaptures(resolveRepos(), plan);
  },
  tickets: async () => (await import('./tickets')).listTickets(journeys, dataDir()),
  'campaign-tickets': async () => ({ campaign: (await import('./tickets')).readCampaign(dataDir()) }),
  'campaign-ticket': async (args) => {
    const config = journeyArg(args, 'campaign-ticket');
    const key = args[1];
    if (!key) throw new UsageError('usage : campaign-ticket <parcours> <CLÉ> | --remove');
    return { campaign: (await import('./tickets')).setCampaign(dataDir(), config.id, key === '--remove' ? null : key) };
  },
  assertions: async (args) => {
    const config = journeyArg(args, 'assertions');
    const { views } = await journeyViews(config, false);
    const { loadKnowledge } = await import('./knowledge/load');
    const { auditAssertions } = await import('./knowledge/audit');
    return auditAssertions(views.workflow, loadKnowledge(`${TOOL_ROOT}knowledge`));
  },
  register: async (args) => {
    const config = journeyArg(args, 'register');
    const { views } = await journeyViews(config, false);
    const validations = readSmokeValidations(dataDir(), config.id);
    return {
      journey: config.id,
      register: familiesOf(views.ui, readAside(dataDir(), config.id), views.workflow),
      smoke: smokeOf(views.ui, validations),
      tagIssues: tagIssues(views.ui),
    };
  },
  sketches: async (args) => {
    const config = journeyArg(args, 'sketches');
    const front = (await import('./sources')).readFront(config, resolveRepos());
    return { journey: config.id, texts: front.texts };
  },
  thumbnails: async (args) => {
    const config = journeyArg(args, 'thumbnails');
    const { views } = await journeyViews(config, false);
    return (await import('./media')).thumbnailsOf(config.id, views, resolveRepos().e2e.path, dataDir());
  },
  image: async (args) => {
    const config = journeyArg(args, 'image');
    const file = args[1];
    if (!file) throw new UsageError('usage : image <parcours> <fichier> [--open]');
    void config;
    return (await import('./media')).imageOf(resolveRepos().e2e.path, file, args.includes('--open'));
  },
  history: (args) => {
    const config = journeyArg(args, 'history');
    return { journey: config.id, suite: suiteArg(args), snapshots: readHistory(dataDir(), config.id, suiteArg(args)) };
  },
};

export async function runCommand(argv: string[], table: Record<string, Command> = commands): Promise<string> {
  const [name, ...rest] = argv;
  if (!name) throw new UsageError(`sous-commande attendue : ${Object.keys(table).join(', ')}`);
  const cmd = table[name];
  if (!cmd) throw new UsageError(`sous-commande inconnue : ${name} (connues : ${Object.keys(table).join(', ')})`);
  return JSON.stringify(await cmd(rest));
}

async function main(): Promise<void> {
  try {
    process.stdout.write((await runCommand(process.argv.slice(2))) + '\n');
  } catch (err) {
    process.stderr.write((err instanceof Error ? err.message : String(err)) + '\n');
    process.exitCode = err instanceof UsageError ? 2 : 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void main();
