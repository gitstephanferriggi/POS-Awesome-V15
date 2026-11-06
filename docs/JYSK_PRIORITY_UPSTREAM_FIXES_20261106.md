# JYSK priority upstream fixes

This release integrates four reviewed POS Awesome fixes into the JYSK UAT branch.
Production sites and D365 are outside the release scope.

## Changes and linked features

- Offline Item Price and Pricing Rule sync now bounds page size independently of offset. Large catalogues can finish without repeating the page at offset 2000. Stock snapshot pagination is unchanged.
- Invoice validation checks the combined settlement rather than demanding that the cash part cover the whole invoice. Existing JYSK cashback classification, credit, write-off limits, deposits, no-deposit orders and stock-conflict retry behaviour remain.
- Price changes, quotations, orders and opening shifts resolve the canonical POS Profile and enforce user, company, feature and payment-method boundaries. Price changes also validate the item, UOM and permitted selling price list. Existing JYSK delivery dates, tax contract, synchronous deposits and delivery booking response are retained.
- Printer administration requires native permissions, connection probes use bounded TCP checks against private printer addresses, and offline receipts remove executable markup while retaining receipt calculations.
- An unavailable customer balance remains null and displays Unavailable. Cached balances are scoped by user, company and customer and are not represented as current balances during offline/error states. Late responses cannot overwrite a newer selection. JYSK linked phone search and Malta localities remain.

## Upstream references

Adapted from defendicon/POS-Awesome-V15 commits `bf642680fc`, `72fdbbea6d`,
`3484696010`, `0cd63f52c3`, `0c7821d284` and `e1bfff2225`.
The shared authorisation helper and associated regression tests are retained from
upstream with test harness adjustments for the pinned Frappe runtime.

## Verification

- 152 focused frontend and JYSK regression checks passed, covering payments, customer balances and caching, phone search and localities, stock fulfilment, offline warning delay, stock sync, deposits and receipt printing.
- A further 38 pricing, offers and payment regression checks passed.
- 25 backend authorisation and printer security checks passed.
- 18 backend pagination, customers and JYSK order/deposit checks passed.
- 48 existing invoice and stock-conflict retry checks passed.
- A 6107-record catalogue test visited 13 pages once and reached its final watermark.
- Type checking, changed-source ESLint, Python syntax and diff whitespace checks passed.
- Production frontend build passed with the existing large-chunk warning. Vite's runner config loader avoids writing build configuration to the shared dependency cache.
- Twelve native checks on the isolated local ERPNext lab passed. Authorised and denied price edits, foreign-company and guest rejection, zero-deposit draft order values and balance response types were checked. The transaction was rolled back and all native test records and original prices were verified unchanged.

No business records were created in primary UAT for these tests. Cloud rollout
uses a normal backed-up migration and verifies exact app hashes, ledger totals,
stocktake/MRP record counts and POS Profile settings before/after deployment.
Physical receipt printers and payment terminals require a cashier device check;
their attached hardware cannot be simulated by the unit tests.
