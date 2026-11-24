// Textes français. Un objet = une étape ; une chaîne dont la clé est un message
// d'état (internalError, helperTextOnError, *Dialog…) = un état à part entière.
export default {
  JOURNEY: {
    internalError: 'Une erreur est survenue. Réessayez plus tard.',
    serverErrorTimeout: 'Le service ne répond pas.',
    title: 'Ouverture de compte', // pas un message d'état
  },
  ONBOARDING_STEPS: {
    welcome: { title: 'Bienvenue', cta: 'Commencer' },
    channel: { title: 'Comment souhaitez-vous continuer ?' },
    maintenance: { title: 'Service en maintenance' },
  },
  APPLICANT_STEPS: {
    identity: { title: 'Vos informations', firstName: 'Prénom' },
    address: { title: 'Votre adresse' },
    deleteDialog: 'Supprimer les informations saisies ?',
  },
  SCAN_ID_STEPS: {
    capture: { title: "Photographiez votre pièce d'identité" },
    captureV2: { title: "Photographiez votre pièce d'identité" },
    captureHelp: { title: 'Conseils pour la photo' },
    retry: { title: 'La photo est illisible' },
    blocked: { title: 'Vérification impossible' },
    blockedError: 'Trop de tentatives.',
  },
  DOCUMENTS_STEPS: {
    upload: { title: 'Ajoutez vos justificatifs' },
    review: { title: 'Vérifiez vos justificatifs' },
  },
  SIGNATURE_STEPS: {
    sign: { title: 'Signez vos documents' },
    otp: { title: 'Saisissez le code reçu par SMS' },
    noMoreAttempts: { title: 'Plus de tentative possible' },
    helperTextOnError: 'Code incorrect.',
    codeHelperTextOnError: 'Le code a expiré.',
    lockedError: 'Signature verrouillée par un autre signataire.',
  },
  CLOSING_STEPS: {
    summary: { title: 'Récapitulatif' },
    countersign: { title: 'Contresignature' },
  },
};
