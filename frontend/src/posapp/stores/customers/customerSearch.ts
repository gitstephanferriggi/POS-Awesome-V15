import type { CustomerSummary } from "../../types/models";

type SearchableCustomer = CustomerSummary & {
	_search_text?: string;
};

export function normalizeCustomerSearchTerm(
	term: string | null | undefined,
): string {
	if (typeof term !== "string") {
		return "";
	}
	return term.trim();
}

export function buildCustomerSearchParts(
	term: string | null | undefined,
): string[] {
	return normalizeCustomerSearchTerm(term)
		.toLowerCase()
		.split(/\s+/)
		.filter(Boolean);
}

export function buildCustomerSearchText(
	customer: CustomerSummary | null | undefined,
): string {
	if (!customer) {
		return "";
	}

	return [
		customer.customer_name,
		customer.name,
		customer.mobile_no,
		customer.phone,
		...(customer.contact_numbers || []),
		...[customer.mobile_no, customer.phone, ...(customer.contact_numbers || [])]
			.filter(Boolean).map((value) => String(value).replace(/[^0-9]/g, "")),
		customer.email_id,
		(customer as CustomerSummary & { tax_id?: unknown }).tax_id,
	]
		.filter((value) => value !== null && value !== undefined)
		.map((value) => String(value).toLowerCase())
		.join("\n");
}

export function customerMatchesSearchParts(
	customer: CustomerSummary | null | undefined,
	searchParts: readonly string[],
): boolean {
	if (!searchParts.length) {
		return true;
	}

	if (!customer) {
		return false;
	}

	const searchableCustomer = customer as SearchableCustomer;
	const searchText =
		searchableCustomer._search_text || buildCustomerSearchText(customer);

	return searchParts.every((part) => {
		if (searchText.includes(part)) return true;
		// Formatted phone queries may contain +, spaces, hyphens or brackets.
		if (/^[+()\d.-]+$/.test(part)) {
			const digits = part.replace(/[^0-9]/g, "");
			return digits.length >= 3 && (searchText.includes(digits) ||
				[customer.mobile_no, customer.phone, ...(customer.contact_numbers || [])]
					.some((value) => String(value || "").replace(/[^0-9]/g, "").includes(digits)));
		}
		return false;
	});
}

export function customerMatchesSearchTerm(
	customer: CustomerSummary | null | undefined,
	term: string | null | undefined,
): boolean {
	return customerMatchesSearchParts(customer, buildCustomerSearchParts(term));
}
