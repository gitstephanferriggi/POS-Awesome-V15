import { beforeEach, describe, expect, it, vi } from "vitest";
import { offerDeliveryBooking } from "../src/posapp/services/deliveryBooking";

describe("post-sale delivery scheduling", () => {
	beforeEach(() => {
		vi.stubGlobal("__", (text: string) => text);
		vi.stubGlobal("frappe", {require: vi.fn().mockResolvedValue(undefined), msgprint: vi.fn()});
		vi.stubGlobal("jysk", {delivery: {open_booking: vi.fn().mockResolvedValue(undefined)}});
	});
	it("opens the shared server-authorised chooser for the submitted Sales Order", async () => {
		await offerDeliveryBooking({doctype:"Sales Order", status:1, name:"SO-1", delivery_booking:true});
		expect((globalThis as any).jysk.delivery.open_booking).toHaveBeenCalledWith("SO-1");
	});
	it("does not offer slots for quotations, invoices, drafts or disabled delivery", async () => {
		for (const result of [null, {doctype:"Sales Invoice",status:1,name:"SI",delivery_booking:true},
			{doctype:"Quotation",status:1,name:"Q",delivery_booking:true},
			{doctype:"Sales Order",status:0,name:"SO",delivery_booking:true},
			{doctype:"Sales Order",status:1,name:"SO",delivery_booking:false}]) await offerDeliveryBooking(result);
		expect((globalThis as any).frappe.require).not.toHaveBeenCalled();
	});
	it("scheduling failure preserves success and explicitly prevents sale resubmission", async () => {
		(globalThis as any).jysk.delivery.open_booking.mockRejectedValue(new Error("Capacity unavailable"));
		await expect(offerDeliveryBooking({doctype:"Sales Order",status:1,name:"SO-1",delivery_booking:true})).resolves.toBeUndefined();
		expect((globalThis as any).frappe.msgprint).toHaveBeenCalledWith(expect.objectContaining({message:expect.stringContaining("Do not submit the sale again")}));
	});
});
