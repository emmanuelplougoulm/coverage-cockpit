import { BasePage } from './base.page';

export class WelcomePage extends BasePage {
  protected readonly pageName = 'welcome';

  async start(): Promise<void> {
    await this.page.locator('#start').click();
  }
}
