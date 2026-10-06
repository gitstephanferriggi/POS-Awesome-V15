import { describe, it, expect } from "vitest";
import { useItemMerging } from "../src/posapp/composables/pos/items/addition/useItemMerging";
describe("fulfilment sources", () => {
 it("does not merge the same item from different warehouses", () => {
  const {groupAndAddItem}=useItemMerging();
  const items=[{item_code:"A",uom:"Nos",rate:10,qty:1,warehouse:"Lija"}];
  groupAndAddItem(items,{item_code:"A",uom:"Nos",rate:10,qty:2,warehouse:"Zebbug"},{});
  expect(items).toHaveLength(2);expect(items.map(i=>i.qty).sort()).toEqual([1,2]);
 });
 it("merges matching source lines", () => {
  const {groupAndAddItem}=useItemMerging();
  const items=[{item_code:"A",uom:"Nos",rate:10,qty:1,warehouse:"Zebbug"}];
  groupAndAddItem(items,{item_code:"A",uom:"Nos",rate:10,qty:2,warehouse:"Zebbug"},{});
  expect(items).toHaveLength(1);expect(items[0].qty).toBe(3);
 });
});
