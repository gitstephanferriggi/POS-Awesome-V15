/** A cached invoice total is not evidence of remaining refundable payments. */
export function authoritativeRefundCap(...documents: any[]): number {
	for (const doc of documents) {
		const value = doc?.posa_refundable_amount;
		if (value == null) continue;
		return typeof value === "number" && Number.isFinite(value) && value > 0
			? value
			: 0;
	}
	return 0;
}
