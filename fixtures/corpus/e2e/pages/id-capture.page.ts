import type { Locator, Page } from '@playwright/test';

/** Pas de BasePage : localisateur par préfixe de classe (contains). */
export class IdCapturePage {
  private readonly root: Locator;

  constructor(private readonly page: Page) {
    this.root = page.locator("//div[contains(@class,'step-id-capture')]");
  }

  async upload(file: string): Promise<void> {
    await this.root.locator('input[type=file]').setInputFiles(file);
    await this.page.locator('#continue').click();
  }
}
