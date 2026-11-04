declare const frappe: any;
declare const __: (_str: string, _args?: any[]) => string;

/** Submission has succeeded: scheduling errors must never trigger an order retry. */
export async function offerDeliveryBooking(result: any): Promise<void> {
	if (result?.doctype !== "Sales Order" || result?.status !== 1 || !result?.delivery_booking || !result?.name) return;
	try {
		await frappe.require("/assets/jysk_malta/js/delivery_booking.js");
		await (globalThis as any).jysk.delivery.open_booking(result.name);
	} catch {
		frappe.msgprint({
			title: __("Order saved - delivery booking pending"),
			message: __("The Sales Order was saved successfully. Open its Find Delivery Slot action to complete scheduling. Do not submit the sale again."),
			indicator: "orange",
		});
	}
}
