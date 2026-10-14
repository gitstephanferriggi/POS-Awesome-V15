import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import api from "../../src/posapp/services/api";
import { useBoltOrdersStore } from "../../src/posapp/stores/boltOrdersStore";
vi.mock("../../src/posapp/services/api", () => ({
	default: { call: vi.fn() },
}));
const order = {
	name: "one",
	modified: "v1",
	workflow_state: "New",
	order_reference: "42",
	source_amount: 5,
	picks: {},
};
const flush = async () => {
	await Promise.resolve();
	await Promise.resolve();
	await Promise.resolve();
};
beforeEach(() => {
	setActivePinia(createPinia());
	vi.useFakeTimers();
	vi.mocked(api.call).mockReset();
});
afterEach(() => {
	vi.useRealTimers();
});
describe("Bolt shared queue", () => {
	it("preserves unacknowledged alarms during a connection failure", async () => {
		vi.mocked(api.call)
			.mockResolvedValueOnce({ enabled: true, orders: [order] })
			.mockRejectedValueOnce(new Error("Offline"));
		const store = useBoltOrdersStore();
		store.start("Bolt");
		await flush();
		expect(store.unacknowledged).toHaveLength(1);
		await store.refresh();
		expect(store.unacknowledged).toHaveLength(1);
		expect(store.error).toBe("Offline");
		store.stop();
	});
	it("stops the alarm after another terminal acknowledges", async () => {
		vi.mocked(api.call)
			.mockResolvedValueOnce({ enabled: true, orders: [order] })
			.mockResolvedValueOnce({
				enabled: true,
				orders: [{ ...order, acknowledged_by: "other" }],
			});
		const store = useBoltOrdersStore();
		store.start("Bolt");
		await flush();
		await store.refresh();
		expect(store.unacknowledged).toHaveLength(0);
		store.stop();
	});
	it("discards an old profile response after switching profiles", async () => {
		let resolve!: (value: unknown) => void;
		vi.mocked(api.call)
			.mockImplementationOnce(
				() =>
					new Promise((r) => {
						resolve = r;
					}),
			)
			.mockResolvedValueOnce({ enabled: false, orders: [] });
		const store = useBoltOrdersStore();
		store.start("Old");
		store.start("New");
		await flush();
		resolve({ enabled: true, orders: [order] });
		await flush();
		expect(store.enabled).toBe(false);
		expect(store.orders).toEqual([]);
		store.stop();
	});
	it("does not repeatedly dispatch an action while one is pending", async () => {
		vi.mocked(api.call).mockResolvedValueOnce({
			enabled: true,
			orders: [order],
		});
		const store = useBoltOrdersStore();
		store.start("Bolt");
		await flush();
		let resolve!: (value: unknown) => void;
		vi.mocked(api.call)
			.mockImplementationOnce(
				() =>
					new Promise((r) => {
						resolve = r;
					}),
			)
			.mockResolvedValueOnce({ enabled: true, orders: [] });
		const pending = store.act(order as any, "accept");
		await expect(store.act(order as any, "accept")).rejects.toThrow("Wait");
		resolve(order);
		await pending;
		expect(store.busy).toBe(false);
		store.stop();
	});
});

describe("Bolt store availability", () => {
 it.each([
  [{ store_action: "open", store_action_state: "Confirmed" }, "open"],
  [{ store_action: "pause", store_action_state: "Confirmed" }, "pause"],
  [{ store_status: "active", store_action_state: "Sending" }, "pending"],
  [{ store_status: "active", store_action_state: "Review" }, "unconfirmed"],
  [{ store_status: "inactive", store_action: "open", store_action_state: "Confirmed", store_action_at: "2026-10-14 12:00:00", store_status_at: "2026-10-14 11:00:00" }, "open"],
  [{ store_status: "inactive", store_action: "open", store_action_state: "Confirmed", store_action_at: "2026-10-14 11:00:00", store_status_at: "2026-10-14 12:00:00" }, "pause"],
  [{}, "unknown"],
 ])("resolves confirmed and pending state %j", async (fields, expected) => {
  vi.mocked(api.call).mockResolvedValue({enabled:true, orders:[], ...fields});
  const store=useBoltOrdersStore();store.start("Bolt");await flush();
  expect(store.availability).toBe(expected);
  expect(store.storeControlsBlocked).toBe(["pending","unconfirmed"].includes(expected));
  store.stop();
 });
 it("does not show a stale green banner after a connection failure", async () => {
  vi.mocked(api.call).mockResolvedValueOnce({enabled:true, orders:[], store_status:"active"}).mockRejectedValueOnce(new Error("Offline"));
  const store=useBoltOrdersStore();store.start("Bolt");await flush();await store.refresh();
  expect(store.availability).toBe("unknown");expect(store.storeControlsBlocked).toBe(true);store.stop();
 });
});
