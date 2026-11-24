import { expect, type Page } from '@playwright/test';

export class EmailViewer {
  constructor(private readonly page: Page, private readonly subject: string) {}

  async validateEmailUI(customSuffix?: string): Promise<void> {
    await expect(this.page).toHaveScreenshot(`email-${customSuffix ?? 'default'}.png`);
  }
}
