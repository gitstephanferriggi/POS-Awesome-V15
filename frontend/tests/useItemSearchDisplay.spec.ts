import { describe, expect, it } from "vitest";

import { useItemSearch } from "../src/posapp/composables/pos/items/useItemSearch";

describe("useItemSearch display filtering", () => {
	it("does not re-run text search when the source is already search-scoped", () => {
		const { filterAndPaginate } = useItemSearch();
		const alreadyScopedResults = [
			{
				item_code: "ITEM-001",
				item_name: "Server Matched Item",
				rate: 10,
			},
			{
				item_code: "ITEM-002",
				item_name: "Another Indexed Hit",
				rate: 12,
			},
		];

		const result = filterAndPaginate(alreadyScopedResults, {
			searchTerm: "alpha",
			searchAlreadyApplied: true,
			limit: 50,
		});

		expect(result.map((item) => item.item_code)).toEqual([
			"ITEM-001",
			"ITEM-002",
		]);
	});

	it("still applies display-only filters after search has already been applied", () => {
		const { filterAndPaginate } = useItemSearch();
		const alreadyScopedResults = [
			{
				item_code: "ITEM-001",
				item_name: "Server Matched Item",
				rate: 0,
			},
			{
				item_code: "ITEM-002",
				item_name: "Another Indexed Hit",
				rate: 12,
				variant_of: "ITEM-TEMPLATE",
			},
			{
				item_code: "ITEM-003",
				item_name: "Barcode Hit",
				rate: 15,
				item_barcode: [{ barcode: "ABC-003" }],
			},
		];

		const result = filterAndPaginate(alreadyScopedResults, {
			searchTerm: "alpha",
			searchAlreadyApplied: true,
			hideZeroRate: true,
			hideVariants: true,
			onlyBarcode: true,
			limit: 50,
		});

		expect(result.map((item) => item.item_code)).toEqual(["ITEM-003"]);
	});
});

describe("warehouse stock ordering", () => {
 it("ranks all candidates before limiting, regardless of description or input order", () => {
  const rows = [
   { item_code: "A", item_name: "AAA", actual_qty: 1 },
   { item_code: "B", item_name: "ZZZ", actual_qty: "100" },
   { item_code: "C", item_name: "BBB", actual_qty: 10 },
  ];
  const { filterAndPaginate } = useItemSearch();
  expect(filterAndPaginate(rows, { limit: 2 }).map(i => i.item_code)).toEqual(["B", "C"]);
  expect(rows.map(i => i.item_code)).toEqual(["A", "B", "C"]);
  rows[0].actual_qty = 200;
  expect(filterAndPaginate(rows, { limit: 1 })[0].item_code).toBe("A");
 });
 it("keeps filters and numeric zero, negative and missing quantities coherent", () => {
  const { filterAndPaginate } = useItemSearch();
  const rows = [
   { item_code: "NEG", actual_qty: -5, rate: 1 },
   { item_code: "NONE", rate: 1 },
   { item_code: "ZERO", actual_qty: 0, rate: 1 },
   { item_code: "FREE", actual_qty: 999, rate: 0 },
   { item_code: "HIGH", actual_qty: 10, rate: 1 },
  ];
  expect(filterAndPaginate(rows, { hideZeroRate: true, limit: 3 }).map(i => i.item_code)).toEqual(["HIGH", "NONE", "ZERO"]);
 });
});
