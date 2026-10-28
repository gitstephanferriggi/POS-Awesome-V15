import { db, isOffline, memory, persist } from "./db";
import { syncOfflineCustomers } from "./customers";
import { reduceCacheUsage } from "./cache";
import { ensureOfflineInvoiceRequest } from "./idempotency";
import {
	enqueueInvoiceOutboxEntry,
	getInvoiceOutboxMode,
	syncInvoiceOutboxResource,
	shouldWriteInvoiceOutbox,
} from "./invoiceOutbox";
import { updateLocalStock } from "./stock";
import {
	claimRetryableQueueEntries,
	ensureOfflineQueueReady,
	getQueueEntries,
	refreshQueueMemory,
	clearWriteQueueEntries,
	deleteWriteQueueEntryByIndex,
	enqueueWriteQueueEntry,
	getQueuedPayloadCount,
	getQueuedPayloadSnapshots,
	markWriteQueueEntryFailed,
	markWriteQueueEntrySynced,
	type OfflineEntityType,
} from "./writeQueue";

type AnyRecord = Record<string, any>;

const INVOICE_ENTITY: OfflineEntityType = "invoice";

const asBoolean = (value: any): boolean => {
	return (
		value === true ||
		value === 1 ||
		value === "1" ||
		value === "true" ||
		value === "Yes" ||
		value === "yes"
	);
};

let invoiceSyncInProgress = false;

function shouldValidateOfflineInvoiceStock(invoice: AnyRecord) {
	if (!invoice || invoice.is_return) {
		return false;
	}

	const doctype = String(invoice.doctype || "").trim();
	if (["Sales Order", "Quotation", "Purchase Order"].includes(doctype)) {
		return false;
	}

	if (doctype === "Sales Invoice") {
		return asBoolean(invoice.update_stock);
	}

	if (doctype === "POS Invoice") {
		return true;
	}

	return true;
}

export function validateStockForOfflineInvoice(
	items: AnyRecord[],
	invoice: AnyRecord = {},
) {
	const openingStorage = memory.pos_opening_storage || {};
	const stockSettings = openingStorage?.stock_settings || {};
	const posProfile = openingStorage?.pos_profile || {};

	if (!shouldValidateOfflineInvoiceStock(invoice)) {
		return { isValid: true, invalidItems: [], errorMessage: "" };
	}

	const allowOfflineWithoutStockVerification = asBoolean(
		posProfile?.posa_allow_offline_sale_without_stock_verification,
	);
	if (allowOfflineWithoutStockVerification) {
		return { isValid: true, invalidItems: [], errorMessage: "" };
	}

	const blockSaleBeyondAvailableQty = asBoolean(
		posProfile?.posa_block_sale_beyond_available_qty,
	);
	const allowGlobalNegativeStock = asBoolean(
		stockSettings?.allow_negative_stock,
	);

	const stockCache = memory.local_stock_cache || {};
	const invalidItems: AnyRecord[] = [];
	const requestedByItem = new Map<string, AnyRecord>();

	items.forEach((item) => {
		if (!asBoolean(item?.is_stock_item)) {
			return;
		}

		const itemCode = item.item_code;
		if (!itemCode || Number(item.qty || 0) < 0) {
			return;
		}

		const itemAllowsNegativeStock = asBoolean(item?.allow_negative_stock);
		if (
			!blockSaleBeyondAvailableQty &&
			(allowGlobalNegativeStock || itemAllowsNegativeStock)
		) {
			return;
		}

		const requestedQty = Math.abs(
			Number(item.stock_qty ?? item.qty ?? 0) || 0,
		);
		const existing = requestedByItem.get(itemCode);
		if (existing) {
			existing.requested_qty += requestedQty;
			return;
		}

		requestedByItem.set(itemCode, {
			item_code: itemCode,
			item_name: item.item_name || itemCode,
			requested_qty: requestedQty,
		});
	});

	requestedByItem.forEach((item) => {
		const currentStock = Number(
			stockCache[item.item_code]?.actual_qty || 0,
		);

		if (currentStock - item.requested_qty < 0) {
			invalidItems.push({
				item_code: item.item_code,
				item_name: item.item_name,
				requested_qty: item.requested_qty,
				available_qty: currentStock,
			});
		}
	});

	let errorMessage = "";
	if (invalidItems.length === 1) {
		const item = invalidItems[0];
		if (item) {
			errorMessage = `Not enough stock for ${item.item_name}. You need ${item.requested_qty} but only ${item.available_qty} available.`;
		}
	} else if (invalidItems.length > 1) {
		errorMessage =
			"Insufficient stock for multiple items:\n" +
			invalidItems
				.map(
					(item) =>
						`â€¢ ${item.item_name}: Need ${item.requested_qty}, Have ${item.available_qty}`,
				)
				.join("\n");
	}

	return {
		isValid: invalidItems.length === 0,
		invalidItems,
		errorMessage,
	};
}

