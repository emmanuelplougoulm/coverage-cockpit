import { test } from '@playwright/test';
import { configureAccountOpeningCase } from '../../../helpers/case-configurers';
import { IdCaptureV2Page } from '../../../pages/id-capture-v2.page';

test.describe("Pièce d'identité v2", () => {
  test('capture v2', async ({ page, request }) => {
    await page.goto(await configureAccountOpeningCase(request, { locale: 'fr' }));
    const capture = new IdCaptureV2Page(page);
    await capture.upload('fixtures/id-front.png');
    await capture.validateUI();
  });

  test('langue illisible', async ({ page, request }) => {
    // Langue venue de l'environnement : le scanner ne la devine pas.
    await page.goto(await configureAccountOpeningCase(request, { locale: process.env.LOCALE }));
    await new IdCaptureV2Page(page).upload('fixtures/id-front.png');
  });
});
