import { describe, expect, it, vi } from "vitest";

vi.mock("../src/offline/index", () => ({
	getStoredCustomer: vi.fn(),
	getCachedPriceListItems: vi.fn(),
	setCustomerStorage: vi.fn(),
	saveStoredValueSnapshot: vi.fn(),
}));
import { _applyPriceListRate } from "../src/posapp/components/pos/invoice_utils/customer";

const context = () => ({
	pos_profile: { currency: "EUR" },
	selected_currency: "EUR",
	invoice_doc: { is_return: 0 },
	_computePriceConversion: (value: number) => ({
		price_list_rate: value,
		base_price_list_rate: value,
	}),
});
const row = () => ({
	qty: 1,
	rate: 0,
	base_rate: 0,
	price_list_rate: 0,
	base_price_list_rate: 0,
	discount_amount: 0,
	discount_percentage: 0,
	_manual_rate_set: false,
});

describe("customer price refresh for normal full-price cart lines", () => {
	it("replaces an earlier zero fallback with the customer's resolved profile price", () => {
		const item = row();
		_applyPriceListRate(context(), item, 10, "EUR");
		expect(item.price_list_rate).toBe(10);
		expect(item.base_price_list_rate).toBe(10);
		expect(item.rate).toBe(10);
		expect(item.base_rate).toBe(10);
	});
	it("moves an untouched full-price line to the newly selected list", () => {
		const item = { ...row(), rate: 10, base_rate: 10, price_list_rate: 10 };
		_applyPriceListRate(context(), item, 12, "EUR");
		expect(item.rate).toBe(12);
		expect(item.base_rate).toBe(12);
	});
	it("retains explicit manual prices and intentional free lines", () => {
		for (const flags of [
			{ _manual_rate_set: true },
			{ locked_price: true },
			{ posa_offer_applied: 1 },
			{ is_free_item: 1 },
			{ sales_order: "SOURCE-ORDER" },
		]) {
			const item = { ...row(), ...flags };
			_applyPriceListRate(context(), item, 10, "EUR");
			expect(item.rate).toBe(0);
			expect(item.base_rate).toBe(0);
			expect(item.price_list_rate).toBe(10);
		}
	});
	it("keeps an already discounted selling rate while refreshing its reference price", () => {
		const item = {
			...row(),
			rate: 8,
			base_rate: 8,
			price_list_rate: 10,
			discount_percentage: 20,
		};
		_applyPriceListRate(context(), item, 12, "EUR");
		expect(item.rate).toBe(8);
		expect(item.base_rate).toBe(8);
		expect(item.price_list_rate).toBe(12);
	});
	it("does not reprice a return or a negative source line", () => {
		for (const returns of [true, false]) {
			const item = { ...row(), qty: returns ? 1 : -1 };
			const ctx = context();
			ctx.invoice_doc.is_return = returns ? 1 : 0;
			_applyPriceListRate(ctx, item, 10, "EUR");
			expect(item.rate).toBe(0);
			expect(item.base_rate).toBe(0);
		}
	});
	it("uses converted selling and company rates rather than duplicating exchange logic", () => {
		const ctx = {
			...context(),
			selected_currency: "USD",
			_computePriceConversion: () => ({
				price_list_rate: 11,
				base_price_list_rate: 10,
			}),
		};
		const item = row();
		_applyPriceListRate(ctx, item, 10, "EUR");
		expect(item.rate).toBe(11);
		expect(item.base_rate).toBe(10);
	});
});
