import { moreCount, splitMore } from './navMore';

const item = (href: string, count?: number) => ({ href, count });

it('moves only the named links, keeping both lists in their original order', () => {
  const { items, more } = splitMore(
    [item('/a'), item('/b'), item('/c'), item('/d')],
    ['/d', '/b'],
  );
  expect(items.map((i) => i.href)).toEqual(['/a', '/c']);
  expect(more.map((i) => i.href)).toEqual(['/b', '/d']);
});

it('never adds a link the caller filtered out (permissions are decided before)', () => {
  const { items, more } = splitMore([item('/a')], ['/hidden-by-role']);
  expect(items.map((i) => i.href)).toEqual(['/a']);
  expect(more).toEqual([]);
});

it('adds up only real unread counts for the "More" badge', () => {
  expect(moreCount([item('/a', 3), item('/b'), item('/c', 0), item('/d', 2)])).toBe(5);
  expect(moreCount([])).toBe(0);
});
