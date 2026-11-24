import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Historique git fictif du dépôt workflow du corpus (versions BPMN, §12).
 * Le dépôt de l'outil n'embarque aucun dépôt git imbriqué : ce générateur le
 * fabrique dans un dossier jetable, à partir du BPMN du corpus.
 *
 *   origin.git            dépôt distant (bare)
 *   workflow/             clone local, sur `main` au commit de la 3.2.0
 *
 * Historique de `main` (distant) :
 *   3.0.0  processus initial                                   [PILOT-101]
 *          branche anti-fraude                                 [PILOT-114]
 *          e-mail conseiller (pièces complémentaires)          [PILOT-120]
 *   3.1.0  version
 *          signature : blocage après trois codes faux          [PILOT-131]
 *   3.2.0  version                          ← le clone local est ici (= BPMN du corpus)
 *          objet de bienvenue en anglais                       [PILOT-140]
 *   3.3.0  version                          ← pas encore récupérée
 *          relance des pièces tous les deux jours (non publié) [PILOT-145]
 * Branche distante non fusionnée : feature/PILOT-150-liveness (contrôle de vivacité).
 */

const BPMN_REL = 'processes/pilot-account-opening/pilot-account-opening.bpmn';
const PKG_REL = 'processes/pilot-account-opening/package.json';
const CORPUS_BPMN = fileURLToPath(new URL(`../workflow/${BPMN_REL}`, import.meta.url));

/** Retire un élément BPMN par id (auto-fermé ou avec contenu). */
function remove(xml: string, id: string): string {
  const self = new RegExp(`\\s*<bpmn:(\\w+) id="${id}"[^>]*/>`);
  const block = new RegExp(`\\s*<bpmn:(\\w+) id="${id}"[^>]*[^/]>[\\s\\S]*?</bpmn:\\1>`);
  const out = self.test(xml) ? xml.replace(self, '') : xml.replace(block, '');
  if (out === xml) throw new Error(`élément introuvable : ${id}`);
  return out;
}
function replace(xml: string, from: string, to: string): string {
  if (!xml.includes(from)) throw new Error(`texte introuvable : ${from}`);
  return xml.replace(from, to);
}

export function bpmnVersions(current = readFileSync(CORPUS_BPMN, 'utf8')) {
  const v320 = current;
  let v310 = v320;
  for (const id of ['sig_f4', 'sig_blocked', 'sig_f6', 'sig_end_locked']) v310 = remove(v310, id);
  let withFraud = v310;
  withFraud = remove(withFraud, 'email_advisor');
  withFraud = remove(withFraud, 'rev_f_adv');
  withFraud = replace(withFraud, 'sourceRef="rev_gw" targetRef="email_advisor"', 'sourceRef="rev_gw" targetRef="rev_end"');
  let v300 = withFraud;
  for (const id of ['fraud-check', 'rev_fraud', 'rev_f_fraud']) v300 = remove(v300, id);
  const v330 = replace(v320, 'Welcome aboard', 'Welcome to your new account');
  const v331 = replace(v330, 'R3/P3D', 'R3/P2D');
  const liveness = replace(
    replace(v320, '<bpmn:sequenceFlow id="scan_f1" sourceRef="scan_start" targetRef="scan_session" />', '<bpmn:sequenceFlow id="scan_f1" sourceRef="scan_start" targetRef="scan_liveness" />'),
    '<bpmn:serviceTask id="scan_session" name="Identity session">',
    `<bpmn:serviceTask id="scan_liveness" name="Liveness check">
        <bpmn:extensionElements><zeebe:taskDefinition type="liveness-check" /></bpmn:extensionElements>
      </bpmn:serviceTask>
      <bpmn:sequenceFlow id="scan_f_live" sourceRef="scan_liveness" targetRef="scan_session" />
      <bpmn:serviceTask id="scan_session" name="Identity session">`,
  );
  return { v300, withFraud, v310, v320, v330, v331, liveness };
}

export interface WorkflowHistory {
  root: string;
  origin: string;
  workflow: string;
  bpmnDir: string;
}

