# Coverage Cockpit

[![CI](https://github.com/emmanuelplougoulm/coverage-cockpit/actions/workflows/ci.yml/badge.svg)](https://github.com/emmanuelplougoulm/coverage-cockpit/actions/workflows/ci.yml)

Application de bureau macOS, mono-utilisateur, qui répond à une seule question :

> **Pour tel parcours client, quels écrans, quels e-mails et quelles branches du processus sont réellement parcourus ou vérifiés par un test automatisé, et lesquels ne le sont pas ?**

Elle lit trois dépôts en lecture seule : le processus BPMN (Zeebe / Camunda 8), le package front du parcours et les tests Playwright. Elle en tire une couverture **écran × langue**, sépare ce qu'un test *traverse* de ce qu'il *vérifie* par une capture, et aide ensuite à combler les trous avec une IA. L'IA n'applique jamais rien sans un geste de l'utilisateur.

## Principes

- **Ce que le code dit est automatique, le périmètre est une décision humaine.** L'outil propose avec preuve (`fichier:ligne`) et niveau de confiance. Chaque choix de périmètre vit dans la config du parcours, avec sa raison.
- **Honnêteté du calcul.** Ce que l'outil ne sait pas trancher (classe d'écran ambiguë, e-mail non attribué, branche sans lien, langue illisible) est compté à part, en **zone grise**, et jamais dans les pourcentages.
- **Lecture seule sur les sources.** Seul le dépôt de tests peut être écrit, par l'IA ou par les gains rapides, sur une branche locale. Jamais la branche principale, jamais de push.
- **Rien d'externe sans clic confirmé.** Jira est lu, jamais écrit. L'outil de cas de test n'est écrit que sur clic.
- **Une seule frontière UI ↔ moteur : du JSON.** L'interface n'appelle que `run_engine(args[])`. Le moteur est un CLI qu'on peut rejouer à la main.

## État

Les dix jalons du cahier des charges sont faits. Ils ont été vérifiés sur un **corpus anonymisé** (`fixtures/corpus`) qui sert de parcours pilote, dont la couverture attendue est figée : `pnpm coverage` doit montrer 0 différence.

Avant un usage réel, il reste à :

| À brancher | Où |
|---|---|
| Les trois dépôts réels et la config du premier parcours | `CC_REPO_*`, `src/journeys/` |
| Jira : URL, jeton dans le trousseau, champs personnalisés | `CC_JIRA_*` |
| La CLI Claude Code : **jamais exécutée en vrai**, seulement avec un faux agent | `CC_AGENT_CMD` |
| L'API de l'outil de cas de test : endpoints inconnus, le client réel refuse toute écriture | `src/engine/cases/client.ts` |

## Démarrage rapide

Prérequis : macOS, Node ≥ 22, pnpm 9 (`corepack enable`), Rust ≥ 1.86, git.

```bash
pnpm install
pnpm dev:corpus     # interface dans le navigateur, sur le corpus (http://localhost:1420)
pnpm verify         # typage strict, tests, build, pilote = 0 différence, tests Rust
```

`pnpm dev:corpus` branche tout sur le corpus : dépôts, faux Jira, faux agent IA, faux outil de cas de test. Les notifications sont coupées. Pour l'app de bureau (terminal Claude compris) :

```bash
pnpm tauri dev
```

## Ce que montre l'app

**Vue d'ensemble.** Indicateurs clés, à savoir couverture, vérification, *illusion* (cellules atteintes jamais capturées), gains rapides et zone grise. Elle montre aussi l'entonnoir de couverture, l'effort, l'histogramme des tests par cellule, la courbe de gain et l'évolution avec classement. Elle propose des actions et résume ce qui a bougé depuis la dernière visite. Au lancement, la dernière vue connue s'affiche tout de suite, marquée « mise à jour… » pendant la vérification.

**Espace d'un parcours** (suite UI ou workflow) :

| Onglet | Contenu |
|---|---|
| Couverture | Registre des scénarios en cinq familles (chemin nominal, escalades, branches alternatives, e-mails, erreurs techniques), bandeau smoke, vue par session, gains rapides sans IA |
| Galerie | Captures de référence et croquis des écrans non capturés, visionneuse zoomable |
| Suivi | Ticket de campagne, validation du smoke, cas de test, écrans écartés, décisions à trancher, à nettoyer |
| Assertions | Audit de la suite workflow : contrôles vs gardes, couches, intentions, faits du BPMN contrôlés |
| BPMN | Diagramme coloré par statut, liste des éléments |
| Versions | Diff entre deux versions du BPMN et tests impactés (directement / via le sous-processus) |
| Nouveau test | Conception des cas puis code par l'IA, sur une branche choisie ; demandes en lecture seule |
| Onboarding | Brouillon de config, rapport des points à trancher, enquête de l'IA |

**Mes tickets** : tickets Jira assignés, regroupés par sprint, avec le parcours déduit et les indices divergents. **Versions BPMN** : versions publiées, `fetch` et mise à jour sûre du dépôt workflow, versions non vues. **Claude** : terminal intégré, que ⌘J réduit en panneau sous la vue.

## Brancher ses dépôts

| Variable | Rôle | Défaut |
|---|---|---|
| `CC_REPO_WORKFLOW` | dépôt des processus BPMN | `~/dev/repo-workflow` |
| `CC_REPO_FRONT` | dépôt des packages front | `~/dev/repo-front` |
| `CC_REPO_E2E` | dépôt des tests Playwright | `~/dev/repo-e2e` |
| `CC_DATA_DIR` | dossier de données de l'app | `~/Library/Application Support/app.coverage-cockpit` |
| `CC_JIRA_URL` | Jira Data Center (lecture seule) | non configuré |
| `CC_JIRA_KEYCHAIN_SERVICE` | service du jeton dans le trousseau macOS | `coverage-cockpit-jira` |
| `CC_JIRA_FIELD_BPMN`, `_TAXONOMY`, `_EPIC`, `_SPRINT` | identifiants des champs personnalisés | — |
| `CC_AGENT_CMD` | commande de l'agent | `claude` |
| `CC_AGENT_MODEL` / `CC_AGENT_MODEL_STRONG` | modèle d'écriture / d'onboarding | `claude-sonnet-5-5` / `claude-opus-5-5` |
| `CC_NOTIFY` | `off` coupe les notifications macOS | actives |

Le jeton Jira se range dans le trousseau, et l'outil ne l'affiche ni ne le journalise jamais :

```bash
security add-generic-password -s coverage-cockpit-jira -a "$USER" -w
```

**Ajouter un parcours** : `pnpm onboard <id-du-processus>` écrit un brouillon de config et un rapport des points à trancher dans le dossier de données, jamais dans un dépôt. `pnpm onboard:survey` liste les processus pas encore configurés. La config validée va dans `src/journeys/<parcours>.ts`, et s'enregistre dans `src/journeys/index.ts` (`journeys` et `journeyFiles`). Le parcours pilote, `src/journeys/pilot.ts`, sert de modèle commenté.

## Architecture

```
src/core        types et fonctions pures (contrat JSON, indicateurs, registre, FEEL)
src/engine      moteur CLI : chaque sous-commande imprime du JSON ; erreur = code ≠ 0 + stderr
  parsers       BPMN (Zeebe + FEEL minimal), front, specs (AST ts-morph, marche interprocédurale)
  coverage      résolution des écrans, résolveurs d'ambiguïté, écrans × langues, e-mails, BPMN
  store         dossier de données, empreintes, cache, historique JSONL, décisions locales
  versions      versions publiées (git), fetch sûr, diff de BPMN, tests impactés
  knowledge     catalogue de décisions, briques métier, audit des assertions
  tickets       client Jira REST v2 en lecture seule, déduction ticket → parcours
  agents        runs détachés de la CLI Claude Code, garde-fous, branches, prompts
  cases         cas de test (brouillon, création sur clic, clé dans le test)
src/journeys    une config TypeScript par parcours
src/ui          Vue 3 + TypeScript strict
src-tauri       coque Tauri 2 : run_engine + pseudo-terminal
knowledge       connaissance versionnée en YAML
fixtures        corpus anonymisé + couverture figée du pilote
```

### Le moteur en ligne de commande

Toutes les vues de l'app viennent du moteur, qu'on peut appeler directement. `pnpm -s engine <commande>` utilise les vrais dépôts, `pnpm -s corpus <commande>` le corpus :

| Famille | Sous-commandes |
|---|---|
| Lecture | `journeys`, `coverage <id> [--suite ui\|workflow] [--force]`, `last-views`, `history`, `register`, `thumbnails`, `image`, `sketches`, `assertions`, `aside`, `seen` |
| Sources | `bpmn`, `front`, `scan` |
| Versions | `versions [--fetch]`, `bpmn-diff <id> <de> <à>`, `impacts <id> [--from] [--to]`, `bpmn-xml`, `seen-set` |
| Tickets | `tickets`, `campaign-tickets`, `campaign-ticket <id> <CLÉ>` |
| Décisions locales | `aside-set`, `smoke-validate`, `visit` |
| Gains rapides | `captures <id>`, `apply-captures <id>` |
| Agents | `create-test`, `generation-reply`, `generation-stop`, `ask`, `onboard`, `aio-case-draft`, `sdk-analyse`, `run`, `active-runs`, `recent-runs`, `spend`, `branch-choice`, `notify` |
| Cas de test | `aio-cases`, `aio-case-push`, `aio-case-key`, `aio-case-set`, `aio-link` |

Scripts annexes : `pnpm coverage` (compare au pilote figé), `pnpm catalog:learn` (propose des décisions de catalogue ; `--write` pour les écrire), `pnpm corpus:reset`.

## Garde-fous

- **Agents IA.** Un processus détaché de la CLI Claude Code par tour. La session est reprise à chaque réponse avec le **modèle épinglé au départ**. Journaux, erreurs et coût sont écrits par tour, et une notification macOS signale la fin d'un run. Les outils suivants sont refusés : push, bascule ou reset sur la branche principale, lecture des fichiers d'environnement, certificats, images et pièces de test, écriture dans les dépôts front et workflow. Les branches et commits ne sont possibles que si le dossier de tests est la racine de **son propre** dépôt git. Une branche n'est jamais changée si le dépôt a des modifications non commitées : l'agent en est averti.
- **Dépôt workflow.** `git fetch` (30 s au plus), puis avance rapide (`merge --ff-only`) seulement si le clone est propre, sur sa branche principale et sans commit local. Sinon rien n'est fait, et la raison s'affiche.
- **Images de test.** Elles peuvent montrer des pièces justificatives, donc elles ne s'affichent jamais dans un aperçu navigateur, sauf sur le corpus, dont les images sont des maquettes générées. Elles s'affichent dans l'app de bureau.
- **Écritures externes.** L'outil n'écrit jamais dans Jira. Dans l'outil de cas de test, chaque écriture demande un clic confirmé, et un cas déjà lié n'est jamais réécrit.

## Corpus et pilote figé

`fixtures/corpus` contient trois mini-dépôts fictifs (workflow, front, e2e) qui imitent la forme des vrais, avec des pièges commentés : sessions au nom calculé, écrans partagés entre deux sessions, sondes, langues illisibles, objets d'e-mail à variantes, branches sans preuve visible. On y trouve aussi un faux Jira, un faux agent IA, et un générateur d'historique git du workflow (versions publiées, distant en avance, branche non fusionnée) créé dans `.cc-corpus-git/`. La couverture attendue du pilote est figée dans `fixtures/pilot/expected-coverage.json` ; toute différence est une régression ou un changement à valider.

## Données locales et cache

Le dossier de données contient le cache par parcours, l'historique JSONL par parcours et par suite, les dernières vues, les décisions locales (écrans écartés, smoke validé, version vue, ticket de campagne), les runs d'agents et les miniatures.

La clé de cache combine le parcours, l'empreinte de chaque dépôt (objets git, diff et fichiers non suivis) et l'empreinte de l'outil, restreinte au moteur, à la connaissance et à la seule config du parcours. Quand cette clé change, une seconde clé, calculée sur les fichiers réellement lus, évite encore l'analyse si rien d'utile n'a bougé.

## Limites connues

- **L'analyse est statique et heuristique** : tant qu'un test n'est pas exécuté, on ne sait pas exactement ce qu'il traverse. Une seconde source, les artefacts d'exécution (traces, rapports), reste à ajouter.
- **FEEL** : pas de noms à espaces (« string length »), pas de listes ni de fonctions évaluées.
- **Scanner** : `this.x` n'est lu que par initialiseur de propriété ; un `forEach` piloté par données n'est pas déplié.
- **Front** : les anciens packages en `config-*.ts` ne sont pas lus.
- **Mise en page des BPMN sans DI** : générée par l'outil, une flèche qui saute une colonne peut traverser une forme.
- **Cas de test** : un seul cas par test (un test à deux clés n'est géré qu'à moitié), et la suppression d'un cas se fait à la main.
- **Pas fait** : création d'étape et réduction de doublons par l'IA, modification du dernier commit local, apprentissage automatique du catalogue en fin d'onboarding, sauvegarde de l'historique (une seule machine).

## Vérification et CI

`pnpm verify` et la CI (`.github/workflows/ci.yml`) lancent la même chose : typage strict, tests Vitest, build, comparaison au pilote figé, tests Rust de la coque. La CI tourne sur macOS, cible de l'app, car des tests utilisent `zsh`, `git` et `sips`. Aucun vrai agent, aucun vrai Jira, aucune notification en CI.
