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
	suspend = vi.fn().mockResolvedValue(undefined);
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
it.each([false, true])("defaults on, mutes and acknowledges (browser blocked: %s)", async (blocked) => {
    let allowSound = !blocked;
    vi.stubGlobal("AudioContext", class extends FakeAudio {
        state = blocked ? "suspended" : "running";
        resume = vi.fn(async () => { if (allowSound) this.state = "running"; });
    });
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
    await vi.advanceTimersByTimeAsync(0);
    if (blocked) {
        expect(beep).not.toHaveBeenCalled();
        expect(wrapper.text()).toContain("click anywhere in POS");
        allowSound = true;
        document.dispatchEvent(new KeyboardEvent("keydown", {key:"Enter"}));
        await flush();
        await vi.advanceTimersByTimeAsync(0);
    }
	expect(beep).toHaveBeenCalled();
    expect(wrapper.text()).toContain("Mute alarm");
    await wrapper.find("[data-alarm-toggle]").trigger("click");
    await flush();
    const muted = beep.mock.calls.length;
    await vi.advanceTimersByTimeAsync(1900);
    expect(beep.mock.calls.length).toBe(muted);
    expect(wrapper.text()).toContain("Alarm muted");
    await wrapper.find("[data-alarm-toggle]").trigger("click");
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
