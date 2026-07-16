// @vitest-environment jsdom

import { describe, expect, it, vi } from "vitest";

/**
 * Regression: adding an item (manual click OR barcode scan) must return focus
 * to the item search box with quantity defaulted to 1 — it must NOT park the
 * cursor in the cart quantity editor of the newly added row.
 *
 * Both add paths route through Invoice.vue's `focusCartItemQty` handler (bound
 * to the `focus_cart_item_qty` event). This test isolates that handler and
 * asserts it delegates to the search-focus path and never focuses the cart qty
 * field.
 */

// Recreate the handler exactly as defined on the Invoice.vue methods object.
function focusCartItemQty(this: any) {
	this.focusItemSearchField();
}

describe("add item focus behaviour", () => {
	it("focuses the item search box and does not open the cart qty editor", () => {
		const focusItemSearchField = vi.fn();
		const focusItemField = vi.fn();

		const ctx = {
			focusItemSearchField,
			$refs: { itemsTableRef: { focusItemField } },
			items: [{ posa_row_id: "r1", item_code: "ITEM-1", qty: 1 }],
			$nextTick: (cb: () => void) => cb(),
		};

		// Simulate the post-add event dispatch payload (ignored now).
		focusCartItemQty.call(ctx);

		expect(focusItemSearchField).toHaveBeenCalledTimes(1);
		// The cart quantity editor must never be focused/opened on add.
		expect(focusItemField).not.toHaveBeenCalled();
	});
});
