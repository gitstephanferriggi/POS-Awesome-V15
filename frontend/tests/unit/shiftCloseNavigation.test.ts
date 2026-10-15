// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { defineComponent } from "vue";
const m = vi.hoisted(() => ({
 ui: { posOpeningShift: null as any }, clear: vi.fn(), storage: vi.fn(), toast: vi.fn(),
 router: { currentRoute: { value: { path: "/bolt-orders" } }, replace: vi.fn().mockResolvedValue(undefined) },
}));
vi.mock("vue-router", () => ({ useRouter: () => m.router }));
vi.mock("../../src/posapp/stores/uiStore.js", () => ({ useUIStore: () => m.ui }));
vi.mock("../../src/posapp/stores/toastStore.js", () => ({ useToastStore: () => ({ show: m.toast }) }));
vi.mock("../../src/posapp/stores/invoiceStore", () => ({ useInvoiceStore: () => ({ clear: m.clear }) }));
vi.mock("../../src/offline/index", () => ({ initPromise: Promise.resolve(), checkDbHealth: vi.fn(), getOpeningStorage: vi.fn(), setOpeningStorage: vi.fn(), clearOpeningStorage: m.storage, setTaxTemplate:vi.fn(), isOffline:vi.fn(), getBootstrapSnapshot:vi.fn(), setBootstrapSnapshot:vi.fn() }));
import { usePosShift } from "../../src/posapp/composables/pos/shared/usePosShift";
let shift: ReturnType<typeof usePosShift>;
beforeEach(() => { vi.clearAllMocks(); m.ui.posOpeningShift={ name:"SHIFT-1" }; });
function setup() { return mount(defineComponent({ setup() { shift=usePosShift(); return {}; }, template:"<div />" }), { global:{ provide:{eventBus:{emit:vi.fn()}} } }); }
describe("global shift closing", () => {
 it("returns from Bolt to POS only after confirmed closing", async () => {
  vi.stubGlobal("frappe", { call:vi.fn().mockResolvedValue({message:{name:"CLOSE-1"}}) });
  const wrapper=setup(); await shift.submit_closing_pos({});
  expect(m.ui.posOpeningShift).toBeNull(); expect(m.storage).toHaveBeenCalled();
  expect(m.clear).toHaveBeenCalled(); expect(m.router.replace).toHaveBeenCalledWith("/pos"); wrapper.unmount();
 });
 it("keeps the shift and route intact when closing fails", async () => {
  vi.stubGlobal("frappe", { call:vi.fn().mockRejectedValue(new Error("Cannot close")) });
  const wrapper=setup(); await expect(shift.submit_closing_pos({})).rejects.toThrow("Cannot close");
  expect(m.ui.posOpeningShift?.name).toBe("SHIFT-1"); expect(m.router.replace).not.toHaveBeenCalled(); expect(m.storage).not.toHaveBeenCalled(); wrapper.unmount();
 });
});
