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
				store_action_state?: string;
			}>(PREFIX + "queue", { profile });
			if (requestGeneration !== generation) return;
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
