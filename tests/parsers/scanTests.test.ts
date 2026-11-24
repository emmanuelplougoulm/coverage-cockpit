import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { extractHits, scanTests, trailBefore, type ScannedTest } from '../../src/engine/parsers/scanTests';
import { pilot } from '../../src/journeys/pilot';
import { CORPUS } from '../corpus';

const result = scanTests(CORPUS.e2e, [...pilot.specs, ...(pilot.sharedSpecs ?? [])]);
const byTitle = (t: string): ScannedTest => {
  const found = result.tests.find((x) => x.fullTitle.endsWith(t));
  if (!found) throw new Error(`test introuvable : ${t}`);
  return found;
};
const steps = (t: ScannedTest) => t.steps.map((s) => `${s.match}:${s.step}`);

describe('scanTests — corpus pilote', () => {
  it('trouve chaque test, données dépliées, sans avertissement', () => {
    expect(result.warnings).toEqual([]);
    expect(result.tests).toHaveLength(12);
    expect(result.files).toContain('tests/ui/pilot-account-opening/nominal.spec.ts');
  });

  it('déplie un test piloté par données : une entrée par langue, titre complet distinct', () => {
    const nominal = result.tests.filter((t) => t.file.endsWith('nominal.spec.ts'));
    expect(nominal.map((t) => [t.fullTitle, t.locales])).toEqual([
      ['Ouverture en ligne @HAPPY_PATH › chemin nominal en ligne fr', ['fr']],
      ['Ouverture en ligne @HAPPY_PATH › chemin nominal en ligne en', ['en']],
    ]);
    expect(nominal[0]?.line).toBe(14);
  });

  it('lit les tags des describe et ceux de l’option tag', () => {
    const t = byTitle('chemin nominal en ligne fr');
    expect(t.tags).toEqual(['@HAPPY_PATH']);
    expect(t.ownTags).toEqual(['@PILOT-TC-12']);
    expect(byTitle('dialogue de suppression').tags).toEqual(['@HAPPY_PATH', '@SAD_PATH']);
    expect(byTitle('code faux').tags).toContain('@PILOT-TC-TODO');
  });

  it('suit page objets et helpers, et évalue this.pageName', () => {
    expect(steps(byTitle('chemin nominal en ligne fr'))).toEqual([
      'exact:welcome', 'exact:applicant-identity', 'prefix:id-capture', 'exact:signature', 'exact:signature-otp', 'exact:summary',
    ]);
  });

  it('lit une classe calculée en entier (suffixe de version)', () => {
    expect(steps(byTitle('capture v2'))).toEqual(['exact:id-capture2_1']);
  });

  it('ne compte pas une sonde comme atteindre un écran', () => {
    expect(steps(byTitle('code faux'))).toEqual(['exact:signature-otp']);
    expect(byTitle('code faux').methods).not.toContain('SummaryPage.isDisplayed');
  });

  it('compte deux captures d’une même page séparément, avec page, suffixe et piste', () => {
    const shots = byTitle('chemin nominal en ligne en').screenshots;
    expect(shots.map((s) => [s.page.map((p) => p.step), s.suffix])).toEqual([
      [['welcome'], null],
      [['signature'], 'online-en'],
      [['summary'], null],
    ]);
    expect(shots[1]?.trail.map((g) => g.map((p) => p.step))).toEqual([['id-capture'], ['applicant-identity'], ['welcome']]);
  });

  it('lit le nom de l’image, y compris à travers une méthode ou un helper', () => {
    expect(byTitle('chemin nominal en ligne fr').screenshots.map((s) => s.name)).toEqual(['welcome.png', 'signature-online-fr.png', 'summary.png']);
    expect(byTitle('code faux').screenshots[0]?.name).toBe('signature-otp-helper-text-on-error.png');
    expect(byTitle('erreur technique').screenshots[0]?.name).toBe('journey-error.png');
  });

  it('lit le suffixe passé par une méthode intermédiaire', () => {
    expect(byTitle('code faux').screenshots).toMatchObject([{ call: 'validateUI', suffix: 'helper-text-on-error', page: [{ step: 'signature-otp' }] }]);
  });

  it('garde la classe SDK accolée et la capture sans page objet', () => {
    const t = byTitle('erreur technique');
    expect(t.steps).toEqual([{ step: 'internalError', match: 'exact', className: 'step-internalError journey-error' }]);
    expect(t.markers).toEqual([{ kind: 'class', value: 'journey-error' }]);
    expect(t.screenshots[0]).toMatchObject({ call: 'checkPageScreenshot', page: [], trail: [[{ step: 'internalError' }]] });
  });

  it('relève les marqueurs par id', () => {
    expect(byTitle('dialogue de suppression').markers).toContainEqual({ kind: 'id', value: 'deleteDialog' });
  });

  it('applique la langue par défaut du configurateur, et signale une langue illisible', () => {
    expect(byTitle('code faux').locales).toEqual(['fr']);
    expect(byTitle('langue illisible')).toMatchObject({ locales: [], localeUnknown: true });
  });

  it('relève les valeurs du cas et le configurateur appelé', () => {
    const t = byTitle('ouverture acceptée');
    expect(t.caseValues).toEqual({ locale: 'fr', channel: 'online', cardRange: 'premium' });
    expect(t.caseProperties).toEqual(['cardRange', 'channel', 'locale']);
    expect(byTitle('smoke prêt').configurers).toEqual(['configureLoanCase']);
  });

  it('reconnaît un test API (sans page)', () => {
    expect(byTitle('ouverture acceptée')).toMatchObject({ hasPage: false, fixtures: ['request'], steps: [], screenshots: [] });
  });

  it('relève les objets d’e-mails cherchés et les captures d’e-mails', () => {
    expect(byTitle('ouverture acceptée').emailSubjects).toEqual(['Bienvenue chez nous']);
    expect(byTitle('refus REJ01').emailCaptures).toEqual([{ subject: "Votre demande n'a pas abouti", suffix: 'rej01', name: 'email-rej01.png' }]);
  });

  it('liste les méthodes de page objet appelées', () => {
    expect(byTitle('erreur technique').methods).toEqual(['JourneyErrorPage.waitFor']);
  });

  it('signale une spec introuvable', () => {
    expect(scanTests(CORPUS.e2e, ['tests/nope.spec.ts']).warnings).toEqual(['spec introuvable : tests/nope.spec.ts']);
  });
});

