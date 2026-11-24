import type { JourneyConfig } from '../core/journey';

/**
 * Parcours PILOTE : premier configuré, référence des suivants et fixture de
 * non-régression (`fixtures/pilot/expected-coverage.json`).
 *
 * Valeurs neutres à remplacer par celles de ton environnement : identifiant du
 * processus BPMN, chemins dans les trois dépôts, groupes de constantes front.
 * Chaque choix de périmètre porte sa raison en commentaire (§2.1).
 */
export const pilot: JourneyConfig = {
  id: 'pilot-account-opening',
  label: 'Ouverture de compte (pilote)',

  // Ordre du parcours tel que l'utilisateur le vit : il fixe l'ordre des
  // sessions dans le registre et dans les chemins nominaux.
  sessions: {
    ONBOARDING_STEPS: 'Accueil et orientation',
    APPLICANT_STEPS: 'Données du demandeur',
    SCAN_ID_STEPS: "Vérification d'identité",
    DOCUMENTS_STEPS: 'Pièces justificatives',
    SIGNATURE_STEPS: 'Signature électronique',
    CLOSING_STEPS: 'Restitution et clôture',
  },

  bpmnDir: 'processes/pilot-account-opening',
  frontPackage: 'packages/pilot-account-opening',
  specs: ['tests/ui/pilot-account-opening', 'tests/workflow/pilot-account-opening'],
  // Les tests post-déploiement et back-office ne comptent que s'ils créent un
  // cas de ce parcours (via un configurateur ci-dessous).
  sharedSpecs: ['tests/ui/shared/post-deployment.spec.ts', 'tests/workflow/shared/back-office.spec.ts'],
  caseConfigurers: ['configureAccountOpeningCase'],

  // Le parcours est livré en deux langues ; chaque écran doit être couvert dans les deux.
  locales: ['fr', 'en'],
  // Un cas sans langue explicite part en français (défaut du configurateur).
  defaultLocale: 'fr',

  // Deux canaux : en ligne et guichet. Tout écran que le parcours traverse
  // forcément y figure ; le reste ira dans les autres familles du registre.
  nominalPaths: [
    {
      id: 'online',
      label: 'En ligne',
      screens: [
        'ONBOARDING_STEPS.welcome',
        'ONBOARDING_STEPS.channel',
        'APPLICANT_STEPS.identity',
        'APPLICANT_STEPS.address',
        'SCAN_ID_STEPS.capture',
        'DOCUMENTS_STEPS.upload',
        'DOCUMENTS_STEPS.review',
        'SIGNATURE_STEPS.sign',
        'SIGNATURE_STEPS.otp',
        'CLOSING_STEPS.summary',
      ],
      setup: 'Cas en ligne, demandeur majeur, pièce valide, une seule signature.',
    },
    {
      id: 'branch',
      label: 'Guichet',
      screens: [
        'ONBOARDING_STEPS.welcome',
        'ONBOARDING_STEPS.channel',
        'APPLICANT_STEPS.identity',
        'APPLICANT_STEPS.address',
        'DOCUMENTS_STEPS.upload',
        'DOCUMENTS_STEPS.review',
        'SIGNATURE_STEPS.sign',
        'SIGNATURE_STEPS.otp',
        'CLOSING_STEPS.summary',
        // Au guichet, le conseiller contresigne : même page de signature, autre session.
        'CLOSING_STEPS.countersign',
      ],
      setup: "Cas guichet : l'identité est vérifiée par le conseiller, pas de capture ; contresignature du conseiller.",
    },
  ],

  // L'écran de blocage après trois codes faux termine une escalade : ce n'est
  // pas une erreur technique, il va dans la famille « escalades ».
  escalationEnds: ['SIGNATURE_STEPS.noMoreAttempts'],

  // Aucune session hébergée par un tiers dans ce parcours (si la vérification
  // d'identité l'était, son groupe irait ici : on n'en verrait pas les écrans).
  excludedGroups: [],
  // Écran de maintenance affiché par l'infrastructure, jamais par le parcours.
  excludedStates: ['ONBOARDING_STEPS.maintenance'],
  // Archivage : sous-processus sans écran ni e-mail.
  excludedBpmnSteps: ['archive-case'],
  // Relances par minuterie : non testables en temps raisonnable.
  excludedEmailTriggers: ['timer'],

  // Le sous-processus « documents » calcule son sessionName (sessionPrefix + "_STEPS") :
  // le moteur ne devine pas, on le déclare.
  bpmnSessions: { documents: ['DOCUMENTS_STEPS'] },
  bpmnTechnicalSteps: ['init-case', 'archive-case'],
  bpmnBranches: {
    // Refus du back-office : l'e-mail de refus est la seule trace visible.
    'review/rejected': ['email:application-rejected'],
    // Demande de pièce complémentaire : l'écran d'upload réapparaît côté client,
    // et le conseiller reçoit un e-mail (seule trace visible pour un test workflow).
    'review/more-documents': ['DOCUMENTS_STEPS.upload', 'email:advisor-notification'],
    // Contrôle anti-fraude silencieux : rien de visible ne le prouve.
    'review/fraud-check': [],
    // 'review/approved' n'est volontairement pas tranché : la suite du parcours
    // le prouve-t-elle (signature atteinte) ? Reste en zone grise, à décider.
  },

  catalog: true,
};
