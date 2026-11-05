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
