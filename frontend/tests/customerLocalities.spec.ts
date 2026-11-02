// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { MALTA_CITIES, cityFilter, cityOptions, validCity, customerDefaults } from "../src/posapp/utils/maltaLocalities";
import source from "../src/posapp/components/pos/dialogs/customer/UpdateCustomer.vue?raw";
vi.mock("../src/offline/index", () => ({isOffline: () => true, saveOfflineCustomer: vi.fn()}));
vi.mock("../src/posapp/stores/customersStore", () => ({useCustomersStore: vi.fn(() => ({addOrUpdateCustomer: vi.fn()}))}));
vi.mock("../src/posapp/stores/uiStore", () => ({useUIStore: vi.fn()}));
vi.mock("../src/posapp/stores/toastStore", () => ({useToastStore: vi.fn()}));
import { saveOfflineCustomer } from "../src/offline/index";
import dialog from "../src/posapp/components/pos/dialogs/customer/UpdateCustomer.vue";

describe("Malta customer creation", () => {
 it("includes every official locality and marks all Gozo entries", () => {
  expect(MALTA_CITIES).toHaveLength(85);
  expect(new Set(MALTA_CITIES).size).toBe(85);
  expect(MALTA_CITIES.filter(x => x.startsWith("Gozo – "))).toHaveLength(17);
  for (const name of ["Burmarrad", "Marsalforn", "Xlendi"]) expect(MALTA_CITIES.some(x => x.includes(name))).toBe(true);
 });
 it("finds Maltese names without requiring accents and supports Victoria", () => {
  expect(cityFilter("Gozo – Għajnsielem", "ghajnsielem")).toBe(true);
  expect(cityFilter("Gozo – Ir-Rabat (Għawdex)", "victoria")).toBe(true);
  expect(cityFilter("Iż-Żejtun", "zejtun")).toBe(true);
 });
 it("defaults new Maltese customers while respecting explicit profile defaults", () => {
  expect(customerDefaults({posa_default_country: "Malta"}, {group: "Other", territory: "Other"})).toEqual({country: "Malta", group: "D365 B2C", territory: "Malta"});
  expect(customerDefaults({posa_default_country: "Italy"}, {group: "Trade", territory: "Europe"}).group).toBe("Trade");
  expect(customerDefaults({posa_default_customer_group: "Trade", posa_default_territory: "Gozo"}).group).toBe("Trade");
 });
 it("rejects arbitrary new Maltese cities and preserves an unchanged legacy address", () => {
  expect(validCity("Made up town", "Malta")).toBe(false);
  expect(validCity("Legacy town", "Malta", "Legacy town")).toBe(true);
  expect(cityOptions("Legacy town")[0]).toBe("Legacy town");
  expect(validCity("Rome", "Italy")).toBe(true);
 });
 it("removes the unwanted controls and does not submit their historical values", async () => {
  (globalThis as any).frappe = {throw: (message: string) => {throw new Error(message);}};
  (globalThis as any).__ = (x: string) => x;
  const vm: any = {customer_name: "Local test only", group: "D365 B2C", territory: "Malta", country: "Malta", city: "Gozo – Il-Fontana", originalCity: "", address_line1: "Test street", pos_profile: {company: "Test Company"}, toastStore: {show: vi.fn()}, close_dialog: vi.fn()};
  await (dialog as any).methods.submit_dialog.call(vm);
  const args = vi.mocked(saveOfflineCustomer).mock.calls.at(-1)![0].args;
  expect(args.city).toBe("Gozo – Il-Fontana");
  for (const field of ["gender", "referral_code", "birthday"]) {
   expect(source).not.toContain(`v-model="${field}"`);
   expect(args).not.toHaveProperty(field);
  }
 });
 it("blocks an address without a selected city before saving offline", async () => {
  const vm: any = {customer_name: "Local test only", group: "D365 B2C", territory: "Malta", country: "Malta", city: "", address_line1: "Test street"};
  await expect((dialog as any).methods.submit_dialog.call(vm)).rejects.toThrow("Select a city");
 });
});
