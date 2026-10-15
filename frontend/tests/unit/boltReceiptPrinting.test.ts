// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
 ui: { lastInvoiceId: "OLD", posProfile: { create_pos_invoice_instead_of_sales_invoice: 0, print_format: "Shop Receipt", letter_head: "Shop Logo" } },
 silent: vi.fn(), qz: vi.fn(), useQz: vi.fn(() => false), watch: vi.fn(),
}));
vi.mock("../../src/posapp/stores/uiStore", () => ({ useUIStore: () => mocks.ui }));
vi.mock("../../src/posapp/plugins/print", () => ({ appendDebugPrintParam: (url:string) => url, isDebugPrintEnabled: () => false, silentPrint: mocks.silent, watchPrintWindow: mocks.watch }));
vi.mock("../../src/posapp/services/documentPrint", () => ({ confirmDocumentPrintFallback: () => true, printDocumentViaConfiguredQz: mocks.qz, shouldUseConfiguredQzDocumentPrinting: mocks.useQz, shouldUseRawDocumentPrinting: () => false }));
import { useLastInvoicePrinting } from "../../src/posapp/composables/core/useLastInvoicePrinting";
beforeEach(() => { vi.clearAllMocks(); mocks.useQz.mockReturnValue(false); vi.stubGlobal("frappe", { urllib: { get_base_url: () => "https://uat.test" } }); vi.spyOn(window,"open").mockReturnValue(null); });
describe("Bolt uses the shared final-invoice receipt printer", () => {
 it("prints the explicit POS invoice, not an older till sale, even if popups are blocked", async () => {
  await useLastInvoicePrinting().printInvoice("BOLT-1", "POS Invoice");
  const url = new URL(mocks.silent.mock.calls[0][0]);
  expect(url.searchParams.get("name")).toBe("BOLT-1");
  expect(url.searchParams.get("doctype")).toBe("POS Invoice");
  expect(url.searchParams.get("format")).toBe("Shop Receipt");
  expect(url.searchParams.get("letterhead")).toBe("Shop Logo");
 });
 it("uses configured QZ printing with the submitted invoice reference", async () => {
  mocks.useQz.mockReturnValue(true);
  await useLastInvoicePrinting().printInvoice("BOLT-2", "POS Invoice");
  expect(mocks.qz).toHaveBeenCalledWith(expect.objectContaining({ name:"BOLT-2", doctype:"POS Invoice", printFormat:"Shop Receipt" }));
  expect(mocks.silent).not.toHaveBeenCalled();
 });
 it("preserves normal Print Last Invoice behavior", async () => {
  await useLastInvoicePrinting().printLastInvoice();
  expect(new URL(mocks.silent.mock.calls[0][0]).searchParams.get("name")).toBe("OLD");
 });
});
