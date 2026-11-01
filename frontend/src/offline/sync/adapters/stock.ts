import {
	clearLocalStockCache,
	removeLocalStockEntries,
	setStockCacheReady,
	updateLocalStockCache,
} from "../../stock";
import { getSyncResourceState } from "../syncState";
import {
	buildResourceSyncResult,
	buildScopeSignature,
	persistResourceSyncState,
	refreshSnapshotFromSync,
	type ResourceSyncResult,
	type SyncResponse,
	type SyncScopedProfile,
} from "./common";

type StockFetcher = (args: {
	posProfile: SyncScopedProfile;
	watermark?: string | null;
	startAfter?: string | null;
	limit?: number;
	schemaVersion?: string | null;
}) => Promise<SyncResponse>;

type StockSyncArgs = {
	posProfile: SyncScopedProfile;
	watermark?: string | null;
	schemaVersion?: string | null;
	fetcher: StockFetcher;
};

function extractChangedStockRows(response: SyncResponse) {
	return (response?.changes || [])
		.map((entry) => entry?.data)
		.filter((row): row is Record<string, any> => !!row?.item_code);
}

function extractDeletedStockCodes(response: SyncResponse) {
	return (response?.deleted || [])
		.map((entry) => {
			const key = String(entry?.key || "");
			return key.startsWith("stock::") ? key.slice("stock::".length) : "";
		})
		.filter(Boolean);
}

async function hasStockScopeChanged(posProfile: SyncScopedProfile) {
	const nextScopeSignature = buildScopeSignature(posProfile);
	const currentState = await getSyncResourceState("stock");
	return !!(
		currentState?.scopeSignature &&
		currentState.scopeSignature !== nextScopeSignature
	);
}

export async function syncStockResource(
	args: StockSyncArgs,
): Promise<ResourceSyncResult> {
	const scopeChanged = await hasStockScopeChanged(args.posProfile);
	let effectiveWatermark = scopeChanged ? null : args.watermark;
	if (scopeChanged) setStockCacheReady(false);
	const fetchPages = async (schemaVersion?: string | null, reset = false) => {
		let startAfter: string | null = null;
		let latestWatermark = effectiveWatermark || null;
		let firstPage = true;
		while (true) {
			const response = await args.fetcher({
				posProfile: args.posProfile,
				watermark: effectiveWatermark,
				startAfter,
				limit: 1000,
				schemaVersion,
			});
			if (response?.full_resync_required) return response;
			if (firstPage && (scopeChanged || reset)) clearLocalStockCache();
			firstPage = false;
			const changedRows = extractChangedStockRows(response);
			if (changedRows.length) updateLocalStockCache(changedRows);
			const deletedCodes = extractDeletedStockCodes(response);
			if (deletedCodes.length) removeLocalStockEntries(deletedCodes);
			if (response.next_watermark && (!latestWatermark || response.next_watermark > latestWatermark)) {
				latestWatermark = response.next_watermark;
			}
			if (!response.has_more) return { ...response, next_watermark: latestWatermark };
			const nextCursor = String(changedRows.at(-1)?.item_code || "");
			if (!nextCursor || nextCursor === startAfter) {
				throw new Error("Stock sync pagination cursor did not advance");
			}
			startAfter = nextCursor;
		}
	};
	let response: SyncResponse;
	try {
		response = await fetchPages(args.schemaVersion);
		if (response?.full_resync_required) {
			setStockCacheReady(false);
			effectiveWatermark = null;
			response = await fetchPages(null, true);
		}
	} catch (error) {
		// Never declare a partially downloaded stock snapshot safe or advance its
		// watermark. The next attempt must still cover the unconfirmed pages.
		setStockCacheReady(false);
		throw error;
	}

	if (response?.full_resync_required) {
		setStockCacheReady(false);
		await persistResourceSyncState({
			resourceId: "stock",
			status: "limited",
			posProfile: args.posProfile,
			response,
			watermark: effectiveWatermark,
		});
		return buildResourceSyncResult(
			"stock",
			"limited",
			response,
			effectiveWatermark,
		);
	}

	setStockCacheReady(true);
	refreshSnapshotFromSync({
		posProfile: args.posProfile,
		cacheState: {
			stockCacheReady: true,
		},
	});

	await persistResourceSyncState({
		resourceId: "stock",
		status: "fresh",
		posProfile: args.posProfile,
		response,
		watermark: effectiveWatermark,
	});
	return buildResourceSyncResult(
		"stock",
		"fresh",
		response,
		effectiveWatermark,
	);
}
