import {
  calculateForward, calculateReverse, forwardProblems, gstOn, mulDiv, parsePercent, parseRupees, percent, reverseProblems, rupees, splitInclusive,
  type ForwardInput,
} from './pricing';

const base: ForwardInput = {
  cost: 100000, costIncludesGst: false, gstRate: 18, claimGstCredit: true,
  freight: 0, dutyBp: 0, other: 0,
  priceBy: 'margin', marginBp: 2000, markupBp: 0, sellingPrice: 0, mrp: null, discountBp: 0,
};
const f = (over: Partial<ForwardInput>) => calculateForward({ ...base, ...over });

/** Small seeded generator so the property checks are repeatable. */
function rng(seed: number) {
  let s = seed >>> 0;
  return (max: number) => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s % max; };
}

describe('money parsing — from the digits, never a float multiply', () => {
  it('parseRupees', () => {
    expect(parseRupees('0.29')).toBe(29);      // 0.29 * 100 = 28.999… as a float
    expect(parseRupees('1.005')).toBeNaN();     // more than two decimals is a typo, not a rounding
    expect(parseRupees('1,250.5')).toBe(125050);
    expect(parseRupees('₹ 4,499.99')).toBe(449999);
    expect(parseRupees('499.')).toBe(49900);
    expect(parseRupees(1250.5)).toBe(125050);
    expect(parseRupees('')).toBeNull();
    expect(parseRupees(null)).toBeNull();
    expect(parseRupees('-5')).toBeNaN();
    expect(parseRupees('1e3')).toBeNaN();
    expect(parseRupees('abc')).toBeNaN();
  });

  it('parsePercent → basis points', () => {
    expect(parsePercent('12.5')).toBe(1250);
    expect(parsePercent('18%')).toBe(1800);
    expect(parsePercent('0.01')).toBe(1);
    expect(parsePercent('')).toBeNull();
    expect(parsePercent('12.345')).toBeNaN();
  });

  it('mulDiv rounds as asked, exactly, even past 2^53', () => {
    expect(mulDiv(5, 1, 2)).toBe(3);             // 2.5 half-up
    expect(mulDiv(5, 1, 2, 'floor')).toBe(2);
    expect(mulDiv(5, 1, 2, 'ceil')).toBe(3);
    expect(mulDiv(4, 1, 2, 'ceil')).toBe(2);     // exact: no bump
    expect(mulDiv(7, 1, 3)).toBe(2);             // 2.33
    expect(mulDiv(8, 1, 3)).toBe(3);             // 2.67
    expect(mulDiv(9_000_000_000_000, 10_000, 30_000)).toBe(3_000_000_000_000);
    expect(() => mulDiv(1, 1, 0)).toThrow();
  });

  it('formats rupees, paise only when there are any, and negatives', () => {
    expect(rupees(125050)).toBe('₹1,250.50');
    expect(rupees(10000000)).toBe('₹1,00,000');
    expect(rupees(-2550)).toBe('−₹25.50');
    expect(percent(1250)).toBe('12.5%');
  });
});

describe('GST', () => {
  it('splits an inclusive amount so the parts always add back exactly', () => {
    expect(splitInclusive(118000, 18)).toEqual({ ex: 100000, gst: 18000 });
    expect(splitInclusive(99999, 18)).toEqual({ ex: 84745, gst: 15254 }); // 84744.915 → 84745
    expect(splitInclusive(500, 0)).toEqual({ ex: 500, gst: 0 });
    const next = rng(42);
    for (let k = 0; k < 2000; k += 1) {
      const incl = 1 + next(10_000_000);
      const rate = [0, 5, 12, 18, 28][next(5)];
      const { ex, gst } = splitInclusive(incl, rate);
      expect(ex + gst).toBe(incl);
      expect(gst).toBeGreaterThanOrEqual(0);
      // ex is the nearest paisa to the true value
      expect(Math.abs(ex * (100 + rate) - incl * 100)).toBeLessThanOrEqual((100 + rate) / 2);
    }
  });

  it('GST on an ex-GST amount rounds half-up to the paisa', () => {
    expect(gstOn(101, 5)).toBe(5);    // 5.05
    expect(gstOn(110, 5)).toBe(6);    // 5.5 → 6
    expect(gstOn(99999, 18)).toBe(18000); // 17999.82
    expect(gstOn(12345, 0)).toBe(0);
  });
});

