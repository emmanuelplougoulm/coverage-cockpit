import { BasePage } from './base.page';

/** Classe calculée : step-${pageName}2_1 (suffixe de version). */
export class IdCaptureV2Page extends BasePage {
  protected readonly pageName = 'id-capture';

  override get root() {
    return this.page.locator(`//div[@class='step-${this.pageName}2_1']`);
  }

  async upload(file: string): Promise<void> {
    await this.root.locator('input[type=file]').setInputFiles(file);
  }
}
