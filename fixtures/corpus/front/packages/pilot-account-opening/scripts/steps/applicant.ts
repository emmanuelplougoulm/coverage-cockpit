import { APPLICANT_STEPS, SCAN_ID_STEPS } from '../constants';

export const applicantSteps = {
  [APPLICANT_STEPS.identity]: { component: 'IdentityForm', next: [APPLICANT_STEPS.address] },
  [APPLICANT_STEPS.address]: { component: 'AddressForm', next: [SCAN_ID_STEPS.capture] },
};