describe('forward: cost → selling price → profit', () => {
  it('the worked example: ₹1,000 + 18% GST, ₹50 freight, 20% margin', () => {
    const r = f({ freight: 5000 });
    expect(r).toMatchObject({
      costExGst: 100000, purchaseGst: 18000, landed: 105000,
      listExGst: 131250, listGst: 23625, listPrice: 154875,
      discount: 0, finalPrice: 154875, finalExGst: 131250, finalGst: 23625,
      gstPayable: 5625, profit: 26250, marginBp: 2000, markupBp: 2500,
      breakEven: 123900, maxDiscountBp: 2000, warnings: [],
    });
    // Every step is shown, and the last is the profit.
    expect(r.steps.map((s) => s.label)).toContain('Landed cost (per unit)');
    expect(r.steps[r.steps.length - 1]).toMatchObject({ label: 'Profit (per unit)', value: 26250 });
  });

  it('a supplier price that includes GST is split first', () => {
    const r = f({ cost: 118000, costIncludesGst: true });
    expect(r).toMatchObject({ costExGst: 100000, purchaseGst: 18000, landed: 100000, listExGst: 125000 });
    expect(f({ cost: 99999, costIncludesGst: true })).toMatchObject({ costExGst: 84745, purchaseGst: 15254 });
  });

  it('when GST credit cannot be claimed, the GST paid is a cost', () => {
    const r = f({ claimGstCredit: false });
    expect(r.landed).toBe(118000);
    expect(r.gstPayable).toBe(r.finalGst); // nothing to set off
  });

  it('import duty is on cost + freight', () => {
    const r = f({ freight: 10000, dutyBp: 1000 });
    expect(r.duty).toBe(11000);
    expect(r.landed).toBe(121000);
  });

  it('0% GST, markup and a customer discount', () => {
    const r = f({ cost: 50000, gstRate: 0, priceBy: 'markup', markupBp: 3000, discountBp: 1000 });
    expect(r).toMatchObject({
      purchaseGst: 0, landed: 50000, listExGst: 65000, listGst: 0, listPrice: 65000,
      discount: 6500, finalPrice: 58500, finalExGst: 58500, finalGst: 0,
      profit: 8500, marginBp: 1453, markupBp: 1700, breakEven: 50000,
    });
  });

  it('a discount re-computes the GST on what the customer actually pays', () => {
    const r = f({ discountBp: 1000 });
    expect(r.listPrice).toBe(147500);         // 125000 + 22500
    expect(r.discount).toBe(14750);
    expect(r.finalPrice).toBe(132750);
    expect(r.finalExGst + r.finalGst).toBe(132750);
    expect(r.finalExGst).toBe(112500);
    expect(r.profit).toBe(12500);
  });

  it('a fixed selling price that loses money, and one above MRP, both warn', () => {
    const r = f({ priceBy: 'price', sellingPrice: 100000, mrp: 90000 });
    expect(r.listExGst).toBe(84746);
    expect(r.profit).toBe(-15254);
    expect(r.marginBp).toBeLessThan(0);
    expect(r.maxDiscountBp).toBeNull();
    expect(r.warnings.join(' ')).toMatch(/above the MRP/);
    expect(r.warnings.join(' ')).toMatch(/loss of ₹152.54/);
  });

  it('shows the price as a discount off MRP', () => {
    const r = f({ priceBy: 'price', sellingPrice: 135000, mrp: 150000 });
    expect(r.mrpDiscountBp).toBe(1000);
  });

  it('exactly break-even says so', () => {
    const r = f({ priceBy: 'price', sellingPrice: 118000 });
    expect(r.profit).toBe(0);
    expect(r.breakEven).toBe(118000);
    expect(r.maxDiscountBp).toBe(0);
    expect(r.warnings).toEqual(['This sells at exactly break-even — no profit.']);
  });

  it('a 100% discount is a loss of the whole landed cost', () => {
    const r = f({ discountBp: 10000 });
    expect(r.finalPrice).toBe(0);
    expect(r.profit).toBe(-100000);
    expect(r.marginBp).toBeNull();
  });

  it('break-even is never below cost, and selling at it never loses money', () => {
    const next = rng(7);
    for (let k = 0; k < 1000; k += 1) {
      const input = {
        ...base, cost: 1 + next(5_000_000), gstRate: [0, 5, 12, 18, 28][next(5)], costIncludesGst: next(2) === 0,
        freight: next(50000), dutyBp: next(4000), other: next(20000), claimGstCredit: next(3) > 0,
      };
      const { breakEven } = calculateForward(input);
      const at = calculateForward({ ...input, priceBy: 'price', sellingPrice: breakEven });
      expect(at.profit).toBeGreaterThanOrEqual(0);
      // and a paisa less can not be more than a paisa of profit
      const below = calculateForward({ ...input, priceBy: 'price', sellingPrice: breakEven - 1 });
      expect(below.profit).toBeLessThanOrEqual(0);
    }
  });

  it('refuses inputs that make no sense, with a message for the field', () => {
    expect(forwardProblems({ ...base, cost: Number.NaN })[0]).toMatchObject({ field: 'cost' });
    expect(forwardProblems({ ...base, cost: 0 })[0].message).toMatch(/more than ₹0/);
    expect(forwardProblems({ ...base, gstRate: 15 })[0]).toMatchObject({ field: 'gstRate' });
    expect(forwardProblems({ ...base, marginBp: 10000 })[0]).toMatchObject({ field: 'marginBp' }); // 100% margin = infinite price
    expect(forwardProblems({ ...base, discountBp: 10001 })[0]).toMatchObject({ field: 'discountBp' });
    expect(forwardProblems({ ...base, priceBy: 'price', sellingPrice: 0 })[0]).toMatchObject({ field: 'sellingPrice' });
    expect(forwardProblems({ ...base, mrp: Number.NaN })[0]).toMatchObject({ field: 'mrp' });
    expect(forwardProblems(base)).toEqual([]);
    expect(() => f({ cost: 0 })).toThrow();
  });
});

