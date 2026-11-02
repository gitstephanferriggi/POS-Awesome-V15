import { describe, expect, it } from "vitest";
import {
	buildCustomerSearchParts,
	buildCustomerSearchText,
	customerMatchesSearchParts,
	customerMatchesSearchTerm,
	normalizeCustomerSearchTerm,
} from "../src/posapp/stores/customers/customerSearch";
import type { CustomerSummary } from "../src/posapp/types/models";

describe("customer search helpers", () => {
	it("normalizes empty and whitespace-only search terms", () => {
		expect(normalizeCustomerSearchTerm(null)).toBe("");
		expect(normalizeCustomerSearchTerm(undefined)).toBe("");
		expect(normalizeCustomerSearchTerm("  Jane Doe  ")).toBe("Jane Doe");
	});

	it("tokenizes a query once for repeated customer comparisons", () => {
		expect(buildCustomerSearchParts("  Jane  0101 TIN ")).toEqual([
			"jane",
			"0101",
			"tin",
		]);
	});

	it("matches every search token across customer searchable fields", () => {
		const customer: CustomerSummary = {
			name: "CUST-001",
			customer_name: "Jane Doe",
			mobile_no: "+1 555 0101",
			email_id: "jane@example.com",
			tax_id: "TIN-99",
		};

		expect(customerMatchesSearchTerm(customer, "jane 0101 tin")).toBe(true);
		expect(customerMatchesSearchTerm(customer, "jane missing")).toBe(false);
		expect(customerMatchesSearchTerm(customer, "   ")).toBe(true);
	});

	it("uses persisted normalized search text when available", () => {
		const customer = {
			name: "CUST-001",
			customer_name: "Jane Doe",
			mobile_no: "+1 555 0101",
			email_id: "jane@example.com",
			tax_id: "TIN-99",
		} as CustomerSummary & { _search_text?: string };
		customer._search_text = buildCustomerSearchText(customer);
		customer.customer_name = "Changed after indexing";

		expect(customerMatchesSearchParts(customer, ["jane", "tin-99"])).toBe(
			true,
		);
	});
	it("finds linked phones and secondary numbers despite punctuation", () => {
		const customer: CustomerSummary = {
			name: "CUST-002", customer_name: "Example Customer",
			phone: "+356 9912-3456", contact_numbers: ["+356 9912-3456", "(356) 2123 4567"],
		};
		for (const query of ["99123456", "+35699123456", "9912 3456", "example 99123456", "21234567", "(356)21234567"]) {
			expect(customerMatchesSearchTerm(customer, query), query).toBe(true);
		}
		expect(customerMatchesSearchTerm(customer, "99887766")).toBe(false);
	});
	it("keeps old cache rows without contact fields searchable", () => {
		expect(customerMatchesSearchTerm({name: "C-1", customer_name: "Existing", mobile_no: "9912 3456", _search_text: "existing\n9912 3456"}, "99123456")).toBe(true);
		expect(customerMatchesSearchTerm(null, "99123456")).toBe(false);
	});

});
