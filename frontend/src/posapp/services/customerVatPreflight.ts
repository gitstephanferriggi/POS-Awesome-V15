/** Project order checkout into the existing permission-scoped party-facts API.
 * This is a check/update of customer facts, never an invoice or order mutation. */
export function customerVatPreflightDocument(doc: any, doctype: string) {
	if (doctype !== "Sales Order") return doc;
	return { ...doc, doctype: "Sales Invoice", name: undefined, docstatus: 0, is_pos: 1 };
}