describe('reverse: the most we can pay', () => {
  const rv = { sellingPrice: 118000, gstRate: 18, claimGstCredit: true, marginBp: 2000, freight: 0, dutyBp: 0, other: 0 };

  it('₹1,180 incl. 18% at a 20% margin → pay at most ₹800 + GST', () => {
    const r = calculateReverse(rv);
    expect(r).toMatchObject({ sellingExGst: 100000, sellingGst: 18000, maxLanded: 80000, maxBuyExGst: 80000, maxBuyGst: 14400, maxBuyInclGst: 94400, profit: 20000, warnings: [] });
  });

  it('with freight, duty and other charges, rounds down so the margin holds', () => {
    const r = calculateReverse({ ...rv, sellingPrice: 236000, marginBp: 2500, freight: 5000, dutyBp: 1000, other: 1000 });
    expect(r.maxLanded).toBe(150000);
    expect(r.maxBuyExGst).toBe(130454);
    expect(r.profit).toBeGreaterThanOrEqual(50000);
  });

  it('charges that use up the whole margin give no buy price, and say so', () => {
    const r = calculateReverse({ ...rv, freight: 90000 });
    expect(r.maxBuyExGst).toBe(0);
    expect(r.warnings[0]).toMatch(/no buy price works/);
  });

  it('round trip: paying the answer earns at least the margin; a paisa more does not', () => {
    const next = rng(99);
    for (let k = 0; k < 1000; k += 1) {
      const input = {
        sellingPrice: 10000 + next(5_000_000), gstRate: [0, 5, 12, 18, 28][next(5)], claimGstCredit: next(3) > 0,
        marginBp: next(6000), freight: next(5000), dutyBp: next(3000), other: next(3000),
      };
      const r = calculateReverse(input);
      if (r.maxBuyExGst <= 0) continue;
      const fwd = (cost: number) => calculateForward({
        ...base, cost, costIncludesGst: false, gstRate: input.gstRate, claimGstCredit: input.claimGstCredit,
        freight: input.freight, dutyBp: input.dutyBp, other: input.other, priceBy: 'price', sellingPrice: input.sellingPrice,
      });
      const at = fwd(r.maxBuyExGst);
      expect(at.landed).toBeLessThanOrEqual(r.maxLanded);
      expect(at.profit).toBe(r.profit);
      expect(fwd(r.maxBuyExGst + 1).landed).toBeGreaterThan(r.maxLanded);
    }
  });

  it('refuses nonsense', () => {
    expect(reverseProblems({ ...rv, sellingPrice: 0 })[0]).toMatchObject({ field: 'sellingPrice' });
    expect(reverseProblems({ ...rv, marginBp: 10000 })[0]).toMatchObject({ field: 'marginBp' });
    expect(reverseProblems({ ...rv, gstRate: 3 })[0]).toMatchObject({ field: 'gstRate' });
    expect(reverseProblems(rv)).toEqual([]);
  });
});
