#!/usr/bin/env node
/**
 * Faux agent du corpus : imite la CLI Claude Code en mode non interactif
 * (`-p … --output-format stream-json`). Ne lit ni n'écrit aucun fichier :
 * il émet un flux scripté selon le type de run (marqueur `cc:kind=` du prompt)
 * et le tour. Le coût est cumulatif, comme celui de la CLI.
 */
const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const prompt = opt('-p') ?? '';
const resume = opt('--resume');
const model = opt('--model') ?? 'inconnu';
const kind = /cc:kind=([\w-]+)/.exec(prompt)?.[1] ?? 'request';
const phase = /cc:phase=([\w-]+)/.exec(prompt)?.[1] ?? '';
const turn = Number(/cc:turn=(\d+)/.exec(prompt)?.[1] ?? '1');
const session = resume ?? `fake-${Math.random().toString(16).slice(2, 10)}`;
const emit = (o) => process.stdout.write(JSON.stringify({ ...o, session_id: session }) + '\n');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
if (/cc:fail/.test(prompt)) { process.stderr.write('Erreur simulée : la CLI a échoué.\n'); process.exit(1); }

const scripts = {
  'generation:design': [
    'Je lis le registre et les tests existants avant d’écrire quoi que ce soit.',
    `## Cas proposés\n\n1. **Contrôle de vivacité réussi (fr, en)** — compléter « chemin nominal en ligne » : capture de l’écran d’aide.\n2. **Trois photos illisibles → blocage (fr)** — nouveau test : retry ×3 puis écran bloqué, captures à chaque étape.\n\nCoût estimé pour écrire et exécuter : environ 0,40 $.\n\nQUESTIONS :\n- Faut-il couvrir l’anglais pour le blocage aussi ?\n- Je pars de la branche de campagne, d’accord ?`,
  ],
  'generation:code': [
    'J’écris le test dans tests/ui/pilot-account-opening/scan-id.spec.ts (je complète l’existant).',
    'Exécution : 2 tests passés (fr, en). Références de capture écrites.',
    'Commit local `3f2a9c1` sur la branche de campagne : « Couvre le blocage de la pièce [PILOT-150] ». Rien n’a été poussé.',
  ],
  onboarding: [
    'Je lance `pnpm onboard` et j’enquête sur chaque point à trancher (lecture seule).',
    `## Propositions\n\n| Proposition | Preuve (fichier:ligne) | Confiance |\n|---|---|---|\n| review/approved → SIGNATURE_STEPS.sign | processes/…/pilot-account-opening.bpmn:211 (flux par défaut vers la signature) | moyenne |\n| CLOSING_STEPS.countersign hors chemin en ligne | packages/…/scripts/steps/closing.ts:5 | haute |\n\n## Questions ouvertes\n\n- La contresignature existe-t-elle aussi en ligne ?\n\nJe m’arrête ici : rien n’est appliqué sans ta validation.`,
  ],
  'case-draft': [
    "Brouillon rédigé dans le style de l'équipe (lecture seule).",
    '```json\n{"title":"Ouverture en ligne — chemin nominal","description":"Vérifie l’ouverture de compte en ligne de bout en bout.","preconditions":"Cas en ligne, demandeur majeur, pièce valide.","steps":[{"action":"Ouvrir le lien du dossier","data":"","expected":"Écran d’accueil affiché","rendering":"welcome"},{"action":"Saisir les informations du demandeur","data":"Prénom : Alex","expected":"Écran de capture de la pièce","rendering":""},{"action":"Signer et saisir le code","data":"000000","expected":"Récapitulatif affiché","rendering":"summary"}]}\n```',
  ],
  'sdk-analysis': [
    'Je lis le ticket et les fronts configurés (lecture seule).',
    '## Impact par parcours\n\n| Parcours | Concerné | Preuve |\n|---|---|---|\n| pilot-account-opening | yes | packages/pilot-account-opening/scripts/locales/fr.ts:7 (JOURNEY.internalError affiché sur la page d’erreur) |\n\nFonctionnalité : la page d’erreur du parcours reçoit la classe SDK `journey-error`.',
  ],
  request: ['Voici ce que montrent le registre et les tests du parcours : la session de signature est atteinte mais le blocage n’est jamais capturé.'],
};
const key = kind === 'generation' ? `generation:${phase || 'design'}` : kind;
const lines = scripts[key] ?? scripts.request;
const base = { 'generation:design': 0.08, 'generation:code': 0.21, onboarding: 0.35, 'case-draft': 0.03, 'sdk-analysis': 0.05, request: 0.02 }[key] ?? 0.02;

emit({ type: 'system', subtype: 'init', model, tools: ['Read', 'Grep', 'Glob', 'Edit', 'Bash'] });
for (const text of lines) {
  await sleep(250);
  emit({ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'Read', input: {} }] } });
  await sleep(250);
  emit({ type: 'assistant', message: { content: [{ type: 'text', text }] } });
}
emit({ type: 'result', subtype: 'success', is_error: false, result: lines.at(-1), total_cost_usd: Math.round(base * turn * 100) / 100, num_turns: lines.length });
