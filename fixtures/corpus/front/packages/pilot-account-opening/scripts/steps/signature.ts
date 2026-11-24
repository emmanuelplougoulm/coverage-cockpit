import { CLOSING_STEPS, SIGNATURE_STEPS } from '../constants';

export const signatureSteps = {
  [SIGNATURE_STEPS.sign]: { component: 'SignDocuments', next: [SIGNATURE_STEPS.otp] },
  [SIGNATURE_STEPS.otp]: { component: 'OtpInput', next: [CLOSING_STEPS.summary, SIGNATURE_STEPS.noMoreAttempts] },
  [SIGNATURE_STEPS.noMoreAttempts]: { component: 'NoMoreAttempts', next: [] },
};
