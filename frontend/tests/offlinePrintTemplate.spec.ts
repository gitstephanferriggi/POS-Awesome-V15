import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/offline/index", () => ({
	getPrintTemplate: vi.fn(() => ""),
	getOfflinePrintContext: vi.fn(() => null),
	getOpeningStorage: vi.fn(() => null),
	getStoredCustomer: vi.fn(async () => null),
	getTermsAndConditions: vi.fn(() => ""),
	memoryInitPromise: Promise.resolve(),
}));

import {
	getOfflinePrintContext,
	getOpeningStorage,
} from "../src/offline/index";
import renderOfflineInvoiceHTML from "../src/offline_print_template";

describe("offline print fallback totals", () => {
	beforeEach(() => {
		vi.stubGlobal("frappe", { _: (text: string) => text });
		vi.mocked(getOfflinePrintContext).mockReturnValue(null);
		vi.mocked(getOpeningStorage).mockReturnValue(null);
	});

	it("prints paid amount net of change in invoice currency", async () => {
		const html = await renderOfflineInvoiceHTML({
			name: "ACC-SINV-OFFLINE-1",
			company: "Test Co",
			customer: "Walk In",
			grand_total: 100,
			change_amount: 20,
			payments: [{ mode_of_payment: "Cash", amount: 120 }],
			items: [],
			taxes: [],
		});

		expect(html).toContain("Change Amount");
		expect(html).toContain("20");
		expect(html).toContain(
			'<td style="width:40%; text-align:right;">100</td>',
		);
	});

	it("prints return paid amount as negative", async () => {
		const html = await renderOfflineInvoiceHTML({
			name: "ACC-SINV-RETURN-OFFLINE",
			company: "Test Co",
			customer: "Walk In",
			is_return: 1,
			grand_total: -80,
			payments: [{ mode_of_payment: "Cash", amount: -80 }],
			items: [],
			taxes: [],
		});

		expect(html).toContain(
			'<td style="width:40%; text-align:right;">-80</td>',
		);
	});
});

describe("normal offline receipt layout", () => {
	it("uses the configured layout, safe customer text and a pending status without changing totals", async () => {
		vi.mocked(getOpeningStorage).mockReturnValue({
			pos_profile: { name: "Shop", print_format: "Normal" },
		} as any);
		vi.mocked(getOfflinePrintContext).mockReturnValue({
			profile: "Shop",
			format: "Normal",
			letter_head: "<b>SHOP LOGO</b>",
			html: `{{ letter_head }}<h2>{{ doc.doctype }}</h2>{{ doc.get("customer_name") }} {{ doc.get_formatted("grand_total") }}
    {% set saved_payments = frappe.db.sql("""SELECT mode_of_payment FROM tabPayment Entry GROUP BY mode_of_payment""", (doc.name,), as_dict=True) %}
    {% set balance = frappe.db.sql("""SELECT SUM(loyalty_points) FROM tabLoyalty Point Entry""", (doc.customer,))[0][0] %}`,
		} as any);
		const doc = {
			pos_profile: "Shop",
			doctype: "Sales Order",
			customer_name: "Customer <script>",
			grand_total: 962.67,
			posa_client_request_id: "original-id",
			payments: [{ mode_of_payment: "Cash", amount: 962.67 }],
			items: [],
			taxes: [],
		};
		const before = JSON.stringify(doc),
			html = await renderOfflineInvoiceHTML(doc);
		expect(html).toContain("<b>SHOP LOGO</b>");
		expect(html).toContain("Sales Order");
		expect(html).toContain("Customer &lt;script&gt;");
		expect(html).toContain("962.67");
		expect(html).toContain("Pending synchronisation");
		expect(JSON.stringify(doc)).toBe(before);
	});
	it("does not silently use a generic chit when the normal profile layout is unavailable", async () => {
		vi.mocked(getOpeningStorage).mockReturnValue({
			pos_profile: { name: "Shop", print_format: "Normal" },
		} as any);
		vi.mocked(getOfflinePrintContext).mockReturnValue({
			profile: "Other Shop",
			format: "Normal",
			html: "Wrong logo",
		} as any);
		await expect(
			renderOfflineInvoiceHTML({ pos_profile: "Shop", items: [] }),
		).rejects.toThrow("normal receipt layout");
	});
	it("omits the pending label for a submitted document", async () => {
		vi.mocked(getOpeningStorage).mockReturnValue(null);
		vi.mocked(getOfflinePrintContext).mockReturnValue(null);
		expect(
			await renderOfflineInvoiceHTML({
				docstatus: 1,
				name: "SINV-1",
				items: [],
				taxes: [],
			}),
		).not.toContain("Pending synchronisation");
	});
});
