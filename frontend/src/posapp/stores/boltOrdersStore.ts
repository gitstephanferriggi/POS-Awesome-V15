import { computed, ref } from "vue";
import { defineStore } from "pinia";
import api from "../services/api";

export interface BoltLine {
	id: string;
	code: string;
	name: string;
	qty: number;
	rate: number;
	uom: string;
	image: string;
	barcodes: string[];
}
export interface BoltOrder {
	courier?: { partial_name?: string; phone?: string; eta_ts?: string };
	instructions?: string;
	courier_pickup_ts?: number;
	attention_from?: string;
	name: string;
	modified: string;
	order_reference: string;
	bolt_order_id: string;
	workflow_state: string;
	acknowledged_by?: string;
	assigned_to?: string;
	source_amount: number;
	due_at?: string;
	acceptance_deadline?: number;
	operation?: string;
	operation_state?: string;
	operation_error?: string;
	picks: Record<string, number>;
	lines?: BoltLine[];
}
const PREFIX = "webshop.bolt_integration.operations.";
export const useBoltOrdersStore = defineStore("boltOrders", () => {
	const enabled = ref(false),
		orders = ref<BoltOrder[]>([]),
		recent = ref<BoltOrder[]>([]),
		reviewEvents = ref(0),
		error = ref("");
	const reportedStatus = ref("unknown"),
		storeActionState = ref("");
	const storeAction = ref(""), storeActionAt = ref(""), storeStatusAt = ref("");
	const availability = computed(() => {
		if (error.value) return "unknown";
		if (storeActionState.value === "Sending") return "pending";
		if (storeActionState.value === "Review") return "unconfirmed";
		const reported = reportedStatus.value === "active" ? "open" : reportedStatus.value === "inactive" ? "pause" : "unknown";
		if (storeActionState.value === "Confirmed" && ["open", "pause"].includes(storeAction.value)
			&& (reported === "unknown" || (storeActionAt.value && storeStatusAt.value && storeActionAt.value > storeStatusAt.value))) return storeAction.value;
		return reported;
	});
	const statusBanner = computed(() => {
		switch (availability.value) {
			case "open": return { type: "success" as const, title: "Accepting new Bolt orders", text: "The latest confirmed store setting is open." };
			case "pause": return { type: "warning" as const, title: "New Bolt orders paused", text: "Continue preparing orders already received." };
			case "pending": return { type: "info" as const, title: "Updating Bolt store status…", text: "Waiting for Bolt to confirm. Please do not retry." };
			case "unconfirmed": return { type: "warning" as const, title: "Store change not confirmed", text: "Check the store in Bolt before trying again. Ask a manager to review." };
			default: return { type: "info" as const, title: "Bolt store status unavailable", text: "No current confirmed status is available. Refresh or check the store in Bolt." };
		}
	});
	const storeControlsBlocked = computed(() => busy.value || !!error.value || ["pending", "unconfirmed"].includes(availability.value));
	const canReject = ref(false),
		user = ref(""),
		overflow = ref(false),
		busy = ref(false);
	const unacknowledged = computed(() =>
		orders.value.filter((o) => !o.acknowledged_by),
	);
	let timer: ReturnType<typeof setTimeout> | undefined;
	let generation = 0,
		currentProfile = "";
	async function refresh() {
		const profile = currentProfile,
			requestGeneration = generation;
		if (!profile) return;
		try {
			const data = await api.call<{
				enabled: boolean;
				orders: BoltOrder[];
				user?: string;
				can_reject?: boolean;
				overflow?: boolean;
				recent?: BoltOrder[];
				review_events?: number;
				store_status?: string;
				store_action?: string;
				store_action_at?: string;
				store_status_at?: string;
				store_action_state?: string;
			}>(PREFIX + "queue", { profile });
			if (requestGeneration !== generation) return;
			storeAction.value = data.store_action || "";
			storeActionAt.value = data.store_action_at || "";
			storeStatusAt.value = data.store_status_at || "";
			reportedStatus.value = data.store_status || "unknown";
			storeActionState.value = data.store_action_state || "";
			enabled.value = data.enabled;
			orders.value = data.orders;
			recent.value = data.recent || [];
			reviewEvents.value = data.review_events || 0;
			user.value = data.user || "";
			canReject.value = !!data.can_reject;
			overflow.value = !!data.overflow;
			error.value = "";
		} catch (e: any) {
			if (requestGeneration === generation)
				error.value = e.message || "Cannot reach Bolt order service.";
			// Keep known alarms ringing through a connection outage.
		}
	}
	function stop() {
		generation++;
		if (timer) clearTimeout(timer);
		timer = undefined;
	}
	function start(profile: string) {
		stop();
		currentProfile = profile;
		reportedStatus.value = "unknown";
		storeActionState.value = "";
		storeAction.value = storeActionAt.value = storeStatusAt.value = "";
		orders.value = [];
		recent.value = [];
		reviewEvents.value = 0;
		enabled.value = false;
		error.value = "";
		const session = generation;
		async function poll() {
			await refresh();
			if (session === generation)
				timer = setTimeout(poll, enabled.value ? 5000 : 30000);
		}
		if (profile) void poll();
	}
	async function detail(name: string) {
		return api.call<BoltOrder>(PREFIX + "detail", {
			profile: currentProfile,
			name,
		});
	}
	async function act(
		order: BoltOrder,
		action: string,
		extra: Record<string, unknown> = {},
	) {
		if (busy.value)
			throw new Error("Wait for the current action to finish.");
		busy.value = true;
		try {
			const result = await api.call<BoltOrder>(
				PREFIX + "act",
				{
					profile: currentProfile,
					name: order.name,
					version: order.modified,
					action,
					...extra,
				},
				{ timeoutMs: 120000 },
			);
			await refresh();
			return result;
		} finally {
			busy.value = false;
		}
	}
	async function command(method: string, args: Record<string, unknown> = {}) {
		if (busy.value)
			throw new Error("Wait for the current action to finish.");
		busy.value = true;
		try {
			const result = await api.call<any>(
				PREFIX + method,
				{ ...args, profile: currentProfile },
				{ timeoutMs: 120000 },
			);
			await refresh();
			return result;
		} finally {
			busy.value = false;
		}
	}

	return {
		enabled,
		command,
		availability,
		statusBanner,
		storeControlsBlocked,
		reportedStatus,
		storeActionState,
		orders,
		recent,
		reviewEvents,
		error,
		overflow,
		canReject,
		user,
		busy,
		unacknowledged,
		start,
		stop,
		refresh,
		detail,
		act,
	};
});
