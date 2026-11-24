import { test } from '@playwright/test';
import { sendDecision, submitSession } from '../../../helpers/back-office';
import { configureAccountOpeningCase } from '../../../helpers/case-configurers';
import { checkCaseStatus, checkDecision, checkEmailContent, checkSignedDocument } from '../../../helpers/checks';
import { expect } from '@playwright/test';
import { findEmailBySubject } from '../../../helpers/mail';
import { EmailViewer } from '../../../pages/email-viewer';

test.describe('Parcours complet en ligne @P1', () => {
  // Pas de page : test API, n'atteint aucun écran.
  test('ouverture acceptée', async ({ request }) => {
    await configureAccountOpeningCase(request, { locale: 'fr', cardRange: 'premium' });
    await submitSession(request, 'ONBOARDING_STEPS');
    const mailId = await findEmailBySubject(request, 'Bienvenue chez nous');
    expect(mailId).toBeTruthy();
    await checkEmailContent(request, mailId, 'Bienvenue');
    await sendDecision(request, 'APPROVED');
    await checkDecision(request, 'APPROVED');
    await checkSignedDocument(request);
    await checkCaseStatus(request, 'OPENED');
  });

  test('refus REJ01', { tag: ['@PILOT-TC-40'] }, async ({ page, request }) => {
    await configureAccountOpeningCase(request, { locale: 'fr' });
    await sendDecision(request, 'REJECTED', { rejectionCode: 'REJ01' });
    await checkDecision(request, 'REJECTED');
    // Apostrophe droite et sans « … » : la normalisation des objets est au jalon 3.
    const subject = "Votre demande n'a pas abouti";
    await findEmailBySubject(request, subject);
    const viewer = new EmailViewer(page, subject);
    await viewer.validateEmailUI('rej01');
  });
});
