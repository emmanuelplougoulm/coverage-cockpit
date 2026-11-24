import { test } from '@playwright/test';
import { sendDecision } from '../../../helpers/back-office';
import { configureAccountOpeningCase } from '../../../helpers/case-configurers';
import { checkDecision } from '../../../helpers/checks';
import { findEmailBySubject } from '../../../helpers/mail';

test.describe('Back-office', () => {
  test('demande de pièces complémentaires', async ({ request }) => {
    await configureAccountOpeningCase(request, { locale: 'fr' });
    await sendDecision(request, 'MORE_DOCUMENTS');
    await checkDecision(request, 'MORE_DOCUMENTS');
    await findEmailBySubject(request, 'Pièces complémentaires demandées');
  });
});
