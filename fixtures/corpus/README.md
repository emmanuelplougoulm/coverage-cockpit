# Corpus anonymisé

Trois mini-dépôts fictifs qui imitent la forme des vrais (Zeebe / front SDK / Playwright),
pour tester les parseurs et servir de pilote. Aucun nom réel. Chaque piège est commenté
à l'endroit où il se trouve.

- `workflow/` : processus BPMN du parcours pilote (Zeebe, FEEL).
- `front/` : package front du parcours (constantes, cartes d'étapes, textes, gabarits d'e-mails).
- `e2e/` : tests Playwright (suites `tests/ui` et `tests/workflow`), page objets, configurateurs.

Lancer le moteur dessus : `pnpm -s corpus <sous-commande>`.
