// @vitest-environment jsdom
import { createApp, defineComponent, nextTick, reactive, ref } from "vue";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useCustomerDisplayPublisher } from "../src/posapp/composables/pos/shared/useCustomerDisplayPublisher";
import { getCustomerDisplayStorageKey } from "../src/posapp/utils/customerDisplay";

const mocks = vi.hoisted(() => ({
	invoice: null as any,
	customers: null as any,
}));
vi.mock("../src/posapp/stores/invoiceStore", () => ({
	useInvoiceStore: () => mocks.invoice,
}));
vi.mock("../src/posapp/stores/customersStore", () => ({
	useCustomersStore: () => mocks.customers,
}));
let app: ReturnType<typeof createApp>;
beforeEach(() => {
	vi.useFakeTimers();
	vi.stubGlobal("__", (text: string) => text);
	localStorage.clear();
	sessionStorage.clear();
	mocks.invoice = reactive({
		items: [],
		metadata: { changeVersion: 0 },
		invoiceDoc: null,
		flowContext: null,
		invoiceToLoad: null,
		orderToLoad: null,
		flowToLoad: null,
	});
	mocks.customers = reactive({ selectedCustomer: null, customerInfo: {} });
});
afterEach(() => {
	app?.unmount();
	vi.useRealTimers();
	vi.unstubAllGlobals();
});
it("publishes profile adverts and protects cart, payment, and pending document states until the bill clears", async () => {
	let publisher: ReturnType<typeof useCustomerDisplayPublisher>;
	const profile = ref({
		posa_enable_customer_display: 1,
		posa_enable_customer_display_adverts: 1,
		posa_customer_display_adverts: [
			{ image: "/files/a.png", title: "Offer" },
		],
	});
	app = createApp(
		defineComponent({
			setup() {
				publisher = useCustomerDisplayPublisher({
					posProfile: profile,
				});
				return () => null;
			},
		}),
	);
	app.mount(document.createElement("div"));
	vi.advanceTimersByTime(80);
	const read = () =>
		JSON.parse(
			localStorage.getItem(
				getCustomerDisplayStorageKey(publisher!.channelId),
			)!,
		).payload;
	expect(read()).toMatchObject({
		bill_active: false,
		adverts: profile.value.posa_customer_display_adverts,
	});
	mocks.invoice.items.push({ item_code: "A", qty: 1, rate: 2 });
	expect(read().bill_active).toBe(true);
	mocks.invoice.invoiceDoc = { name: "draft-bill" };
	mocks.invoice.items = [];
	vi.advanceTimersByTime(60000);
	expect(read().bill_active).toBe(true);
	mocks.invoice.invoiceDoc = null;
	expect(read().bill_active).toBe(false);
	mocks.invoice.invoiceToLoad = { name: "held-bill" };
	expect(read().bill_active).toBe(true);
	mocks.invoice.invoiceToLoad = null;
	expect(read().bill_active).toBe(false);
	profile.value.posa_enable_customer_display_adverts = 0;
	await nextTick();
	vi.advanceTimersByTime(80);
	expect(read().adverts).toEqual([]);
});