export function makeWorkflowHistory(root: string): WorkflowHistory {
  rmSync(root, { recursive: true, force: true });
  const origin = join(root, 'origin.git');
  const workflow = join(root, 'workflow');
  mkdirSync(root, { recursive: true });
  let day = 0;
  // Isolé de la config git de l'utilisateur (identité, signature, hooks).
  const env = (): NodeJS.ProcessEnv => {
    const date = new Date(Date.UTC(2026, 8, 1 + day * 3, 9, 0, 0)).toISOString();
    return {
      ...process.env,
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_AUTHOR_NAME: 'Corpus',
      GIT_AUTHOR_EMAIL: 'corpus@example.invalid',
      GIT_COMMITTER_NAME: 'Corpus',
      GIT_COMMITTER_EMAIL: 'corpus@example.invalid',
      GIT_AUTHOR_DATE: date,
      GIT_COMMITTER_DATE: date,
    };
  };
  const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'core.hooksPath=/dev/null', ...args], { cwd, env: env(), stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  const v = bpmnVersions();
  const write = (bpmn?: string, version?: string) => {
    mkdirSync(join(workflow, 'processes/pilot-account-opening'), { recursive: true });
    if (bpmn) writeFileSync(join(workflow, BPMN_REL), bpmn);
    if (version) writeFileSync(join(workflow, PKG_REL), JSON.stringify({ name: '@corpus/pilot-account-opening-process', version }, null, 2) + '\n');
  };
  const commit = (subject: string, bpmn?: string, version?: string) => {
    day++;
    write(bpmn, version);
    git(workflow, 'add', '-A');
    git(workflow, 'commit', '-q', '-m', subject);
    return git(workflow, 'rev-parse', 'HEAD');
  };

  git(root, 'init', '-q', '--bare', '-b', 'main', origin);
  git(root, 'init', '-q', '-b', 'main', workflow);
  writeFileSync(join(workflow, 'README.md'), '# Dépôt workflow (corpus fictif)\n');
  commit('Processus pilote initial [PILOT-101]', v.v300, '3.0.0');
  commit('Branche anti-fraude après la revue [PILOT-114]', v.withFraud);
  commit('E-mail conseiller pour les pièces complémentaires [PILOT-120]', v.v310);
  commit('Version 3.1.0', undefined, '3.1.0');
  commit('Signature : blocage après trois codes faux [PILOT-131]', v.v320);
  const local = commit('Version 3.2.0', undefined, '3.2.0');
  writeFileSync(join(workflow, 'README.md'), '# Dépôt workflow (corpus fictif)\n\nUn processus par dossier.\n');
  commit('Documentation du dépôt'); // hors BPMN : ne doit apparaître nulle part
  git(workflow, 'remote', 'add', 'origin', origin);

  // Branche non fusionnée, partant de la 3.2.0.
  git(workflow, 'checkout', '-q', '-b', 'feature/PILOT-150-liveness', local);
  commit('Contrôle de vivacité avant la capture [PILOT-150]', v.liveness);
  git(workflow, 'push', '-q', 'origin', 'feature/PILOT-150-liveness');
  git(workflow, 'checkout', '-q', 'main');
  git(workflow, 'branch', '-q', '-D', 'feature/PILOT-150-liveness');

  commit('Objet de bienvenue en anglais [PILOT-140]', v.v330);
  commit('Version 3.3.0', undefined, '3.3.0');
  commit('Relance des pièces tous les deux jours [PILOT-145]', v.v331);
  git(workflow, 'push', '-q', 'origin', 'main');

  // Le clone local revient à la 3.2.0 et « oublie » le distant : un fetch le lui apprendra.
  git(workflow, 'reset', '-q', '--hard', local);
  git(workflow, 'config', 'branch.main.remote', 'origin');
  git(workflow, 'config', 'branch.main.merge', 'refs/heads/main');
  git(workflow, 'update-ref', '-d', 'refs/remotes/origin/main');
  git(workflow, 'update-ref', '-d', 'refs/remotes/origin/feature/PILOT-150-liveness');
  return { root, origin, workflow, bpmnDir: 'processes/pilot-account-opening' };
}
