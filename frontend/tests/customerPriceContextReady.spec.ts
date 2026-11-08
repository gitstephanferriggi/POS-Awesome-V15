import { beforeEach, describe, expect, it, vi } from "vitest";
const storage = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn() }));
vi.mock("../src/offline/index", () => ({
	getStoredCustomer: storage.read,
	setCustomerStorage: storage.write,
	getCachedPriceListItems: vi.fn(),
	saveStoredValueSnapshot: vi.fn(),
}));
import {
	fetch_customer_details,
	resolveProfileCustomer,
} from "../src/posapp/components/pos/invoice_utils/customer";
function deferred() {
	let resolve!: () => void;
	const promise = new Promise<void>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}
function context() {
	return {
		customer: "New customer",
		customer_info: {},
		pos_profile: {
			company: "Company",
			selling_price_list: "Profile prices",
			currency: "EUR",
		},
		selected_price_list: "Previous customer prices",
		price_list_currency: "EUR",
		items: [{ item_code: "CHAIR", qty: 1, rate: 0 }],
		update_items_details: vi.fn().mockResolvedValue(undefined),
	};
}
describe("online customer pricing readiness", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		storage.read.mockResolvedValue(null);
		(globalThis as any).frappe = {
			call: vi.fn().mockResolvedValue({
				message: {
					customer: "New customer",
					customer_price_list: null,
					customer_group_price_list: null,
				},
			}),
		};
	});
	it("applies the profile fallback and refreshes the cart before a slow customer cache write", async () => {
		const pending = deferred();
		storage.write.mockReturnValue(pending.promise);
		const vm = context();
		const request = fetch_customer_details(vm);
		try {
			await vi.waitFor(
				() => expect(vm.selected_price_list).toBe("Profile prices"),
				{ timeout: 100 },
			);
			expect(vm.update_items_details).toHaveBeenCalledWith(vm.items);
		} finally {
			pending.resolve();
			await request;
		}
	});
	it("does not let cache failure prevent customer-specific prices from taking effect", async () => {
		storage.write.mockRejectedValue(
			new Error("Customer cache unavailable"),
		);
		(globalThis as any).frappe.call.mockResolvedValue({
			message: {
				customer: "New customer",
				customer_price_list: "Agreed prices",
				price_list_currency: "EUR",
			},
		});
		const log = vi.spyOn(console, "error").mockImplementation(() => {});
		const vm = context();
		try {
			await fetch_customer_details(vm);
			expect(vm.selected_price_list).toBe("Agreed prices");
			expect(vm.update_items_details).toHaveBeenCalledWith(vm.items);
		} finally {
			log.mockRestore();
		}
	});
});

describe("register customer selection", () => {
	const profile = {
		name: "Lija POS",
		company: "MDF Trading",
		customer: "Cash Sale",
	};
	it("preserves a new customer on background refresh of the same profile", () => {
		expect(
			resolveProfileCustomer("New customer", profile, { ...profile }),
		).toBe("New customer");
	});
	it("uses the configured default on initial registration or a different profile/company", () => {
		expect(resolveProfileCustomer("", {}, profile)).toBe("Cash Sale");
		expect(
			resolveProfileCustomer(
				"Previous customer",
				{ ...profile, name: "Qormi POS" },
				profile,
			),
		).toBe("Cash Sale");
		expect(
			resolveProfileCustomer(
				"Previous customer",
				{ ...profile, company: "Other company" },
				profile,
			),
		).toBe("Cash Sale");
	});
	it("defaults an empty selection and supports a profile without a default customer", () => {
		expect(resolveProfileCustomer("", profile, profile)).toBe("Cash Sale");
		expect(
			resolveProfileCustomer(
				"Previous customer",
				{},
				{ name: "New POS" },
			),
		).toBe("");
	});
});
