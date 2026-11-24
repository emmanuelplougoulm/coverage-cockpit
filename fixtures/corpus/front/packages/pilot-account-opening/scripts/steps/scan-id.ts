import { DOCUMENTS_STEPS, SCAN_ID_STEPS } from '../constants';

export const scanIdSteps = {
  [SCAN_ID_STEPS.capture]: { component: 'IdCapture', next: [DOCUMENTS_STEPS.upload, SCAN_ID_STEPS.retry, SCAN_ID_STEPS.captureHelp] },
  [SCAN_ID_STEPS.captureV2]: { component: 'IdCaptureV2', next: [DOCUMENTS_STEPS.upload] },
  [SCAN_ID_STEPS.captureHelp]: { component: 'IdCaptureHelp', next: [SCAN_ID_STEPS.capture] },
  [SCAN_ID_STEPS.retry]: { component: 'IdRetry', next: [SCAN_ID_STEPS.capture, SCAN_ID_STEPS.blocked] },
  [SCAN_ID_STEPS.blocked]: { component: 'IdBlocked', next: [] },
};
