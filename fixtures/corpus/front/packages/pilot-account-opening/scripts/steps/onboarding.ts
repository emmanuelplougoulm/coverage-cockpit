import { APPLICANT_STEPS, ONBOARDING_STEPS } from '../constants';

export const onboardingSteps = {
  [ONBOARDING_STEPS.welcome]: { component: 'Welcome', next: [ONBOARDING_STEPS.channel] },
  [ONBOARDING_STEPS.channel]: { component: 'ChannelChoice', next: [APPLICANT_STEPS.identity] },
  [ONBOARDING_STEPS.maintenance]: { component: 'Maintenance', next: [] },
};
