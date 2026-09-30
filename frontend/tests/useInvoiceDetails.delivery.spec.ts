import { describe, expect, it, vi } from "vitest";
import { ref } from "vue";
vi.mock("../src/offline/index", () => ({}));
import { useInvoiceDetails } from "../src/posapp/composables/pos/invoice/useInvoiceDetails";

describe("Sales Order delivery picker", () => {
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