describe('scanTests — specs-types (non-régression des conventions)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cc-scan-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const write = (rel: string, text: string) => {
    mkdirSync(dirname(join(dir, rel)), { recursive: true });
    writeFileSync(join(dir, rel), text);
  };

  write('p.ts', `export class P { constructor(private page: any) {}
    async open() { await this.page.locator('.step-home').click(); }
    async peek() { return this.page.locator('.step-hidden').isVisible(); } }`);
  write('a.spec.ts', `import { test } from '@playwright/test'; import { P } from './p';
    const CASES = [{ name: 'un', loc: 'fr' }, { name: 'deux', loc: 'nl' }] as const;
    test.describe('Bloc', { tag: ['@X'] }, () => {
      for (const c of CASES) {
        test(\`cas \${c.name}\`, async ({ page }) => {
          await new P(page).open();
          await new P(page).peek();
          await page.locator('[class*="step-promo"]').click();
          await page.locator("//div[@id='otherDialog']").count();
        });
      }
      test.only('seul', async () => {});
      test.describe.serial('Série @SERIAL', () => { test('dans la série', async ({ page }) => { await page.locator('#x').isVisible(); }); });
    });
    for (const x of build()) { test('boucle illisible', async () => {}); }
    function build(): string[] { return []; }`);
  const r = scanTests(dir, ['a.spec.ts']);
  const t = (title: string) => r.tests.find((x) => x.title === title)!;

  it('déplie une boucle sur des objets et lit les tags d’option des describe', () => {
    expect(r.tests.filter((x) => x.title.startsWith('cas')).map((x) => [x.title, x.tags])).toEqual([
      ['cas un', ['@X']],
      ['cas deux', ['@X']],
    ]);
  });

  it('ne compte pas une méthode-sonde ni une chaîne sondée', () => {
    expect(t('cas un').steps.map((s) => `${s.match}:${s.step}`)).toEqual(['exact:home', 'prefix:promo']);
    expect(t('cas un').markers).toEqual([]);
    expect(t('dans la série').markers).toEqual([]);
  });

  it('reconnaît test.only et describe.serial', () => {
    expect(t('seul').describes).toEqual(['Bloc']);
    expect(t('dans la série').tags).toEqual(['@X', '@SERIAL']);
  });

  it('signale une boucle de données illisible sans perdre le test', () => {
    expect(t('boucle illisible')).toBeDefined();
    expect(r.warnings).toEqual(['a.spec.ts:15 : boucle de données illisible']);
  });
});

describe('extractHits', () => {
  it('lit XPath, CSS et attributs', () => {
    expect(extractHits("//div[@class='step-a']//span[contains(@class,'step-b')]")).toEqual({
      steps: [
        { step: 'b', match: 'prefix', className: 'step-b' },
        { step: 'a', match: 'exact', className: 'step-a' },
      ],
      markers: [],
    });
    expect(extractHits('.journey-error #deleteDialog .step-c')).toEqual({
      steps: [{ step: 'c', match: 'exact', className: 'step-c' }],
      markers: [{ kind: 'class', value: 'journey-error' }, { kind: 'id', value: 'deleteDialog' }],
    });
    expect(extractHits("//*[@id='otp']").markers).toEqual([{ kind: 'id', value: 'otp' }]);
  });

  it('ignore les chaînes sans localisateur', () => {
    expect(extractHits('Bienvenue. Merci #1 !')).toEqual({ steps: [], markers: [] });
  });
});

describe('trailBefore', () => {
  const g = (s: string) => [{ step: s, match: 'exact' as const, className: `step-${s}` }];
  it('retire la page capturée en tête et les répétitions', () => {
    expect(trailBefore([g('a'), g('b'), g('b'), [], g('c'), g('c')], g('c'))).toEqual([g('b'), g('a')]);
  });
});
