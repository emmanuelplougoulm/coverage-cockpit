import { expect, type Page } from '@playwright/test';
import { IdentityPage } from '../pages/identity.page';

/** Helper : traverse le formulaire demandeur sans le capturer. */
export async function goThroughApplicant(page: Page, data: { firstName: string }): Promise<void> {
  const identity = new IdentityPage(page);
  await identity.fill(data);
  await identity.continue();
}

/** Capture plein écran sans page objet. */
export async function checkPageScreenshot(page: Page, name: string): Promise<void> {
  await expect(page).toHaveScreenshot(`${name}.png`);
}
