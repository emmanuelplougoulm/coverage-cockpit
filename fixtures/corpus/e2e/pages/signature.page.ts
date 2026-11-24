import { BasePage } from './base.page';

/** Même classe d'étape pour la signature et la contresignature (ambigu). */
export class SignaturePage extends BasePage {
  protected readonly pageName = 'signature';

  async accept(): Promise<void> {
    await this.root.locator('#accept').check();
    await this.continue();
  }
}
