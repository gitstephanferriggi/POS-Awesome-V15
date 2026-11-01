import { afterEach, describe, expect, it, vi } from "vitest";
import { effectScope, ref } from "vue";
import { useOfflineWarningDelay } from "../src/posapp/composables/core/useOfflineWarningDelay";
describe("offline warning grace period", () => {
 afterEach(() => vi.useRealTimers());
 it("waits the full 30 seconds and resets on each reconnect", () => {
  vi.useFakeTimers();
  const online = ref(true), scope = effectScope();
  const visible = scope.run(() => useOfflineWarningDelay(online))!;
  online.value = false;
  vi.advanceTimersByTime(29_999); expect(visible.value).toBe(false);
  vi.advanceTimersByTime(1); expect(visible.value).toBe(true);
  online.value = true; expect(visible.value).toBe(false);
  online.value = false; vi.advanceTimersByTime(20_000);
  online.value = true; online.value = false;
  vi.advanceTimersByTime(29_999); expect(visible.value).toBe(false);
  vi.advanceTimersByTime(1); expect(visible.value).toBe(true);
  scope.stop(); expect(vi.getTimerCount()).toBe(0);
 });
 it("handles starting offline and cancels a pending timer on disposal", () => {
  vi.useFakeTimers();
  const scope = effectScope();
  const visible = scope.run(() => useOfflineWarningDelay(ref(false)))!;
  vi.advanceTimersByTime(29_999); expect(visible.value).toBe(false);
  scope.stop(); expect(vi.getTimerCount()).toBe(0);
  vi.advanceTimersByTime(1); expect(visible.value).toBe(false);
 });
});
