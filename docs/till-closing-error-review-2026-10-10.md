## Summary

Till closing now waits for confirmed server success. A rejected request keeps the closing window and counted amounts intact. Missing stock valuation errors identify the item and explain that the stock/accounts team must record the correct incoming cost or Item Valuation Rate. Other ERP validation messages are shown as text; uncertain network outcomes tell the operator to check shift status before retrying.

The 12 October browser capture confirmed that shift POSA-OS-26-0000580 fails while consolidating return ACC-PSINV-2026-02676. Its recorded refund is EUR112.99, but rounded net rows EUR95.75 plus VAT EUR17.23 reconstruct EUR112.98. The backend now preserves the source rounded total and carries EUR0.01 through ERPNext's existing consolidation rounding fields. Payments and tax amounts are unchanged. This applies only to returns with explicit source rounded totals and drift bounded to one minor currency unit per source invoice (with a separate base-currency bound).

Siggiewi Shop disables rounding for new sales; ERPNext nevertheless supports explicit rounding on consolidated documents. The fix preserves historical source totals without changing that profile. The company has round-off account 6350 - Round Off - BGL and cost centre 100 - Main - BGL.

## Files Changed

- `posawesome/posawesome/overrides/pos_invoice_merge_log.py`: preserve bounded source return rounding before existing payment normalisation.
- `posawesome/posawesome/overrides/test_pos_invoice_merge_log.py`: eight regression tests, including actual ERPNext rounding/validation, disabled profile rounding, aggregate and base-currency cases.

- `frontend/src/posapp/utils/closingFailure.ts`: safe text formatting and actionable missing-valuation guidance, with network/unknown-error fallback.
- `frontend/src/posapp/services/api.ts`: export the existing Frappe server-message parser for reuse; parsing behaviour is unchanged.
- `frontend/src/posapp/composables/pos/closing/useClosingShift.ts`: await submission, block duplicate clicks, preserve amounts, use the readable error formatter.
- `frontend/src/posapp/components/pos/shell/ClosingDialog.vue`: show the error, submitting state and submission callback.
- `frontend/src/posapp/layouts/DefaultLayout.vue`: connect the global dialog to the submission handler so main-menu closing does not rely on a mounted selling screen.
- `frontend/src/posapp/composables/pos/shared/usePosShift.ts`: return the submission promise, propagate errors, clear local opening/cart state only after confirmation.
- `frontend/src/posapp/components/pos/shell/Pos.vue`: remove the old route-local submission listener; observe shared opening clearance to reset the mounted selling screen and show opening selection.
- `frontend/tests/closingFailure.spec.ts`, `closingSubmission.spec.ts`, `usePosShift.spec.ts`: test realistic Frappe responses, valuation messages, duplicate clicks, rejected/empty submissions, preserved amounts/cart and successful state clearance.

This completes and extends the close-dialog work. Deployment is handled by the user.

## Linked Features Checked

- Closing uses the existing POS Profile company/warehouse/payment configuration; no values are hardcoded into accounting.
- Invoice consolidation now preserves source return rounding. Stock valuation, ERP validations, tax amounts, prices, discounts and UOM calculations remain unchanged.
- Failed close leaves opening storage, invoice/cart and counted payments untouched. Successful close clears opening storage and cart and refreshes the selling-screen state.
- No changes to item search, print formats, QZ Tray, reports, invoice payload structure or offline invoice synchronisation.

## Commands Run

- Local bench Python: `python -m unittest posawesome.posawesome.overrides.test_pos_invoice_merge_log -v` — eight tests passed.
- Local ERPNext database-backed, unsaved-document reproduction using the captured return and production-equivalent rounding setting — original failure reproduced; corrected calculation passed.

- `npx vitest run tests/closingFailure.spec.ts tests/closingSubmission.spec.ts tests/usePosShift.spec.ts` — 25 tests passed.
- `npm run build` — type check and production build passed; existing large-bundle warning remains.
- `git diff --check` — passed.

## Risks / Notes

- The exact failure was reproduced locally through ERPNext’s merge, tax calculation and POS validation: before FAIL at EUR112.98; after PASS at EUR112.99 with EUR0.01 rounding. Local test documents were not saved; no production transactions were edited. Full closing/submission and resulting ledger entries still require deployment verification.
- No production valuation, invoices, till records or configuration were changed. No till was submitted as a diagnostic test.
- Browser/UAT validation of real ERP failures and switching between main menu/selling screen remains required after deployment.
- Commit and push authorised on 12 October 2026. Production deployment and verification remain with the user.

Suggested commit: `Preserve return rounding during consolidation and show till closing failures`.
