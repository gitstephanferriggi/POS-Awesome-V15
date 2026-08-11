import { computed, ref } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
	getPosSettlementTotal,
	isPosOrderTypeDocument,
} from "../src/posapp/utils/posDocumentMode";
import { usePaymentCalculations } from "../src/posapp/composables/pos/payments/usePaymentCalculations";
import { usePaymentMethods } from "../src/posapp/composables/pos/payments/usePaymentMethods";
import { usePaymentSubmission } from "../src/posapp/composables/pos/payments/usePaymentSubmission";

vi.mock("../src/offline/index", () => ({
	isOffline: vi.fn(() => false),
	saveOfflineInvoice: vi.fn(),
	updateLocalStock: vi.fn(),
}));

vi.mock("../src/posapp/services/invoiceService", () => ({
	default: { submitInvoice: vi.fn() },
}));

vi.mock("../src/posapp/utils/stockCoordinator", () => ({
	default: { applyInvoiceConsumption: vi.fn() },
}));

/**
 * Regression suite for the Sales Order deposit/advance payment fix.
 *
 * Bug: the POS payment screen applied POS Invoice cash-change + rounding logic
 * to Sales Orders. With rounded_total enabled, a €29.25 Sales Order settled
 * against rounded_total €29.00: Paid Amount showed €29.00 and any surplus was
 * booked as cash change. Sales Orders must use grand_total and have no change.
 */

const SO_PROFILE = { posa_allow_sales_order: 1, posa_create_only_sales_order: 0 };
const INVOICE_PROFILE = {}; // defaults -> Sales Invoice

const makeSoDoc = (payments: any[] = []) => ({
	currency: "EUR",
	grand_total: 29.25,
	rounded_total: 29.0, // rounded total ENABLED, must be ignored for SO
	payments,
});

const stores = {
	toastStore: { show: () => undefined },
	uiStore: { freeze: () => undefined, unfreeze: () => undefined },
};

describe("posDocumentMode order-type helpers", () => {
	it("flags Order mode as order-type when sales orders are allowed", () => {
		expect(
			isPosOrderTypeDocument({ invoiceType: "Order", posProfile: SO_PROFILE }),
		).toBe(true);
	});

	it("flags Quotation as order-type", () => {
		expect(
			isPosOrderTypeDocument({ invoiceType: "Quotation", posProfile: {} }),
		).toBe(true);
	});

	it("does not flag Invoice mode as order-type", () => {
		expect(
			isPosOrderTypeDocument({ invoiceType: "Invoice", posProfile: INVOICE_PROFILE }),
		).toBe(false);
	});

	it("honours a fully-built Sales Order doctype even without invoiceType", () => {
		expect(
			isPosOrderTypeDocument({ posProfile: {}, doc: { doctype: "Sales Order" } }),
		).toBe(true);
	});

	it("settlement total for a Sales Order uses grand_total, never rounded_total", () => {
		expect(
			getPosSettlementTotal(makeSoDoc(), { invoiceType: "Order", posProfile: SO_PROFILE }),
		).toBe(29.25);
	});

	it("settlement total for a POS/Sales Invoice keeps rounded_total behaviour", () => {
		expect(
			getPosSettlementTotal(makeSoDoc(), { invoiceType: "Invoice", posProfile: INVOICE_PROFILE }),
		).toBe(29.0);
	});
});

describe("Sales Order payment calculations (advance workflow)", () => {
	const buildCalc = (invoiceDoc: any) =>
		usePaymentCalculations({
			invoiceDoc,
			posProfile: ref({ currency: "EUR", posa_allow_multi_currency: 0, ...SO_PROFILE }),
			invoiceType: ref("Order"),
			currencyPrecision: ref(2),
			loyaltyAmount: ref(0),
			redeemedCustomerCredit: ref(0),
			customerCreditDict: ref([]),
			customerInfo: ref({}),
			giftCardRedemptions: ref([]),
			formatCurrency: (value) => String(value),
		});

	it("full payment of grand_total: fully paid, zero change", () => {
		const invoiceDoc = ref<any>(
			makeSoDoc([{ mode_of_payment: "Cash", type: "Cash", amount: 29.25 }]),
		);
		const calc = buildCalc(invoiceDoc);
		expect(calc.total_payments.value).toBe(29.25);
		expect(calc.diff_payment.value).toBe(0); // nothing left "To Be Paid"
		expect(calc.change_due.value).toBe(0); // NO cash change
	});

	it("partial payment stays a partial advance with zero change", () => {
		const invoiceDoc = ref<any>(
			makeSoDoc([{ mode_of_payment: "Cash", type: "Cash", amount: 10 }]),
		);
		const calc = buildCalc(invoiceDoc);
		expect(calc.total_payments.value).toBe(10);
		expect(calc.diff_payment.value).toBe(19.25); // remaining to be paid
		expect(calc.change_due.value).toBe(0);
	});

	it("excess entry never becomes cash change on a Sales Order", () => {
		const invoiceDoc = ref<any>(
			makeSoDoc([{ mode_of_payment: "Cash", type: "Cash", amount: 30 }]),
		);
		const calc = buildCalc(invoiceDoc);
		expect(calc.change_due.value).toBe(0);
		// diff_payment is clamped to >= 0 for order-type (never negative -> change)
		expect(calc.diff_payment.value).toBe(0);
	});

	it("multiple payment modes summing to grand_total: fully paid, zero change", () => {
		const invoiceDoc = ref<any>(
			makeSoDoc([
				{ mode_of_payment: "Cash", type: "Cash", amount: 20 },
				{ mode_of_payment: "BOV Credit Cards", type: "Bank", amount: 9.25 },
			]),
		);
		const calc = buildCalc(invoiceDoc);
		expect(calc.total_payments.value).toBe(29.25);
		expect(calc.diff_payment.value).toBe(0);
		expect(calc.change_due.value).toBe(0);
	});
});

