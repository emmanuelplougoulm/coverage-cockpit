# Coverage Cockpit

Outil de bureau (macOS, mono-utilisateur) qui montre, parcours par parcours, quels écrans, e-mails et branches BPMN sont réellement parcourus ou vérifiés par un test automatisé.

## Architecture

- `src/core` : types et fonctions pures (config de parcours, contrat JSON, fixture).
- `src/engine` : moteur CLI. Chaque sous-commande imprime du JSON ; erreur = code ≠ 0 + stderr.
- `src/journeys` : une config TypeScript par parcours ; `pilot.ts` sert de référence.
- `src/ui` : Vue 3. Une seule frontière avec le moteur : `run_engine(args[]) → JSON`. `views/Overview.vue` (indicateurs, graphiques, actions), `views/JourneySpace.vue` (couverture par session, e-mails, processus, galerie, visionneuse).
- `src/core/families.ts` : registre (§8) — cinq familles de scénarios, smoke par canal et par langue, règle de tags, demandes « Nouveau test ».
- `src/engine/versions` : versions BPMN publiées (git), fetch + avance rapide sûre, diff de BPMN, tests impactés ; `src/engine/bpmnLayout.ts` : mise en page d'un BPMN sans DI pour l'afficher.
- `knowledge/*.yaml` : connaissance versionnée — catalogue de décisions, briques métier, motifs de contrôle, attentes BPMN ; `src/engine/knowledge` (chargeur validant, catalogue appliqué, briques, audit des assertions).
- `src/engine/tickets` : client Jira Data Center REST v2 en lecture seule (jeton du trousseau, reprise 429/503), déduction ticket → parcours.
- `src/engine/agents` : runs d'agents détachés (CLI Claude Code), garde-fous, choix de branche, prompts ; `src/engine/captures.ts` : gains rapides sans IA ; `src/engine/cases` : cas de test ; `src/engine/onboard.ts` : brouillon de config + rapport ; `src-tauri/src/pty.rs` : terminal Claude intégré.
- `src/core/indicators.ts` : indicateurs du §7 (couverture, vérification, illusion, gains rapides, effort, fragilité, écarts de langue, zone grise, tendances, depuis la dernière visite).
- `src-tauri` : coque Tauri 2, une seule commande `run_engine` (shell de connexion, arguments via `"$@"`).
- `src/engine/parsers` : `parseBpmn` (Zeebe + FEEL minimal), `parseFront` / `parseEmails`, `scanTests` (AST ts-morph, heuristique).
- `src/engine/coverage` : calcul de couverture (§6) — résolution des coups et résolveurs d'ambiguïté, écrans × langues, e-mails, BPMN.
- `src/engine/store` : dossier de données, empreintes (git ou disque), fichiers réellement lus, cache, historique JSONL, dernières vues.
- `fixtures/corpus` : trois mini-dépôts anonymisés (workflow, front, e2e) qui servent de pilote ; chaque piège y est commenté.
- `fixtures/pilot/expected-coverage.json` : couverture attendue du pilote, figée au jalon 3.

## Vérification et CI

```bash
pnpm verify   # typage strict, tests, build, pilote = 0 différence avec la couverture figée, tests Rust
```

La CI (`.github/workflows/ci.yml`, macOS) fait exactement la même chose à chaque push sur `main` et chaque pull request. Elle tourne sur macOS parce que c'est la cible de l'app et que des tests utilisent `zsh`, `git` et `sips`. Aucun vrai agent, aucun vrai Jira, aucune notification en CI.

## Données locales

Dossier `~/Library/Application Support/app.coverage-cockpit` (surcharge : `CC_DATA_DIR` ; les scripts `corpus` utilisent `.cc-data-corpus/`) :
`cache/<parcours>.json`, `history/<parcours>.<suite>.jsonl`, `last-views/<parcours>.json`, `aside/<parcours>.json` (écrans écartés), `smoke/<parcours>.json` (validations), `visit.json`.

Cache : clé = parcours + empreinte de chaque dépôt + empreinte de l'outil (`src/core`, `src/engine`, `knowledge`, dépendances, et la seule config du parcours). Si elle change, une clé fine (contenu des fichiers réellement lus, listes des dossiers parcourus) évite encore l'analyse quand rien d'utile n'a bougé.

## Dépôts analysés (lecture seule)

| Variable | Défaut |
|---|---|
| `CC_REPO_WORKFLOW` | `~/dev/repo-workflow` |
| `CC_REPO_FRONT` | `~/dev/repo-front` |
| `CC_REPO_E2E` | `~/dev/repo-e2e` |

## Commandes

