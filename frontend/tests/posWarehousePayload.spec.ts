import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../src/offline/index", () => ({
	getTaxTemplate: vi.fn(() => null),
	getTaxInclusiveSetting: vi.fn(() => true),
	isOffline: vi.fn(() => false),
}));
vi.mock("../src/posapp/components/pos/invoice_utils/currency", () => ({
	_getPlcConversionRate: vi.fn(() => 1),
}));
import {
	get_invoice_items,
	get_order_items,
} from "../src/posapp/components/pos/invoice_utils/document";

describe("POS warehouse payload", () => {
	beforeEach(() => {
		(globalThis as any).flt = (value: unknown) => Number(value || 0);
	});
	const context = (warehouse?: string) => ({
		invoiceType: "Order",
		selected_currency: "EUR",
		pos_profile: { warehouse: "BURMARRAD", currency: "EUR" },
		items: [
			{
				item_code: "A",
				warehouse,
				qty: 1,
				rate: 6.24,
				price_list_rate: 6.24,
				uom: "Nos",
				conversion_factor: 1,
			},
		],
		invoice_doc: {},
		new_delivery_date: "2026-09-22",
		isReturnInvoice: false,
	});
	for (const build of [get_invoice_items, get_order_items]) {
		it(`${build.name} falls back to the POS warehouse`, () => {
			expect(build(context())[0].warehouse).toBe("BURMARRAD");
		});
		it(`${build.name} preserves an explicitly selected warehouse`, () => {
			expect(build(context("CENTRAL"))[0].warehouse).toBe("CENTRAL");
		});
	}
});
