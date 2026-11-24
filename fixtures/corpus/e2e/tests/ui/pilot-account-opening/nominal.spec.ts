import { test } from '@playwright/test';
import { configureAccountOpeningCase } from '../../../helpers/case-configurers';
import { goThroughApplicant } from '../../../helpers/journey';
import { LOCALES } from '../../../helpers/locales';
import { IdCapturePage } from '../../../pages/id-capture.page';
import { OtpPage } from '../../../pages/otp.page';
import { SignaturePage } from '../../../pages/signature.page';
import { SummaryPage } from '../../../pages/summary.page';
import { WelcomePage } from '../../../pages/welcome.page';

test.describe('Ouverture en ligne @HAPPY_PATH', () => {
  // Piloté par données : Playwright jouera un test par langue.
  for (const locale of LOCALES) {
    test(`chemin nominal en ligne ${locale}`, { tag: ['@PILOT-TC-12'] }, async ({ page, request }) => {
      const url = await configureAccountOpeningCase(request, { locale, channel: 'online' });
      await page.goto(url);

      const welcome = new WelcomePage(page);
      await welcome.validateUI();
      await welcome.start();

      await goThroughApplicant(page, { firstName: 'Alex' });

      const capture = new IdCapturePage(page);
      await capture.upload('fixtures/id-front.png');

      const signature = new SignaturePage(page);
      await signature.validateUI(`online-${locale}`);
      await signature.accept();

      const otp = new OtpPage(page);
      await otp.typeCode('000000');

      const summary = new SummaryPage(page);
      await summary.validateUI();
    });
  }
});
