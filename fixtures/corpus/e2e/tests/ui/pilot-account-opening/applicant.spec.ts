import { test } from '@playwright/test';
import { configureAccountOpeningCase } from '../../../helpers/case-configurers';
import { IdentityPage } from '../../../pages/identity.page';

test.describe('Formulaire demandeur @HAPPY_PATH', () => {
  test.describe('Suppression @SAD_PATH', () => {
    test('dialogue de suppression', async ({ page, request }) => {
      await page.goto(await configureAccountOpeningCase(request, { locale: 'en' }));
      const identity = new IdentityPage(page);
      await identity.fill({ firstName: 'Sam' });
      await identity.openDeleteDialog();
    });
  });
});
