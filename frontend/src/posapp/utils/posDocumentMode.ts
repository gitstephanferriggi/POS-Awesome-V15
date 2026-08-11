import { parseBooleanSetting } from "./stock";

export type PosDocumentMode = "Invoice" | "Order" | "Quotation" | "Return" | string;

interface ResolvePosDocumentDoctypeOptions {
	invoiceType?: PosDocumentMode | null;
	posProfile?: Record<string, any> | null;
}

export function resolvePosDocumentDoctype({
	invoiceType,
	posProfile,
}: ResolvePosDocumentDoctypeOptions) {
	if (invoiceType === "Quotation") {
		return "Quotation";
	}

	if (
		invoiceType === "Order" &&
		(parseBooleanSetting(posProfile?.posa_allow_sales_order) ||
			parseBooleanSetting(posProfile?.posa_create_only_sales_order))
	) {
		return "Sales Order";
	}

	if (parseBooleanSetting(posProfile?.create_pos_invoice_instead_of_sales_invoice)) {
		return "POS Invoice";
	}

	return "Sales Invoice";
}

/**
 * A POS document is "order-type" (Sales Order / Quotation) when it follows the
 * deposit/advance-payment workflow rather than the POS Invoice cash-settlement
 * workflow. Order-type documents must NEVER use POS cash-rounding or cash-change
 * logic: the payment target is the true `grand_total`, and any surplus is a
 * partial/over advance, never cash change.
 */
export function isPosOrderTypeDocument({
	invoiceType,
	posProfile,
	doc,
}: ResolvePosDocumentDoctypeOptions & { doc?: Record<string, any> | null }) {
	const resolvedDoctype = resolvePosDocumentDoctype({ invoiceType, posProfile });
	if (resolvedDoctype === "Sales Order" || resolvedDoctype === "Quotation") {
		return true;
	}
	// Defensive: if a fully built order-type doc is passed through, honour its doctype.
	const docType = String(doc?.doctype || "").trim();
	return docType === "Sales Order" || docType === "Quotation";
}

/**
 * Single source of truth for the POS payment/settlement target.
 * - Order-type (Sales Order / Quotation): always `grand_total` (never rounded).
 * - Everything else (POS Invoice / Sales Invoice / Return): existing behaviour,
 *   `rounded_total || grand_total`.
 */
export function getPosSettlementTotal(
	doc: Record<string, any> | null | undefined,
	options: ResolvePosDocumentDoctypeOptions = {},
): number {
	if (!doc) return 0;
	const grandTotal = Number(doc.grand_total) || 0;
	if (isPosOrderTypeDocument({ ...options, doc })) {
		return grandTotal;
	}
	const rounded = doc.rounded_total;
	return Number(rounded || grandTotal) || 0;
}
