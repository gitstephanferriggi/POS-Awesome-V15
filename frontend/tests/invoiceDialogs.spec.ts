// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";

import { close_payments, show_payment } from "../src/posapp/components/pos/invoice_utils/dialogs";

const createPaymentContext = () => ({
	_suppressClosePaymentsTimer: null,
	_suppressClosePayments: false,
	customer: "CUST-001",
	items: [{ item_code: "ITEM-001" }],
	validate: vi.fn(async () => true),
	ensure_auto_batch_selection: vi.fn(async () => {}),
	invoiceType: "Invoice",
	pos_profile: { currency: "USD" },
	invoice_doc: {},
	process_invoice: vi.fn(async () => ({
		doctype: "Sales Invoice",
		grand_total: 10,
		rounded_total: 10,
		total: 10,
		payments: [],
	})),
	process_invoice_from_order: vi.fn(),
	reload_current_invoice_from_backend: vi.fn(),
	selected_currency: "USD",
	conversion_rate: 1,
	_getPlcConversionRate: () => 1,
	flt: (value: unknown) => Number(value || 0),
	currency_precision: 2,
	float_precision: 2,
	isReturnInvoice: false,
	get_payments: () => [],
	$nextTick: async () => {},
	uiStore: {
		openPaymentDialog: vi.fn(),
		closePaymentDialog: vi.fn(),
		setActiveView: vi.fn(),
	},
	eventBus: { emit: vi.fn() },
	toastStore: { show: vi.fn() },
});

describe("invoice payment dialogs", () => {
	beforeEach(() => {
		delete (window as any).jysk;
		vi.stubGlobal("__", (value: string) => value);
		vi.stubGlobal("frappe", { call: vi.fn() });
		Object.defineProperty(window, "innerWidth", {
			value: 500,
			writable: true,
			configurable: true,
		});
	});

	it("switches compact layout to the selector when opening payments", async () => {
		const context = createPaymentContext();

		await show_payment(context);

		expect(context.uiStore.setActiveView).toHaveBeenCalledWith("payment");
		expect(context.eventBus.emit).toHaveBeenCalledWith("set_compact_panel", "selector");
		expect(context.eventBus.emit).toHaveBeenCalledWith("show_payment", "true");
	});

	it.each([null, "2026-11-10"])("shows native Sales Order VAT totals before taking a deposit with requested date %s", async requested => {
		vi.stubGlobal("frappe", {call: vi.fn(), datetime: {now_date: () => "2026-11-05"}});
		const context: any = createPaymentContext();
		context.invoiceType = "Order";
		context.pos_profile = {currency: "EUR", posa_allow_sales_order: 1, posa_create_only_sales_order: 1};
		context.new_delivery_date = requested;
		context.invoice_doc = requested ? {posa_delivery_date: requested} : {};
		const nativeOrder = {name: "SO-DEMO", doctype: "Sales Order", grand_total: 23.6,
			total: 20, total_taxes_and_charges: 3.6, taxes: [{rate: 18, tax_amount: 3.6}], payments: []};
		context.process_invoice.mockResolvedValue(nativeOrder);
		context.reload_current_invoice_from_backend.mockResolvedValue(nativeOrder);
		await show_payment(context);
		expect(context.process_invoice).toHaveBeenCalledTimes(1);
		expect(context.new_delivery_date).toBe(requested || "2026-11-05");
		expect(context.eventBus.emit).toHaveBeenCalledWith("send_invoice_doc_payment",
			expect.objectContaining({grand_total: 23.6, total_taxes_and_charges: 3.6}));
	});

	it("leaves the cart untouched before saving a draft when country completion is pending", async () => {
		const context: any = createPaymentContext();
		const doc = {doctype: "Sales Invoice", customer: context.customer, is_pos: 1,
			company: "Shop Company", pos_profile: "Shop Till", posa_pos_opening_shift: "Open Till"};
		context.get_invoice_doc = vi.fn(() => doc);
		const check = vi.fn(async () => false);
		(window as any).jysk = {vat: {ensure_customer: check}};
		await show_payment(context);
		expect(check).toHaveBeenCalledWith(doc);
		expect(context.process_invoice).not.toHaveBeenCalled();
		expect(context.uiStore.setActiveView).not.toHaveBeenCalled();
		expect(context.items).toEqual([{item_code: "ITEM-001"}]);
	});

	it("requests missing country for an order before saving its draft or opening payment", async () => {
		const context: any = createPaymentContext();
		context.invoiceType = "Order"; context.pos_profile = {name: "Shop Till", posa_allow_sales_order: 1};
		const doc = {doctype: "Sales Order", name: "SO-DRAFT", customer: context.customer,
			company: "Shop Company", pos_profile: "Shop Till", posa_pos_opening_shift: "Own Shift", items: context.items};
		context.get_invoice_doc = vi.fn(() => doc); const before = JSON.stringify(doc);
		const check = vi.fn(async () => false); (window as any).jysk = {vat: {ensure_customer: check}};
		await show_payment(context);
		expect(check).toHaveBeenCalledWith({...doc, doctype: "Sales Invoice", name: undefined, docstatus: 0, is_pos: 1});
		expect(context.process_invoice).not.toHaveBeenCalled(); expect(context.uiStore.openPaymentDialog).not.toHaveBeenCalled();
		expect(JSON.stringify(doc)).toBe(before);
	});

	it("checks country before native draft save and then opens payments with its totals", async () => {
		const context: any = createPaymentContext();
		context.get_invoice_doc = vi.fn(() => ({doctype: "Sales Invoice"}));
		const check = vi.fn(async () => true);
		(window as any).jysk = {vat: {ensure_customer: check}};
		await show_payment(context);
		expect(check.mock.invocationCallOrder[0]).toBeLessThan(context.process_invoice.mock.invocationCallOrder[0]);
		expect(context.eventBus.emit).toHaveBeenCalledWith("send_invoice_doc_payment",
			expect.objectContaining({grand_total: 10}));
	});

	it("switches compact layout back to the invoice when closing payments", () => {
		const context = {
			_suppressClosePayments: false,
			paymentVisible: true,
			uiStore: {
				paymentDialogOpen: false,
				closePaymentDialog: vi.fn(),
				setActiveView: vi.fn(),
			},
			eventBus: { emit: vi.fn() },
		};

		close_payments(context);

		expect(context.uiStore.setActiveView).toHaveBeenCalledWith("items");
		expect(context.eventBus.emit).toHaveBeenCalledWith("set_compact_panel", "invoice");
		expect(context.eventBus.emit).toHaveBeenCalledWith("show_payment", "false");
	});
});
