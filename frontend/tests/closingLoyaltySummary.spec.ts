import { describe, expect, it, vi } from "vitest";
import { ref } from "vue";

import { useClosingSummary } from "../src/posapp/composables/pos/closing/useClosingSummary";

import { useClosingShift } from "../src/posapp/composables/pos/closing/useClosingShift";

const formatters = {
	formatCurrencyWithSymbol: (value: number, currency: string) => `${currency} ${value.toFixed(2)}`,
	formatCount: (value: number) => String(value),
	formatCurrency: (value: number) => value.toFixed(2),
	currencySymbol: (currency: string) => currency,
	__: (text: string) => text,
};

describe("useClosingSummary loyalty redemption", () => {
	it("shows loyalty redemption as a separate non-payment closing insight", () => {
		const overview = ref({
			company_currency: "PKR",
			total_invoices: 1,
			sales_summary: {
				gross_company_currency_total: 120,
				net_company_currency_total: 120,
				average_invoice_value: 120,
				sale_invoices_count: 1,
			},
			loyalty_redemption: {
				count: 1,
				points: 2,
				company_currency_total: 20,
				by_currency: [
					{
						currency: "PKR",
						total: 20,
						company_currency_total: 20,
						points: 2,
						invoice_count: 1,
					},
				],
			},
			cash_expected: {
				mode_of_payment: "Cash",
				company_currency_total: 100,
				by_currency: [],
			},
		});

		const summary = useClosingSummary(overview, ref({}), ref({}), formatters);

		expect(summary.loyaltyRedemptionSummary.value.company_currency_total).toBe(20);
		expect(summary.loyaltyRedemptionByCurrency.value[0].points).toBe(2);
		expect(summary.secondaryInsights.value).toContainEqual(
			expect.objectContaining({
				key: "loyalty-redemption",
				value: "PKR 20.00",
				caption: "Points: 2",
			}),
		);
		expect(summary.paymentsByMode.value).toEqual([]);
	});
});

describe("useClosingSummary approved customer refunds", () => {
	it("shows refunds separately from change without changing net cash", () => {
		const overview = ref({
			company_currency: "EUR",
			customer_refunds: { count: 1, company_currency_total: 10, by_currency: [] },
			change_returned: { company_currency_total: 0, by_currency: [] },
			cash_expected: { mode_of_payment: "Cash", company_currency_total: 20, by_currency: [] },
			payments_by_mode: [{ mode_of_payment: "Cash", total: 20, company_currency_total: 20 }],
		});
		const summary = useClosingSummary(overview, ref({}), ref({}), formatters);
		expect(summary.secondaryInsights.value).toContainEqual(expect.objectContaining({
			key: "customer-refunds", label: "Customer Refunds", value: "EUR 10.00", caption: "Refund count: 1",
		}));
		expect(summary.secondaryInsights.value).toContainEqual(expect.objectContaining({ key: "change-returned", value: "EUR 0.00" }));
		expect(summary.paymentsByMode.value[0].total).toBe(20);
	});

	it("supports older sites without the optional refund summary", () => {
		const summary = useClosingSummary(ref({ company_currency: "EUR" }), ref({}), ref({}), formatters);
		expect(summary.customerRefundsSummary.value.count).toBe(0);
		expect(summary.secondaryInsights.value).toContainEqual(expect.objectContaining({ key: "customer-refunds", value: "EUR 0.00" }));
	});
});

describe("closing overview RPC payload", () => {
	it("preserves the refund summary through normalization into the visible insight", async () => {
		vi.stubGlobal("frappe", { call: vi.fn().mockResolvedValue({ message: {
			company_currency: "EUR", customer_refunds: { count: "1", company_currency_total: "10.00", by_currency: [{ currency: "EUR", total: "10.00" }] },
			cash_expected: { company_currency_total: "20.00" },
		} }) });
		try {
			const closing = useClosingShift(null);
			closing.fetchOverview("OWNED-SHIFT", "EUR");
			expect((globalThis as any).frappe.call).toHaveBeenCalledTimes(1);
			await vi.waitFor(() => expect(closing.overview.value).not.toBeNull());
			const summary = useClosingSummary(closing.overview, ref({}), ref({}), formatters);
			expect(closing.overview.value).toMatchObject({ customer_refunds: { count: 1 } });
			expect(summary.customerRefundsSummary.value.count).toBe(1);
			expect(summary.secondaryInsights.value).toContainEqual(expect.objectContaining({ key: "customer-refunds", value: "EUR 10.00" }));
			expect(closing.overview.value.cash_expected.company_currency_total).toBe(20);
		} finally { vi.unstubAllGlobals(); }
	});
});
