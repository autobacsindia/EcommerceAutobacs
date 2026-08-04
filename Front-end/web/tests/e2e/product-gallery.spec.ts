import { test, expect, type Page } from '@playwright/test';

/**
 * PDP gallery — the behaviour that jsdom cannot honestly verify.
 *
 * Hover, real scroll-snap paging, and native `<dialog>` modality all depend on a
 * layout engine and a compositor. The jest suite covers state and wiring; this
 * covers the parts that only exist in a browser. Runs against the dev server
 * (see playwright.config.js) — it resolves a product from the catalogue API
 * rather than hard-coding a slug, so it survives catalogue changes.
 */

const ZOOM_SOURCE = /w_1600/;

/** Mirrors MAX_DOTS in GalleryCarousel: past this the dot row is not rendered. */
const MAX_DOTS = 8;

/**
 * Navigate to a real PDP whose image count falls in `[min, max]`.
 *
 * Resolved from the catalogue API rather than by clicking the first card. Most
 * products carry one or two photos, so a "first product in the list" helper
 * silently skipped every multi-slide assertion — the suite reported green while
 * never running the checks that matter. Returns false only when the catalogue
 * genuinely has nothing suitable.
 */
async function openProduct(
  page: Page,
  { min = 1, max = Number.MAX_SAFE_INTEGER }: { min?: number; max?: number } = {}
): Promise<boolean> {
  const response = await page.request.get('/api/v1/products?limit=60');
  if (!response.ok()) return false;

  const { products } = (await response.json()) as {
    products?: Array<{ slug?: string; images?: unknown[] }>;
  };
  const match = products?.find((p) => {
    const count = p.images?.length ?? 0;
    return p.slug && count >= min && count <= max;
  });
  if (!match?.slug) return false;

  await page.goto(`/products/${match.slug}`);
  await expect(page.getByTestId('gallery-carousel')).toBeAttached();
  // Park the cursor off the gallery — otherwise it can sit inside the magnifier
  // from the moment the page loads and the zoom engages before we hover.
  await page.mouse.move(0, 0);
  return true;
}

