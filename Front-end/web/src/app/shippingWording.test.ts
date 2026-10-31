/**
 * Shipping is never charged on the website: the customer pays the courier on
 * delivery, by cash or GPay / UPI. A customer was told "Free on every order" by
 * the Shipping page after that stopped being true, and the product page said
 * "Shipping calculated at checkout" — checkout never adds shipping.
 *
 * This scans every customer-facing source file for wording that promises free
 * delivery or a shipping charge at checkout. Admin screens are skipped: the
 * coupon type is still named "Free shipping" there. So are the help bot's
 * keyword lists, which match what customers TYPE, not what the site says.
 */
import fs from 'fs';
import path from 'path';

const SRC = path.join(__dirname, '..');
const FORBIDDEN = /free (shipping|delivery)|delivery is free|shipping is free|free on every order|calculated at (checkout|delivery)|shipping at checkout/i;

const isCustomerFacing = (file: string) =>
  /\.(tsx?|jsx?)$/.test(file) &&
  !/\.(test|spec)\.[jt]sx?$/.test(file) &&
  !file.split(path.sep).includes('admin') &&
  !file.split(path.sep).includes('__tests__');

const walk = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : isCustomerFacing(p) ? [p] : [];
  });

it('no customer-facing page says shipping is free or charged at checkout', () => {
  const hits = walk(SRC).flatMap((file) =>
    fs.readFileSync(file, 'utf8').split('\n')
      .map((line, i) => ({ line, at: `${path.relative(SRC, file)}:${i + 1}` }))
      .filter(({ line }) => FORBIDDEN.test(line) && !/keywords:/.test(line))
      .map(({ line, at }) => `${at}  ${line.trim()}`),
  );
  expect(hits).toEqual([]);
});
