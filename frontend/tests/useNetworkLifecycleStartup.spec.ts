// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import { flushPromises } from "@vue/test-utils";
import { useNetworkLifecycle } from "../src/posapp/composables/runtime/useNetworkLifecycle";

function setup(manual = false, reachable = true) {
	const options = {
		networkOnline: ref(true),
		serverOnline: ref(false),
		serverConnecting: ref(false),
		internetReachable: ref(false),
		isManualOffline: () => manual,
		realtime: { on: vi.fn(), off: vi.fn() },
		checkNetworkConnectivity: vi.fn(async () => {
			options.serverOnline.value = reachable;
		}),
		onSyncInvoices: vi.fn(),
		onEvaluateBootstrap: vi.fn(),
	};
	return { options, lifecycle: useNetworkLifecycle(options) };
}

describe("POS initial connectivity", () => {
	it("checks an already-connected Desk session without waiting for a realtime event", async () => {
		const { options, lifecycle } = setup();
		lifecycle.start();
		expect(options.serverConnecting.value).toBe(true);
		await flushPromises();
		expect(options.checkNetworkConnectivity).toHaveBeenCalledWith({
			forceImmediate: true,
		});
		expect(options.serverOnline.value).toBe(true);
		expect(options.serverConnecting.value).toBe(false);
		expect(options.onEvaluateBootstrap).toHaveBeenCalled();
		lifecycle.start();
		expect(options.checkNetworkConnectivity).toHaveBeenCalledTimes(1);
		lifecycle.stop();
	});
	it("retains the offline state when the server is unreachable", async () => {
		const { options, lifecycle } = setup(false, false);
		lifecycle.start();
		await flushPromises();
		expect(options.serverOnline.value).toBe(false);
		expect(options.serverConnecting.value).toBe(false);
		lifecycle.stop();
	});
	it("does not override deliberate manual offline mode", async () => {
		const { options, lifecycle } = setup(true);
		lifecycle.start();
		await flushPromises();
		expect(options.checkNetworkConnectivity).not.toHaveBeenCalled();
		expect(options.serverOnline.value).toBe(false);
		lifecycle.stop();
	});
});
