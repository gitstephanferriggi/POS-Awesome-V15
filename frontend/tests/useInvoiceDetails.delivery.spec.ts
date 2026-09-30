import { afterEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";
vi.mock("../src/offline/index", () => ({}));
import { useInvoiceDetails } from "../src/posapp/composables/pos/invoice/useInvoiceDetails";

describe("Sales Order delivery picker", () => {
 afterEach(() => vi.unstubAllGlobals());
 it("keeps 05-10-2026 as October 5 even when Frappe would interpret it as May 10", () => {
  const converter = vi.fn(() => "2026-05-10T00:00:00+02:00");
  vi.stubGlobal("frappe", {datetime: {obj_to_str: converter}});
  const doc = ref<any>({doctype: "Sales Order", delivery_date: "2026-09-30", items: [{delivery_date: "2026-09-30"}]});
  const details = useInvoiceDetails({invoiceDoc: doc, posProfile: ref({}), invoiceType: ref("Order")});
  details.new_delivery_date.value = "05-10-2026";
  details.update_delivery_date();
  expect(doc.value.delivery_date).toBe("2026-10-05");
  expect(doc.value.posa_delivery_date).toBe("2026-10-05");
  expect(doc.value.items[0].delivery_date).toBe("2026-10-05");
  expect(details.formatDateDisplay("05-10-2026")).toBe("2026-10-05");
  expect(details.formatDate("31-02-2026")).toBeNull();
  expect(converter).not.toHaveBeenCalled();
 });
 it("updates inherited dates, preserves separate schedules and supports a second edit", () => {
  const doc = ref<any>({doctype: "Sales Order", delivery_date: "2026-09-29", items: [
   {delivery_date: "2026-09-29"}, {delivery_date: "2026-10-08"}, {}
  ]});
  const details = useInvoiceDetails({invoiceDoc: doc, posProfile: ref({}), invoiceType: ref("Order")});
  for (const date of ["2026-10-05", "2026-10-06"]) {
   details.new_delivery_date.value = date;
   details.update_delivery_date();
   expect(doc.value.delivery_date).toBe(date);
   expect(doc.value.posa_delivery_date).toBe(date);
   expect(doc.value.items.map((x:any) => x.delivery_date)).toEqual([date, "2026-10-08", date]);
  }
 });
 it("leaves invoice item scheduling unchanged", () => {
  const doc = ref<any>({doctype: "POS Invoice", items: [{delivery_date: "2026-10-08"}]});
  const details = useInvoiceDetails({invoiceDoc: doc, posProfile: ref({}), invoiceType: ref("Invoice")});
  details.new_delivery_date.value = "2026-10-05";
  details.update_delivery_date();
  expect(doc.value.posa_delivery_date).toBe("2026-10-05");
  expect(doc.value.items[0].delivery_date).toBe("2026-10-08");
 });
});
