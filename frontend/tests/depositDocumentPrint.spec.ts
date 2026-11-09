import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/posapp/services/qzTray", () => ({ printDocumentViaQz: vi.fn() }));
vi.mock("../src/posapp/services/rawDocumentPrint", () => ({
  printRawDocumentViaQz: vi.fn(),
  shouldUseRawDocumentPrinting: (profile: any) => profile?.posa_raw_printing === 1,
}));

import { printDocumentViaConfiguredQz } from "../src/posapp/services/documentPrint";
import { printDocumentViaQz } from "../src/posapp/services/qzTray";
import { printRawDocumentViaQz } from "../src/posapp/services/rawDocumentPrint";

describe("linked deposit document printing", () => {
  beforeEach(() => vi.resetAllMocks());

  const pair = { doctype: "JYSK Sales Deposit", name: "DEPOSIT-ONE", printFormat: "JYSK Deposit Document Pair",
    profile: { posa_raw_printing: 1 }, printerName: "Receipt printer" };

  it("sends the two saved formats in order as separately cut jobs, including on raw-configured profiles", async () => {
    await printDocumentViaConfiguredQz(pair);
    expect(printRawDocumentViaQz).not.toHaveBeenCalled();
    expect(vi.mocked(printDocumentViaQz).mock.calls.map(([value]) => [value.name, value.printFormat])).toEqual([
      ["DEPOSIT-ONE", "JYSK Order Acknowledgement"], ["DEPOSIT-ONE", "JYSK Deposit Receipt"],
    ]);
  });

  it("identifies a partial printing failure without automatically reprinting the first document", async () => {
    vi.mocked(printDocumentViaQz).mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("Offline"));
    await expect(printDocumentViaConfiguredQz(pair)).rejects.toThrow("Deposit Receipt only");
    expect(printDocumentViaQz).toHaveBeenCalledTimes(2);
  });

  it("uses the saved formatted VAT credit for a deposit refund", async () => {
    await printDocumentViaConfiguredQz({ ...pair, printFormat: "JYSK Deposit Refund Credit" });
    expect(printDocumentViaQz).toHaveBeenCalledOnce();
    expect(printRawDocumentViaQz).not.toHaveBeenCalled();
  });

  it("preserves raw printing for ordinary invoices", async () => {
    await printDocumentViaConfiguredQz({ ...pair, doctype: "Sales Invoice", printFormat: "Invoice" });
    expect(printRawDocumentViaQz).toHaveBeenCalledOnce();
    expect(printDocumentViaQz).not.toHaveBeenCalled();
  });
});
