// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	db,
	initPromise,
	memory,
	saveOfflineInvoice,
	retryOfflineInvoice,
	getOfflineInvoices,
	setInvoiceOutboxMode,
	syncOfflineInvoices,
} from "../src/offline/index";

describe("explicit stopped invoice recovery", () => {
	beforeEach(async () => {
		await initPromise;
		for (const t of ["write_queue", "queue", "keyval", "invoice_outbox"])
			await db.table(t).clear();
		memory.offline_invoices = [];
		memory.offline_customers = [];
		memory.manual_offline = false;
		setInvoiceOutboxMode("off");
		localStorage.clear();
		(globalThis as any).frappe = { call: vi.fn() };
	});
	async function seed(doctype = "Sales Order") {
		await saveOfflineInvoice({
			invoice: {
				doctype,
				customer: "CUST-TEST",
				company: "Shop",
				pos_profile: "Shop POS",
				posa_client_request_id: "original-id",
				posting_date: "2026-10-27",
				grand_total: 962.67,
				payments: doctype === "Quotation" ? [] : [{ mode_of_payment: "Cash", amount: 962.67 }],
				items: [{ item_code: "PLANT", qty: 1 }],
			},
			data: { idempotency_key: "original-id" },
		});
		const row = (await db.table("write_queue").toArray())[0];
		await db.table("write_queue").put({
			...row,
			status: "dead_letter",
			retry_count: 5,
			last_error: "Original server error",
		});
		return row;
	}
	it("preserves the original payload and request ID on manual retry", async () => {
		const row = await seed();
		await retryOfflineInvoice(row.queue_id);
		const saved = await db.table("write_queue").get(row.queue_id);
		expect(saved.payload).toEqual(row.payload);
		expect(saved.idempotency_key).toBe(row.idempotency_key);
		expect(saved.status).toBe("pending");
		expect(saved.retry_count).toBe(0);
		expect(saved.last_error).toBe("Original server error");
		expect(getOfflineInvoices()[0].status).toBe("pending");
		await expect(retryOfflineInvoice(row.queue_id)).rejects.toThrow();
	});
	it("never resets an actively syncing transaction", async () => {
		const row = await seed();
		await db
			.table("write_queue")
			.update(row.queue_id, { status: "syncing" });
		await expect(retryOfflineInvoice(row.queue_id)).rejects.toThrow();
		expect((await db.table("write_queue").get(row.queue_id)).status).toBe(
			"syncing",
		);
	});
	it("keeps coordinator outbox and legacy queue aligned", async () => {
		setInvoiceOutboxMode("coordinator");
		const row = await seed();
		const out = (await db.table("invoice_outbox").toArray())[0];
		await db
			.table("invoice_outbox")
			.update(out.outbox_id, { status: "dead_letter", retry_count: 5 });
		await retryOfflineInvoice(row.queue_id);
		const saved = await db.table("invoice_outbox").get(out.outbox_id);
		expect(saved.status).toBe("pending");
		expect(saved.retry_count).toBe(0);
		expect(saved.client_request_id).toBe("original-id");
	});
	it("does not resubmit an already acknowledged outbox transaction", async () => {
		setInvoiceOutboxMode("coordinator");
		const row = await seed();
		const out = (await db.table("invoice_outbox").toArray())[0];
		await db
			.table("invoice_outbox")
			.update(out.outbox_id, { status: "acknowledged" });
		await retryOfflineInvoice(row.queue_id);
		expect(getOfflineInvoices()).toHaveLength(0);
		expect(
			(await db.table("invoice_outbox").get(out.outbox_id)).status,
		).toBe("acknowledged");
	});
	it.each(["Sales Order", "Quotation"])("keeps failed %s queued rather than acknowledging a fallback draft", async (doctype) => {
		const row = await seed(doctype);
		await retryOfflineInvoice(row.queue_id);
		const call = (globalThis as any).frappe.call;
		call.mockRejectedValue(new Error("Deposit failed"));
		const totals = await syncOfflineInvoices();
		expect(totals?.pending).toBe(1);
		expect(totals?.drafted).toBe(0);
		expect(call).toHaveBeenCalledTimes(1);
		expect(call.mock.calls[0][0].method).toMatch(/submit_invoice$/);
		expect((await db.table("write_queue").get(row.queue_id)).status).toBe(
			"failed",
		);
	});
});
