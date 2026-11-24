import { expect } from '@playwright/test';
import { BasePage } from './base.page';

export class IdentityPage extends BasePage {
  protected readonly pageName = 'applicant-identity';

  async fill(data: { firstName: string }): Promise<void> {
    await this.root.locator('#firstName').fill(data.firstName);
  }

  /** Dialogue SDK sans classe `step-` : marqueur par id. */
  async openDeleteDialog(): Promise<void> {
    await this.page.locator('#delete').click();
    await expect(this.page.locator('#deleteDialog')).toBeVisible();
  }
}