test.describe('PDP gallery', () => {
  test('desktop: hover magnifies at the cursor and only then fetches the sharp source', async ({
    page,
    isMobile,
  }) => {
    test.skip(!!isMobile, 'hover magnifier is desktop-only by design');
    test.skip(!(await openProduct(page)), 'no products in the catalogue');

    const frame = page.getByTestId('gallery-zoom');
    await expect(frame).toBeVisible();

    // The zoom-resolution source must not be on the critical path.
    const sharpRequests: string[] = [];
    page.on('request', (request) => {
      if (ZOOM_SOURCE.test(request.url())) sharpRequests.push(request.url());
    });
    await page.waitForLoadState('networkidle');
    expect(sharpRequests).toHaveLength(0);

    const layer = frame.locator('div').first();
    await expect(layer).not.toHaveCSS('transform', /matrix\(2/);

    const box = (await frame.boundingBox())!;
    await page.mouse.move(box.x + box.width * 0.25, box.y + box.height * 0.75);

    await expect(layer).toHaveCSS('transform', /matrix\(2, 0, 0, 2/);
    await expect.poll(() => sharpRequests.length).toBeGreaterThan(0);

    // The magnifier must anchor on the cursor, not the centre — a fixed origin
    // is the classic silent failure here, and it still "looks zoomed".
    const origin = await layer.evaluate((el) => getComputedStyle(el).transformOrigin);
    const [originX, originY] = origin.split(' ').map(parseFloat);
    // A couple of px of slack for device-pixel rounding of the cursor position.
    // The point of the assertion is that the origin FOLLOWS the pointer, not
    // that it is exact — a fixed (e.g. centre) origin still looks zoomed and is
    // the failure mode worth catching.
    expect(Math.abs(originX - box.width * 0.25)).toBeLessThan(2);
    expect(Math.abs(originY - box.height * 0.75)).toBeLessThan(2);

    // Leaving the frame must fully release the zoom.
    await page.mouse.move(box.x - 50, box.y - 50);
    await expect(layer).not.toHaveCSS('transform', /matrix\(2, 0, 0, 2/);
  });

  test('desktop: the frame opens a modal viewer that traps focus and closes on Escape', async ({
    page,
    isMobile,
  }) => {
    test.skip(!!isMobile, 'covered by the touch spec on mobile');
    test.skip(!(await openProduct(page)), 'no products in the catalogue');

    await page.getByTestId('gallery-zoom').click();

    const dialog = page.locator('dialog[open]');
    await expect(dialog).toBeVisible();
    // showModal (not show) — only the modal form puts the dialog in the top
    // layer and makes the rest of the page inert.
    await expect(page.locator('body')).toHaveCSS('overflow', 'hidden');
    await expect(dialog.getByRole('button', { name: 'Close image viewer' })).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(page.locator('body')).not.toHaveCSS('overflow', 'hidden');
  });

  test('touch: the strip pages by scroll and reports the slide it settled on', async ({
    page,
    isMobile,
  }) => {
    test.skip(!isMobile, 'touch carousel replaces the magnifier below lg');
    test.skip(
      !(await openProduct(page, { min: 3, max: MAX_DOTS })),
      'no product with 3-8 images in the catalogue'
    );

    const carousel = page.getByTestId('gallery-carousel');
    await expect(carousel).toBeVisible();
    await expect(page.getByTestId('gallery-zoom')).toBeHidden();

    const counter = carousel.getByText(/^\d+ \/ \d+$/);
    await expect(counter).toHaveText(/^1 \//);

    // Drive the native scroller and assert our observer reports the landing
    // slide — the snapping itself is the browser's job, not ours.
    const strip = carousel.locator('[role="group"]');
    await strip.evaluate((el) => el.scrollBy({ left: el.clientWidth, behavior: 'instant' as ScrollBehavior }));

    await expect(counter).toHaveText(/^2 \//);
  });

  test('touch: a multi-slide jump lands on the slide that was asked for', async ({
    page,
    isMobile,
  }) => {
    test.skip(!isMobile, 'touch carousel only');
    test.skip(
      !(await openProduct(page, { min: 3, max: MAX_DOTS })),
      'no product with 3-8 images in the catalogue'
    );

    const carousel = page.getByTestId('gallery-carousel');
    const dots = carousel.getByRole('button', { name: /^Go to image \d+ of \d+$/ });
    const total = await dots.count();
    test.skip(total < 3, 'needs at least three images to jump past one');

    // The regression this locks: a smooth scroll across several slides sweeps
    // every slide in between past the observer's 50% threshold. Reporting one
    // of those retargets the in-flight animation, so asking for the last image
    // used to strand the customer on the second.
    const counter = carousel.getByText(/^\d+ \/ \d+$/);
    await expect(counter).toHaveText(`1 / ${total}`);

    await dots.nth(total - 1).click();

    await expect(counter).toHaveText(`${total} / ${total}`);
    // And it must still be there once the animation has fully settled.
    await page.waitForTimeout(1500);
    await expect(counter).toHaveText(`${total} / ${total}`);
  });

  test('touch: tapping a slide opens the viewer at that image', async ({ page, isMobile }) => {
    test.skip(!isMobile, 'touch path only');
    test.skip(!(await openProduct(page)), 'no products in the catalogue');

    await page.getByTestId('gallery-carousel').getByRole('button').first().click();

    const dialog = page.locator('dialog[open]');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(/^1 \/ \d+$/)).toBeVisible();

    // Slides must accept the browser's own pinch gesture; a custom zoom would
    // have to disable it, and that regression is invisible in unit tests.
    const slide = dialog.locator('[style*="touch-action"]').first();
    await expect(slide).toHaveCSS('touch-action', 'pan-x pinch-zoom');
  });
});