function prepareOfflineInvoiceEntry(entry: AnyRecord) {
	ensureOfflineInvoiceRequest(entry);

	if (
		!entry.invoice ||
		!Array.isArray(entry.invoice.items) ||
		!entry.invoice.items.length
	) {
		throw new Error("Cart is empty. Add items before saving.");
	}

	const validation = validateStockForOfflineInvoice(
		entry.invoice.items,
		entry.invoice,
	);
	if (!validation.isValid) {
		throw new Error(validation.errorMessage);
	}

	let cleanEntry;
	try {
		cleanEntry = JSON.parse(JSON.stringify(entry));
	} catch (error) {
		console.error("Failed to serialize offline invoice", error);
		throw error;
	}

	const replaySources = Array.isArray(cleanEntry?.data?.customer_credit_dict)
		? cleanEntry.data.customer_credit_dict.filter(
				(row: AnyRecord) => Number(row?.credit_to_redeem || 0) > 0,
			)
		: [];

	if (
		Number(cleanEntry?.data?.redeemed_customer_credit || 0) > 0 &&
		cleanEntry?.invoice?.customer &&
		replaySources.length
	) {
		cleanEntry.data.customer_balance_replay = {
			customer: cleanEntry.invoice.customer,
			redeemed_customer_credit: cleanEntry.data.redeemed_customer_credit,
			sources: replaySources,
			timestamp: Date.now(),
		};
	}

	return cleanEntry;
}

export async function saveOfflineInvoice(entry: AnyRecord) {
	const cleanEntry = prepareOfflineInvoiceEntry(entry);
	if (shouldWriteInvoiceOutbox()) {
		await enqueueInvoiceOutboxEntry(cleanEntry);
	}
	const createdEntry = await enqueueWriteQueueEntry(
		INVOICE_ENTITY,
		cleanEntry,
	);

	if (
		entry.invoice?.items &&
		shouldValidateOfflineInvoiceStock(entry.invoice)
	) {
		updateLocalStock(entry.invoice.items);
	}

	return createdEntry;
}

// Explicit user retry only: keep the original payload and idempotency key.
export async function retryOfflineInvoice(queueId: number) {
	await ensureOfflineQueueReady();
	const snapshot = (await getQueueEntries(INVOICE_ENTITY)).find(
		(row) => row.queue_id === queueId,
	);
	if (!snapshot || !["failed", "dead_letter"].includes(snapshot.status)) {
		throw new Error("Only a failed or stopped invoice can be retried.");
	}
	const outbox = shouldWriteInvoiceOutbox()
		? await enqueueInvoiceOutboxEntry(snapshot.payload)
		: null;
	const queueTable = db.table("write_queue"),
		outboxTable = db.table("invoice_outbox");
	await db.transaction("rw", [queueTable, outboxTable], async () => {
		const row = await queueTable.get(queueId);
		if (
			!row ||
			row.entity_type !== INVOICE_ENTITY ||
			!["failed", "dead_letter"].includes(row.status)
		) {
			throw new Error(
				"This invoice has changed. Reopen Offline Invoices before retrying.",
			);
		}
		if (outbox) {
			const current = await outboxTable.get(outbox.outbox_id!);
			if (current.status === "syncing")
				throw new Error("This invoice is already syncing.");
			if (current.status === "acknowledged") {
				await queueTable.put({ ...row, status: "synced" });
				return;
			}
			await outboxTable.put({
				...current,
				status: "pending",
				retry_count: 0,
				next_retry_at: null,
				nextAttemptAt: null,
				updated_at: new Date().toISOString(),
			});
		}
		await queueTable.put({
			...row,
			status: "pending",
			retry_count: 0,
			last_attempt_at: null,
			next_attempt_at: null,
		});
	});
	await refreshQueueMemory(INVOICE_ENTITY);
}

export function getOfflineInvoices() {
	return getQueuedPayloadSnapshots(INVOICE_ENTITY);
}

