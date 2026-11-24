// Textes anglais. Trous volontaires : APPLICANT_STEPS.address et
// SIGNATURE_STEPS.lockedError n'existent qu'en français.
export default {
  JOURNEY: {
    internalError: 'Something went wrong. Please try again later.',
    serverErrorTimeout: 'The service is not responding.',
    title: 'Account opening',
  },
  ONBOARDING_STEPS: {
    welcome: { title: 'Welcome', cta: 'Start' },
    channel: { title: 'How would you like to continue?' },
    maintenance: { title: 'Service under maintenance' },
  },
  APPLICANT_STEPS: {
    identity: { title: 'Your details', firstName: 'First name' },
    deleteDialog: 'Delete the information you entered?',
  },
  SCAN_ID_STEPS: {
    capture: { title: 'Take a photo of your ID' },
    captureV2: { title: 'Take a photo of your ID' },
    captureHelp: { title: 'Photo tips' },
    retry: { title: 'The photo is unreadable' },
    blocked: { title: 'Verification impossible' },
    blockedError: 'Too many attempts.',
  },
  DOCUMENTS_STEPS: {
    upload: { title: 'Add your documents' },
    review: { title: 'Check your documents' },
  },
  SIGNATURE_STEPS: {
    sign: { title: 'Sign your documents' },
    otp: { title: 'Enter the code sent by SMS' },
    noMoreAttempts: { title: 'No attempts left' },
    helperTextOnError: 'Wrong code.',
    codeHelperTextOnError: 'The code has expired.',
  },
  CLOSING_STEPS: {
    summary: { title: 'Summary' },
    countersign: { title: 'Countersignature' },
  },
};
