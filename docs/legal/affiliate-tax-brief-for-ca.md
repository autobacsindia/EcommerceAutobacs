# Affiliate Programme — Tax Treatment: Questions for our Chartered Accountant

**From:** Autobacs India
**Date raised:** 9 September 2026
**Contact:** devops@autobacsindia.com
**Status:** Awaiting confirmation. No payments will be made until answered.

---

## Why we are asking

We are launching an affiliate programme and need to confirm the correct TDS section and
rate, and the GST treatment, **before we make the first payment**. We have built the
system to *record* whatever rate you advise; it does not calculate tax itself, so a
correction is a settings change rather than a development change.

Our working assumption is **Section 194H** and **GST at 18% under SAC 9983**. We would
like that confirmed or corrected.

---

## The facts of the arrangement

Please base your answer on these. If any of them changes the answer, please say which.

1. **We are the seller.** Autobacs India buys and sells automotive accessories and parts
   as principal, on our own website. We are **not a marketplace** — no third party sells
   goods through our platform, and we hold and dispatch our own stock.

2. **Affiliates are promoters, not sellers.** An affiliate is an individual (typically a
   YouTuber or social-media creator) who advertises us to their audience using a tracking
   link and a discount code. They:
   - do **not** sell anything, hold stock, or take title to goods;
   - do **not** collect or handle any customer money;
   - have no authority to contract on our behalf;
   - are not our employees or agents, and work independently.

3. **All affiliates are individuals resident in India**, aged 18 or over. We do not
   currently admit non-residents or companies.

4. **How commission is calculated.** A fixed percentage (agreed individually, typically
   5–10%) of the *net goods value* of a qualifying order — that is, the order subtotal
   after any discount, **excluding delivery charges and GST**.

5. **When it is paid.** Commission is confirmed only after the order is paid for,
   delivered, and its return window has closed. Payment is by bank transfer, **monthly in
   arrears**, with a minimum payable balance of ₹1,000. Commission on a cancelled or
   returned order is reversed.

6. **Scale.** We expect most affiliates to earn between ₹5,000 and ₹50,000 per financial
   year. A small number may earn more.

7. **What we collect from each affiliate:** name, PAN (mandatory), bank account and IFSC,
   full address including state, and GSTIN where they have one. Most will not be
   GST-registered.

---

## Questions

### A. TDS

| # | Question | Your answer |
|---|---|---|
| A1 | Is this commission covered by **Section 194H**, or does **Section 194-O** apply instead? (We believe 194-O does not apply because we are not an e-commerce *operator* facilitating another party's sale — the affiliate is not an e-commerce participant. Please confirm.) | |
| A2 | What is the **current rate** of deduction? | |
| A3 | What is the **annual threshold** per affiliate below which no deduction is required, and is it assessed on aggregate payments in a financial year? | |
| A4 | What rate applies **if an affiliate does not furnish a PAN**? (We make PAN mandatory, but please confirm the fallback.) | |
| A5 | Is TDS deducted on the commission **excluding GST**, where GST is shown separately on the affiliate's invoice? | |
| A6 | Deposit deadline and the **return to file** (we assume Form 26Q, quarterly). Please confirm. | |
| A7 | Do we issue **Form 16A** to each affiliate, and on what cycle? | |
| A8 | Does anything change if an affiliate is a **registered firm or company** rather than an individual? | |

### B. GST

| # | Question | Your answer |
|---|---|---|
| B1 | Is the affiliate's supply correctly classified under **SAC 9983**, or is a more specific code appropriate (e.g. advertising or intermediary services)? | |
| B2 | Is **18%** the correct rate? | |
| B3 | For an affiliate who is **not GST-registered** (below the threshold): do we have any liability, in particular under **reverse charge**? | |
| B4 | For an affiliate who **is registered**: they invoice us with GST and we pay it in addition to commission. Can we claim **input tax credit** on it? | |
| B5 | **Place of supply** — the affiliate is in one state, we are in Kerala. Should this be treated as an inter-state supply (IGST) where their state differs from ours? | |
| B6 | Is there anything we must do when an affiliate **crosses the registration threshold** mid-year? | |

### C. Records and process

| # | Question | Your answer |
|---|---|---|
| C1 | What records should we retain for each payment, and for how long? | |
| C2 | Is our written statement to affiliates (see the extract below) accurate as drafted? | |
| C3 | Is there anything else we are missing before the first payment is made? | |

---

## What we tell affiliates today

This is the current text of clause 6 of our Affiliate Programme Terms, which every
affiliate accepts when applying. **Please correct anything inaccurate.**

> **6.1 Tax deducted at source (TDS).** We are required to deduct tax at source from
> commission payments. Our current understanding is that affiliate commission falls under
> Section 194H (commission or brokerage) of the Income-tax Act, 1961, and that deduction
> applies once your commission in a financial year exceeds ₹20,000. Because of this, your
> PAN is mandatory to join the programme. Where PAN is not available, a higher rate of
> deduction applies by law. We will provide the certificate of deduction required for you
> to claim credit.
>
> *Note. The section, rate and threshold above reflect our present understanding and are
> being confirmed with our chartered accountant. They may be corrected. We will apply the
> rate our accountant advises, and will tell you the rate applied on each payout.*
>
> **6.2 GST.** Your promotional services are a supply for GST purposes, which we
> understand falls under SAC 9983 at 18%. GST registration is your obligation, and
> generally arises only once your aggregate turnover exceeds the registration threshold
> (₹20,00,000 for most persons and states). If you are registered, you must give us your
> GSTIN and raise a proper tax invoice; we will then pay GST in addition to your
> commission. If you are not registered, we pay commission without GST.

---

## What happens with your answer

- The **rate** you give goes into a per-affiliate field in our admin. Each payment record
  stores the rate applied at the time, so historical payments stay correct if the rate
  later changes.
- Each payment record already stores: affiliate name, PAN, gross commission, TDS rate,
  TDS amount, net paid, payment date and the bank reference. We can export all of this as
  a spreadsheet for filing.
- We will correct the affiliate terms above to match your answer and reissue them.

---

*Internal reference: the declared position lives in
`Back-end/server/config/affiliateTax.js` and the affiliate terms at
`docs/legal/affiliateTerms-2026-09-09.md`. Update both when this is answered, and set
`AFFILIATE_TAX_POSITION_VERIFIED=true`.*
