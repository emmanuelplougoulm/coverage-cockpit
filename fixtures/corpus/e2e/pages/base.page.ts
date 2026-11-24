import { expect, type Page } from '@playwright/test';

/** Page objet de base : la classe d'étape vient du nom de page de la sous-classe. */
export abstract class BasePage {
  protected abstract readonly pageName: string;

  constructor(protected readonly page: Page) {}

  get root() {
    return this.page.locator(`//div[@class='step-${this.pageName}']`);
  }

  /** Validation visuelle + textuelle de l'écran. */
  async validateUI(customSuffix?: string): Promise<void> {
    await expect(this.root).toHaveScreenshot(`${this.pageName}${customSuffix ? '-' + customSuffix : ''}.png`);
  }

  /** Sonde : ne prouve pas qu'on a atteint l'écran. */
  async isDisplayed(): Promise<boolean> {
    return this.root.isVisible();
  }

  async continue(): Promise<void> {
    await this.page.locator('#continue').click();
  }
}
