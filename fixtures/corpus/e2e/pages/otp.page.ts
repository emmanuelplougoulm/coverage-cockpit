import { BasePage } from './base.page';

export class OtpPage extends BasePage {
  protected readonly pageName = 'signature-otp';

  async typeCode(code: string): Promise<void> {
    await this.root.locator('#otp').fill(code);
    await this.continue();
  }

  /** Capture dont le suffixe nomme un message de la page. */
  async checkError(): Promise<void> {
    await this.validateUI('helper-text-on-error');
  }
}
