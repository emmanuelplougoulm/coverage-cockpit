import { CLOSING_STEPS } from '../constants';

export const closingSteps = {
  [CLOSING_STEPS.summary]: { component: 'Summary', next: [CLOSING_STEPS.countersign] },
  [CLOSING_STEPS.countersign]: { component: 'Countersign', next: [] },
};
