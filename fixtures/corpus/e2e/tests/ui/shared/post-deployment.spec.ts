import { test } from '@playwright/test';
import { configureAccountOpeningCase, configureLoanCase } from '../../../helpers/case-configurers';
import { WelcomePage } from '../../../pages/welcome.page';

test.describe('Post-déploiement', () => {
  test('smoke ouverture de compte', async ({ page, request }) => {
    await page.goto(await configureAccountOpeningCase(request));
    await new WelcomePage(page).validateUI('smoke');
  });

  test('smoke prêt', async ({ page, request }) => {
    await page.goto(await configureLoanCase(request, { locale: 'fr' }));
    await new WelcomePage(page).validateUI('smoke');
  });
});
