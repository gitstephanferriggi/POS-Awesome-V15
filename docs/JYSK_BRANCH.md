# JYSK deployment branch

Use branch `jysk` from `gitstephanferriggi/POS-Awesome-V15` for JYSK sites. This branch requires the JYSK Malta application for the fulfilment and location-stock screens. It was created from main at `82a352e5` on 6 October 2026.

## Summary

Publishes the existing local JYSK POS work while preserving the current main-branch connectivity recovery, date handling and synchronous sales-order deposit fixes. Returns, payment and printing logic are not changed by this branch diff.

## Files Changed

- `frontend/src/posapp/components/pos/items/FulfilmentLocation.vue` and `LocationStockLookup.vue`: live availability and fulfilment source selection through JYSK APIs.
- `frontend/src/posapp/components/pos/items/ItemsSelector.vue`: connects those screens to item selection and sales orders.
- `frontend/src/posapp/components/pos/invoice/ItemsTableExpandedRow.vue`: lets an order line change fulfilment location.
- `frontend/src/posapp/components/pos/invoice/InvoiceCustomerSection.vue`: gives the invoice/order selector more space.
- `frontend/src/posapp/components/pos/invoice_utils/document.ts`: retains line warehouses and the POS Profile tax template in document payloads.
- `frontend/src/posapp/composables/pos/items/addition/useItemMerging.ts`: keeps lines from different fulfilment warehouses separate.
- `frontend/src/posapp/composables/pos/items/useItemAddition.ts`: defaults warehouse from POS Profile.
- `frontend/src/posapp/composables/pos/items/useItemDetailFetcher.ts`: refreshes online availability; preserves offline cache fallback.
- `posawesome/posawesome/api/item_fetchers.py` and `item_processing/{stock,details}.py`: uses JYSK reservation-aware availability and caps batch stock by available stock.
- `frontend/tests/{fulfilmentMerging,posWarehousePayload}.spec.ts`: regression coverage for warehouse separation and payload defaults.

## Linked Features Checked

POS Profile warehouse/company defaults, item addition and merging, document payloads, stock lookup, availability refresh, startup connectivity, sales-order deposits and return proration. No pricing formula, payment-method, tax-rate, receipt or return workflow changes were introduced during publication.

## Commands Run

- Vitest: fulfilmentMerging, posWarehousePayload, useNetworkLifecycleStartup, useItemAddition, useItemDetailFetcher, itemDetailFetcherRequestKey, processInvoiceReturnProration, salesOrderAdvanceNoCashChange: 39 tests passed.
- `vue-tsc --noEmit`: passed.
- `vite build`: passed; existing large-chunk warning.
- JYSK `test_pos_location_stock` and `test_pos_order_setup` with local Frappe site initialized: six tests passed; database rolled back.
- Python AST syntax checks and `git diff --check`: passed.

## Risks / Notes

Deploy only to JYSK sites with `jysk_malta` installed. Location selection needs an online connection. Online stock refresh increases API requests; high-volume cashier performance has not been re-tested. Browser/device end-to-end checkout and printing have not been repeated for this publication. Some Node tests log an unavailable IndexedDB warning but their assertions pass.

Existing local dependency lockfile churn was excluded; no dependency upgrade is included. The older local queued-payment modification was superseded by main's synchronous deposit fix and was not reapplied. The running local bench checkout and Cloud sites were not changed by this publication.

After selecting `jysk` in Frappe Cloud, deploy/build and refresh the POS. Check stock by location, an order fulfilled from another location, VAT-inclusive totals, deposit/payment, and an existing return in UAT before using the branch live.