describe("Sales Order settlement auto-fill target", () => {
	it("getInvoiceSettlementAmount targets grand_total for a Sales Order", () => {
		const invoiceDoc = ref<any>(makeSoDoc());
		const methods: any = usePaymentMethods({
			invoiceDoc,
			posProfile: ref({ ...SO_PROFILE }),
			invoiceType: ref("Order"),
			// no getNetInvoiceAmount -> exercise the internal grand/rounded branch
			formatFloat: (v: any) => Number(v) || 0,
			diffPayment: computed(() => 0),
			stores,
		});
		expect(methods.set_full_amount).toBeTypeOf("function");
		const cash = { mode_of_payment: "Cash", type: "Cash", amount: 0, base_amount: 0, default: 1 };
		invoiceDoc.value.payments = [cash];
		invoiceDoc.value.conversion_rate = 1;
		methods.set_full_amount(cash);
		expect(cash.amount).toBe(29.25); // NOT 29.00
	});
});

describe("Sales Order overpayment is blocked (no incorrect Payment Entry)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.stubGlobal("__", (value: string, args?: any[]) => {
			if (!args?.length) return value;
			return value.replace(/\{(\d+)\}/g, (_m, i) => String(args[Number(i)] ?? ""));
		});
		vi.stubGlobal("frappe", { utils: { play_sound: vi.fn() } });
	});

	it("rejects a Sales Order payment greater than grand_total with a clear message", async () => {
		const invoiceDoc = ref<any>(
			makeSoDoc([{ mode_of_payment: "Cash", type: "Cash", amount: 40 }]),
		);
		const { validateSubmission } = usePaymentSubmission({
			invoiceDoc,
			posProfile: ref({ ...SO_PROFILE, posa_allow_partial_payment: 1 }),
			stockSettings: ref({}),
			invoiceType: ref("Order"),
			formatFloat: (value) => Number(value || 0),
			isCashback: ref(false),
			paidChange: ref(0),
			creditChange: ref(0),
			redeemedCustomerCredit: ref(0),
			customerCreditDict: ref([]),
			diff_payment: ref(0),
		});
		await expect(validateSubmission(false)).rejects.toThrow(
			/Payment for a Sales Order cannot exceed its total/,
		);
	});

	it("accepts an exact-total Sales Order payment", async () => {
		const invoiceDoc = ref<any>(
			makeSoDoc([{ mode_of_payment: "Cash", type: "Cash", amount: 29.25 }]),
		);
		const { validateSubmission } = usePaymentSubmission({
			invoiceDoc,
			posProfile: ref({ ...SO_PROFILE, posa_allow_partial_payment: 1 }),
			stockSettings: ref({}),
			invoiceType: ref("Order"),
			formatFloat: (value) => Number(value || 0),
			isCashback: ref(false),
			paidChange: ref(0),
			creditChange: ref(0),
			redeemedCustomerCredit: ref(0),
			customerCreditDict: ref([]),
			diff_payment: ref(0),
		});
		await expect(validateSubmission(false)).resolves.toBe(true);
	});

	it("accepts a partial Sales Order advance when partial payment is allowed", async () => {
		const invoiceDoc = ref<any>(
			makeSoDoc([{ mode_of_payment: "Cash", type: "Cash", amount: 10 }]),
		);
		const { validateSubmission } = usePaymentSubmission({
			invoiceDoc,
			posProfile: ref({ ...SO_PROFILE, posa_allow_partial_payment: 1 }),
			stockSettings: ref({}),
			invoiceType: ref("Order"),
			formatFloat: (value) => Number(value || 0),
			isCashback: ref(false),
			paidChange: ref(0),
			creditChange: ref(0),
			redeemedCustomerCredit: ref(0),
			customerCreditDict: ref([]),
			diff_payment: ref(19.25),
		});
		await expect(validateSubmission(false)).resolves.toBe(true);
	});
});

describe("POS Invoice change regression (must be preserved)", () => {
	it("still targets rounded_total and books cash change for a Sales Invoice", () => {
		const invoiceDoc = ref<any>(
			makeSoDoc([{ mode_of_payment: "Cash", type: "Cash", amount: 29.25 }]),
		);
		const calc = usePaymentCalculations({
			invoiceDoc,
			posProfile: ref({ currency: "EUR", posa_allow_multi_currency: 0 }),
			invoiceType: ref("Invoice"),
			currencyPrecision: ref(2),
			loyaltyAmount: ref(0),
			redeemedCustomerCredit: ref(0),
			customerCreditDict: ref([]),
			customerInfo: ref({}),
			giftCardRedemptions: ref([]),
			formatCurrency: (value) => String(value),
		});
		// invoice_total = rounded_total 29.00; paid 29.25 -> 0.25 change
		expect(calc.change_due.value).toBeCloseTo(0.25, 2);
		expect(calc.diff_payment.value).toBeCloseTo(-0.25, 2);
	});
});