```bash
pnpm install
pnpm -s engine journeys   # moteur seul, JSON
pnpm -s corpus scan pilot-account-opening   # même moteur, dépôts = corpus (aussi : bpmn, front)
pnpm -s corpus coverage pilot-account-opening --suite ui   # vue + état du cache (--force pour réanalyser)
pnpm -s corpus last-views                       # dernières vues enregistrées, sans analyse
pnpm -s corpus thumbnails pilot-account-opening # miniatures des captures + doublons de rendu
pnpm -s corpus sketches pilot-account-opening   # textes par état (croquis des écrans non capturés)
pnpm -s corpus register pilot-account-opening   # registre par famille, smoke, problèmes de tags
pnpm -s corpus aside-set pilot-account-opening SCAN_ID_STEPS.captureHelp "raison"   # écarter (--remove pour réintégrer)
pnpm -s corpus smoke-validate pilot-account-opening "online|fr" "<titre complet du test>"
pnpm -s corpus versions [--fetch]                # versions publiées, non publiées, branches ; --fetch = git fetch + avance rapide sûre
pnpm -s corpus impacts pilot-account-opening --from 3.0.0 --to 3.2.0   # diff + tests impactés (direct / via le sous-processus)
pnpm -s corpus bpmn-diff pilot-account-opening 3.2.0 local
pnpm corpus:reset                                # recrée le dépôt workflow git du corpus (.cc-corpus-git/)
pnpm -s corpus tickets                           # tickets (faux Jira du corpus : fixtures/corpus/jira)
pnpm -s corpus campaign-ticket pilot-account-opening PILOT-501   # ticket de campagne (= branche)
pnpm -s corpus assertions pilot-account-opening  # audit des assertions (suite workflow)
pnpm catalog:learn                               # propose des décisions de catalogue ; --write pour les écrire
pnpm -s corpus create-test pilot-account-opening "demande…"   # Nouveau test (conception), faux agent du corpus
pnpm -s corpus generation-reply <run> "texte" --phase code     # passe au code (même session, même modèle)
pnpm -s corpus captures pilot-account-opening    # gains rapides sans IA : aperçu ; apply-captures pour le commit local
pnpm -s corpus spend                             # dépense IA
pnpm onboard <processus> / pnpm onboard:survey   # brouillon de config + rapport / processus non configurés
pnpm -s corpus history pilot-account-opening    # instantanés (une ligne par changement de couverture)
pnpm coverage             # compare le pilote à sa fixture : 0 différence attendue (--write pour la réécrire)
pnpm test                 # Vitest
pnpm typecheck            # vue-tsc + tsc strict
pnpm dev                  # UI en navigateur (relais /__engine de développement)
pnpm dev:corpus           # idem, sur le corpus
pnpm tauri dev            # app de bureau
(cd src-tauri && cargo test)
```

Rust ≥ 1.86 : `rust-version` dans `Cargo.toml` fait choisir à cargo des versions de Tauri compatibles.

## Dépôt workflow du corpus

Les scripts `corpus` et `dev:corpus` lisent le workflow dans `.cc-corpus-git/workflow` (ignoré par git), un clone généré par `fixtures/corpus/tools/workflowHistory.ts` avec un distant (`origin.git`) : versions 3.0.0 → 3.2.0 en local, 3.3.0 et un commit non publié seulement sur le distant, une branche non fusionnée. « Rafraîchir » fait avancer ce clone ; `pnpm corpus:reset` le remet à la 3.2.0. `pnpm coverage` (fixture figée) lit toujours `fixtures/corpus/workflow`.

**Mise à jour du dépôt workflow** : `git fetch` (30 s au plus), puis `merge --ff-only` seulement si le clone est propre, sur sa branche principale, sans commit local (équivalent au rebase dans ce seul cas ; sinon rien, avec la raison). Aucun push, aucune autre écriture.

## Jira (lecture seule)

`CC_JIRA_URL` + jeton d'accès personnel dans le trousseau macOS (service `coverage-cockpit-jira`, ou `CC_JIRA_KEYCHAIN_SERVICE`) ; champs : `CC_JIRA_FIELD_BPMN`, `_TAXONOMY`, `_EPIC`, `_SPRINT`. Aucune écriture vers Jira. Le jeton n'est ni affiché ni journalisé ; reprise sur 429/503 (Retry-After, sinon 1 s, 2 s, 4 s). `CC_JIRA_FAKE=<dossier>` sert des réponses enregistrées (corpus).

## Agents IA

Chaque échange est un processus détaché de la CLI Claude Code (`claude -p --output-format stream-json`), session reprise à chaque réponse avec le modèle épinglé au départ (`CC_AGENT_MODEL`, défaut claude-sonnet-5-5 ; onboarding `CC_AGENT_MODEL_STRONG`, défaut claude-opus-5-5). Commande : `CC_AGENT_CMD` (défaut `claude`). Journaux, erreurs, code de sortie par tour dans `runs/<type>/<id>/`. Garde-fous : outils refusés (push, branche principale, secrets, images, écriture front/workflow) + consigne ; branches et commits seulement si le dossier de tests est la racine de son propre dépôt git. Notifications macOS en fin de run (`CC_NOTIFY=off` pour les couper). Les scripts `corpus` utilisent un faux agent (`fixtures/corpus/tools/fake-agent.mjs`) et un faux outil de cas de test (`CC_CASES_FAKE=1`).

## Images de test

Les images de référence (`<spec>-snapshots/*.png`) peuvent montrer des pièces justificatives : l'interface ne les affiche **jamais en aperçu de développement** dans un navigateur, sauf `VITE_PREVIEW_IMAGES=1` (posé seulement par `pnpm dev:corpus`, dont les images sont des maquettes générées par `fixtures/corpus/tools/make-images.py`). Dans l'app Tauri, elles s'affichent. Miniatures : `sips` (macOS), en cache dans le dossier de données.

## Limites connues du calcul

- Une capture sans page objet prend la dernière page utilisée.
- La variante d'un e-mail se tranche par `emailCaptureVariants`, la gamme (variable de la règle de dossier), ou un indice exact (suffixe, valeur du cas) ; sinon zone grise.
- Les images de référence des captures (`capturedBy[].image`) arrivent avec la galerie.

## Limites connues des parseurs

- FEEL : pas de noms à espaces (« string length »), pas de listes ni de fonctions évaluées.
- Front : anciens packages à `config-*.ts` non lus ; `screenSketch` et `stepGraph` arrivent avec leurs vues.
- Scanner : `this.x` n'est lu que par initialiseur de propriété (pas par argument de `super(...)`) ; `forEach` piloté par données non déplié ; une méthode est « sonde » seulement si toutes ses instructions finissent par une sonde.
