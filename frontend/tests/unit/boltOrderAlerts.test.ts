// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { nextTick, h } from "vue";
import BoltOrderAlerts from "../../src/posapp/components/bolt/BoltOrderAlerts.vue";
import { useBoltOrdersStore } from "../../src/posapp/stores/boltOrdersStore";
import api from "../../src/posapp/services/api";
vi.mock("../../src/posapp/services/api", () => ({
	default: { call: vi.fn() },
}));
vi.mock("../../src/posapp/stores/uiStore", () => ({
	useUIStore: () => ({ posProfile: { name: "Bolt" } }),
}));
const beep = vi.fn();
class FakeAudio {
	state = "running";
	currentTime = 0;
	destination = {};
	resume = vi.fn().mockResolvedValue(undefined);
	close = vi.fn().mockResolvedValue(undefined);
	createOscillator() {
		return {
			type: "",
			frequency: { value: 0 },
			connect: vi.fn(),
			start: beep,
			stop: vi.fn(),
			disconnect: vi.fn(),
			onended: null,
		};
	}
	createGain() {
		return {
			gain: {
				setValueAtTime: vi.fn(),
				exponentialRampToValueAtTime: vi.fn(),
			},
			connect: vi.fn(),
			disconnect: vi.fn(),
		};
	}
}
const flush = async () => {
	await Promise.resolve();
	await Promise.resolve();
	await nextTick();
};
beforeEach(() => {
	vi.useFakeTimers();
	setActivePinia(createPinia());
	vi.stubGlobal("AudioContext", FakeAudio);
	beep.mockClear();
	vi.mocked(api.call).mockReset();
});
afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});
it("requires a gesture, repeats and stops after shared acknowledgement", async () => {
	vi.mocked(api.call).mockResolvedValue({
		enabled: true,
		orders: [{ name: "1", workflow_state: "New", picks: {} }],
	});
	const wrapper = mount(BoltOrderAlerts, {
		global: {
			components: {
				VBtn: {
					emits: ["click"],
					setup(_props: unknown, { slots, emit }: any) {
						return () =>
							h(
								"button",
								{ onClick: () => emit("click") },
								slots.default?.(),
							);
					},
				},
				RouterLink: {
					setup(_props: unknown, { slots }: any) {
						return () => h("a", slots.default?.());
					},
				},
			},
		},
	});
	await flush();
	expect(beep).not.toHaveBeenCalled();
	expect(wrapper.text()).toContain("Enable order alarm");
	await wrapper.find("button").trigger("click");
	await flush();
	const initial = beep.mock.calls.length;
	await vi.advanceTimersByTimeAsync(1900);
	expect(beep.mock.calls.length).toBeGreaterThan(initial);
	vi.mocked(api.call).mockResolvedValue({
		enabled: true,
		orders: [{ name: "1", acknowledged_by: "other", picks: {} }],
	});
	await useBoltOrdersStore().refresh();
	await nextTick();
	const stopped = beep.mock.calls.length;
	await vi.advanceTimersByTimeAsync(1900);
	expect(beep.mock.calls.length).toBe(stopped);
	wrapper.unmount();
});
