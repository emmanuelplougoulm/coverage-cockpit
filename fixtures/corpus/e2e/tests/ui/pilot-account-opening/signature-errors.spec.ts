import { test } from '@playwright/test';
import { configureAccountOpeningCase } from '../../../helpers/case-configurers';
import { checkPageScreenshot } from '../../../helpers/journey';
import { JourneyErrorPage } from '../../../pages/journey-error.page';
import { OtpPage } from '../../../pages/otp.page';
import { SummaryPage } from '../../../pages/summary.page';

test.describe('Erreurs de signature @SAD_PATH @PILOT-TC-TODO', () => {
  test('code faux', async ({ page, request }) => {
    // Pas de langue : défaut du configurateur (fr).
    const url = await configureAccountOpeningCase(request, { channel: 'online' });
    await page.goto(url);
    const otp = new OtpPage(page);
    await otp.typeCode('111111');
    await otp.checkError();
    // Sonde : le récapitulatif n'est PAS atteint.
    if (await new SummaryPage(page).isDisplayed()) {
      throw new Error('ne devrait pas passer');
    }
  });

  test('erreur technique', { tag: ['@PILOT-TC-31'] }, async ({ page, request }) => {
    const url = await configureAccountOpeningCase(request, { locale: 'en' });
    await page.goto(url);
    await new JourneyErrorPage(page).waitFor();
    await checkPageScreenshot(page, 'journey-error');
  });
});
