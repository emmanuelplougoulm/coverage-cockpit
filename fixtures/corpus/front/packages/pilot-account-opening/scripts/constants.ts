// Constantes d'étapes : GROUP.KEY → nom d'étape (classe CSS `step-<nom>`).
export const ONBOARDING_STEPS = {
  welcome: 'welcome',
  channel: 'channel-choice',
  maintenance: 'maintenance',
} as const;

export const APPLICANT_STEPS = {
  identity: 'applicant-identity',
  address: 'applicant-address',
} as const;

// Piège : `id-capture` est préfixe de `id-capture2_1` (suffixe de version)
// et de `id-capture-help` (pas un suffixe de version).
export const SCAN_ID_STEPS = {
  capture: 'id-capture',
  captureV2: 'id-capture2_1',
  captureHelp: 'id-capture-help',
  retry: 'id-retry',
  blocked: 'id-blocked',
} as const;

export const DOCUMENTS_STEPS = {
  upload: 'documents-upload',
  review: 'documents-review',
} as const;

export const SIGNATURE_STEPS = {
  sign: 'signature',
  otp: 'signature-otp',
  noMoreAttempts: 'signature-no-more-attempts',
} as const;

// Piège : la contresignature réutilise la page de signature (même classe d'étape).
export const CLOSING_STEPS = {
  summary: 'summary',
  countersign: 'signature',
} as const;

// Pas un groupe d'étapes : ignoré.
export const API_TIMEOUT_MS = 30_000;
