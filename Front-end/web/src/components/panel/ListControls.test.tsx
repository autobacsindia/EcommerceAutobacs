/**
 * ListSearch regression: procurement reported that a space typed in a list's
 * search box "did nothing". Every list passes `text.trim()` up and the trimmed
 * text comes back as `value`; the box used to copy that back over what was
 * being typed, so a pause right after a space wiped it ("brake " → "brake",
 * then "pad" ran on as "brakepad").
 */
import { useState } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { ListSearch } from './ListControls';

function List({ onSearch }: { onSearch?: (q: string) => void }) {
  const [q, setQ] = useState('');
  return (
    <>
      {/* Exactly how every list wires it: store the trimmed text. */}
      <ListSearch value={q} onChange={(text) => { onSearch?.(text); setQ(text.trim()); }} label="Search" placeholder="Search" />
      <button type="button" onClick={() => setQ('')}>Clear all</button>
      <button type="button" onClick={() => setQ('from a link')}>Link</button>
      <output data-testid="q">{q}</output>
    </>
  );
}

const box = () => screen.getByLabelText('Search') as HTMLInputElement;
const typeAs = (text: string) => act(() => { fireEvent.change(box(), { target: { value: text } }); });
const pause = () => act(() => { jest.advanceTimersByTime(400); });

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

it('keeps a space typed just before a pause', () => {
  render(<List />);
  typeAs('brake ');
  pause();
  expect(screen.getByTestId('q')).toHaveTextContent('brake');
  expect(box().value).toBe('brake ');
  typeAs('brake pad');
  pause();
  expect(box().value).toBe('brake pad');
  expect(screen.getByTestId('q')).toHaveTextContent('brake pad');
});

it('keeps spaces between several words with pauses after each space', () => {
  render(<List />);
  for (const t of ['front ', 'front brake ', 'front brake pad']) { typeAs(t); pause(); }
  expect(box().value).toBe('front brake pad');
  expect(screen.getByTestId('q')).toHaveTextContent('front brake pad');
});

it('reports trimmed text once per pause, not again for a trailing space', () => {
  const onSearch = jest.fn();
  render(<List onSearch={onSearch} />);
  typeAs('brake');
  pause();
  typeAs('brake ');
  pause();
  expect(onSearch).toHaveBeenCalledTimes(1);
  expect(onSearch).toHaveBeenLastCalledWith('brake');
});

it('Enter searches straight away with the trimmed text', () => {
  const onSearch = jest.fn();
  render(<List onSearch={onSearch} />);
  typeAs('  pad  ');
  act(() => { fireEvent.keyDown(box(), { key: 'Enter' }); });
  expect(onSearch).toHaveBeenCalledWith('pad');
  expect(box().value).toBe('  pad  ');
});

it('a change from outside (Clear all, a link) still replaces the box', () => {
  render(<List />);
  typeAs('brake ');
  pause();
  act(() => { fireEvent.click(screen.getByText('Clear all')); });
  expect(box().value).toBe('');
  act(() => { fireEvent.click(screen.getByText('Link')); });
  expect(box().value).toBe('from a link');
});
