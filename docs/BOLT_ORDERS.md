# Bolt Orders workspace (development)

New route: `/bolt-orders` in the default POS layout. The Quick Actions entry and global
alert strip appear only when the Webshop operations service enables the current profile.
The global alert component survives route changes; its queue store polls every five seconds,
without overlapping scheduled requests. It does not add items to the cashier's cart.

## Files and linked behaviour

- `components/bolt/BoltOrders.vue`: queue, item picking/scanning, acceptance, readiness,
  manager takeover/rejection, courier information and handover controls; manager-approved
  reduced quantities/replacements with a refund preview; store open/pause confirmation;
  read-only final-basket reconciliation and staff-problem recovery.
- `components/bolt/BoltOrderAlerts.vue`: shared queue lifecycle, explicit audio enable/test,
  repeating alarm until server acknowledgement. Browser sleep/mute restrictions still apply.
- `stores/boltOrdersStore.ts`: scoped API calls, stale-profile response protection, polling,
  action lock and preservation of alarms during transport errors.
- `components/navbar/NavbarMenu.vue`, `layouts/DefaultLayout.vue`, `router/index.ts`:
  navigation and cross-screen alert integration.
- `tests/unit/boltOrdersStore.test.ts`: cross-terminal acknowledgement, outage, profile
  switch and concurrent action regression tests.

Backend dependency: Webshop's `webshop.bolt_integration.operations`, disabled by default.
Deploy both repositories to UAT together. See Webshop `docs/BOLT_POS_OPERATIONS.md` for setup
and outstanding integration tests. No role assignments or production activation occur here.

Standard POS search, cart pricing/discounts/UOM, customer pricing, payments, printing,
returns, offline sales and closing code are unchanged. Bolt prices/taxes come from its
backend configuration, not the active cash basket. Bolt operations require connectivity;
there is no offline acceptance or queued financial action. No general cache stores customer
or courier details. Stock/receivable posting is handled by the backend at handover.

Verified locally: four queue tests and an alarm component test (gesture required, repeating
sound, shared acknowledgement); frontend type check; Vite production build. Webshop has
94 unit tests and a local ERP transaction test covering inclusive VAT, order amendment,
exactly-once stock deduction/invoicing and no cash-till payment. All ERP test writes roll back.
Required on UAT: physical alarm/volume test, browser rendering/scanner checks, permissions,
real Bolt two-way callbacks/actions, duplicate/cancellation races and stock/accounting.

Suggested commit: `feat(pos): add opt-in Bolt order picking workspace and persistent alerts`

Adjustments support whole-piece reductions and published, equal-or-cheaper replacement
products. The manager sees the projected reduction before confirming an action that may
refund the buyer through Bolt. Price overrides and more expensive replacements are not
allowed. If the final basket differs from that approved preview, handover is blocked.

Store status is the last webhook observation, shown separately from the last request result.
New courier pickup callbacks display confirmation without duplicating ERP invoices.
Production remains opt-in; this commit is for UAT testing, not automatic activation.
