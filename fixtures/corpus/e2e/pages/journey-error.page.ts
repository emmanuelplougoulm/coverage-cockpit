import type { Page } from '@playwright/test';

/** Page d'erreur du parcours : classe d'étape accolée à une classe SDK. */
export class JourneyErrorPage {
  constructor(private readonly page: Page) {}

  async waitFor(): Promise<void> {
    await this.page.locator("//div[@class='step-internalError journey-error']").waitFor();
  }
}
