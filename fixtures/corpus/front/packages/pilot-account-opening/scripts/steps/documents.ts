import { DOCUMENTS_STEPS, SIGNATURE_STEPS } from '../constants';

export const documentsSteps = {
  [DOCUMENTS_STEPS.upload]: { component: 'DocumentsUpload', next: [DOCUMENTS_STEPS.review] },
  [DOCUMENTS_STEPS.review]: { component: 'DocumentsReview', next: [SIGNATURE_STEPS.sign] },
};