export async function clearOfflineInvoices() {
	await clearWriteQueueEntries(INVOICE_ENTITY);
}

export async function deleteOfflineInvoice(index: number) {
	await deleteWriteQueueEntryByIndex(INVOICE_ENTITY, index);
}

export function getPendingOfflineInvoiceCount() {
	return getQueuedPayloadCount(INVOICE_ENTITY);
}

export function resetOfflineState() {
	memory.offline_invoices = [];
	memory.offline_customers = [];
	memory.offline_payments = [];
	memory.pos_last_sync_totals = { pending: 0, synced: 0, drafted: 0 };
	persist("pos_last_sync_totals");
}

export function setLastSyncTotals(totals: {
	pending: number;
	synced: number;
	drafted: number;
}) {
	memory.pos_last_sync_totals = totals;
	persist("pos_last_sync_totals");
}

export function getLastSyncTotals() {
	return memory.pos_last_sync_totals || { pending: 0, synced: 0, drafted: 0 };
}

export async function syncOfflineInvoices() {
	if (getInvoiceOutboxMode() === "coordinator") {
		const result = await syncInvoiceOutboxResource(
			async (method, args = {}) => {
				const response = await frappe.call({ method, args });
				return typeof response?.message === "undefined"
					? response || {}
					: response.message;
			},
		);
		const totals = {
			pending: Number((result as AnyRecord).pendingCount || 0),
			synced: Number((result as AnyRecord).acknowledged || 0),
			drafted: 0,
		};
		setLastSyncTotals(totals);
		return totals;
	}

	if (invoiceSyncInProgress) {
		return {
			pending: getPendingOfflineInvoiceCount(),
			synced: 0,
			drafted: 0,
		};
	}

	invoiceSyncInProgress = true;
	try {
		await syncOfflineCustomers();

		const invoices = getOfflineInvoices();
		if (!invoices.length) {
			const totals = { pending: 0, synced: 0, drafted: 0 };
			setLastSyncTotals(totals);
			return totals;
		}

		if (isOffline()) {
			return { pending: invoices.length, synced: 0, drafted: 0 };
		}

		const claimedEntries = await claimRetryableQueueEntries(INVOICE_ENTITY);
		if (!claimedEntries.length) {
			return {
				pending: getPendingOfflineInvoiceCount(),
				synced: 0,
				drafted: 0,
			};
		}

		let synced = 0;
		let drafted = 0;

		for (const entry of claimedEntries) {
			const queuedInvoice = entry.payload;
			try {
				await frappe.call({
					method: "posawesome.posawesome.api.invoices.submit_invoice",
					args: {
						invoice: queuedInvoice.invoice,
						data: queuedInvoice.data,
					},
				});
				synced += 1;
				await markWriteQueueEntrySynced(
					INVOICE_ENTITY,
					Number(entry.queue_id),
					entry.last_attempt_at,
				);
			} catch (error) {
				if (queuedInvoice.invoice?.doctype === "Sales Order") {
					await markWriteQueueEntryFailed(
						INVOICE_ENTITY,
						Number(entry.queue_id),
						error,
						entry.last_attempt_at,
					);
					continue;
				}
				console.error(
					"Failed to submit invoice, saving as draft",
					error,
				);
				try {
					await frappe.call({
						method: "posawesome.posawesome.api.invoices.update_invoice",
						args: { data: queuedInvoice.invoice },
					});
					drafted += 1;
					await markWriteQueueEntrySynced(
						INVOICE_ENTITY,
						Number(entry.queue_id),
						entry.last_attempt_at,
					);
				} catch (draftError) {
					console.error(
						"Failed to save invoice as draft",
						draftError,
					);
					await markWriteQueueEntryFailed(
						INVOICE_ENTITY,
						Number(entry.queue_id),
						draftError,
						entry.last_attempt_at,
					);
				}
			}
		}

		if (
			synced > 0 &&
			drafted === 0 &&
			getPendingOfflineInvoiceCount() === 0
		) {
			reduceCacheUsage();
		}

		const totals = {
			pending: getPendingOfflineInvoiceCount(),
			synced,
			drafted,
		};

		if (totals.pending || drafted) {
			setLastSyncTotals(totals);
		} else {
			setLastSyncTotals({ pending: 0, synced: 0, drafted: 0 });
		}

		return totals;
	} finally {
		invoiceSyncInProgress = false;
	}
}
