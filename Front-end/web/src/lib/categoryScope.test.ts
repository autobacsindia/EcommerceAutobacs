/**
 * What `?category=` is allowed to mean on a single category page.
 *
 * The sidebar there writes the same param the global listing uses, so this is the
 * one place that decides whether a selection REFINES the current hub or silently
 * replaces it. Both failure modes it guards are real: a refinement that does
 * nothing (the page always queried the hub id, so the checkbox moved and the grid
 * did not), and a refinement that escapes the hub (a stale URL rendering Brakes
 * products under an Audio heading).
 */
import { resolveCategoryScope } from './categoryScope';

// The taxonomy arrives through an injected fetcher so this shares the chip
// strip's cached query rather than issuing a second identical request.
const fetchCategories = jest.fn();

const TAXONOMY = [
  { _id: 'hub-audio' },
  { _id: 'hub-brakes' },
  { _id: 'sub-subwoofers', parent: { _id: 'hub-audio' } },
  { _id: 'sub-speakers', parent: 'hub-audio' }, // unpopulated ref: a bare id
  { _id: 'sub-pads', parent: { _id: 'hub-brakes' } },
];

beforeEach(() => {
  fetchCategories.mockReset();
  fetchCategories.mockResolvedValue(TAXONOMY);
});

it('falls back to the hub when nothing is selected', async () => {
  expect(await resolveCategoryScope('hub-audio', [], fetchCategories)).toBe('hub-audio');
});

it('does not touch the network for the common unrefined case', async () => {
  await resolveCategoryScope('hub-audio', [], fetchCategories);
  expect(fetchCategories).not.toHaveBeenCalled();
});

it('narrows to a child of this hub', async () => {
  expect(await resolveCategoryScope('hub-audio', ['sub-subwoofers'], fetchCategories)).toBe('sub-subwoofers');
});

it('keeps several children of this hub', async () => {
  const scope = await resolveCategoryScope('hub-audio', ['sub-subwoofers', 'sub-speakers'], fetchCategories);
  expect(scope.split(',').sort()).toEqual(['sub-speakers', 'sub-subwoofers']);
});

it('reads an unpopulated parent ref as well as a populated one', async () => {
  // `/categories` populates `parent`, but a bare ObjectId string is the shape the
  // API returns elsewhere. Reading only one of them would drop half the tree.
  expect(await resolveCategoryScope('hub-audio', ['sub-speakers'], fetchCategories)).toBe('sub-speakers');
});

it('ignores a child belonging to a DIFFERENT hub', async () => {
  // /categories/audio?category=<brakes child> must not render brake pads.
  expect(await resolveCategoryScope('hub-audio', ['sub-pads'], fetchCategories)).toBe('hub-audio');
});

it('ignores another hub entirely', async () => {
  expect(await resolveCategoryScope('hub-audio', ['hub-brakes'], fetchCategories)).toBe('hub-audio');
});

it('keeps only the valid half of a mixed selection', async () => {
  expect(await resolveCategoryScope('hub-audio', ['sub-subwoofers', 'sub-pads'], fetchCategories)).toBe('sub-subwoofers');
});

it('ignores an id that is not in the taxonomy at all', async () => {
  expect(await resolveCategoryScope('hub-audio', ['not-a-category'], fetchCategories)).toBe('hub-audio');
});

it('falls back to the hub when the taxonomy call fails', async () => {
  // Broad-but-correct beats narrow-but-unverified: without the tree we cannot
  // prove the requested id belongs here.
  fetchCategories.mockRejectedValue(new Error('network'));
  expect(await resolveCategoryScope('hub-audio', ['sub-subwoofers'], fetchCategories)).toBe('hub-audio');
});

it('falls back to the hub when the taxonomy comes back empty', async () => {
  fetchCategories.mockResolvedValue([]);
  expect(await resolveCategoryScope('hub-audio', ['sub-subwoofers'], fetchCategories)).toBe('hub-audio');
});
