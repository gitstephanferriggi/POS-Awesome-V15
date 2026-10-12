import { describe, expect, it, vi } from "vitest";
import { useClosingShift } from "../src/posapp/composables/pos/closing/useClosingShift";
function dialog(submit?: (data: any) => Promise<unknown>) {
 const state = useClosingShift(undefined, submit);
 state.closingDialog.value = true;
 state.dialog_data.value = { payment_reconciliation: [{ closing_amount: 10 }] };
 return state;
}
describe("global shift closing submission", () => {
 it("submits without a selling-screen listener and waits for confirmation", async () => {
  let resolve!: (result: string) => void;
  const submit = vi.fn(() => new Promise<string>(r => { resolve = r; }));
  const state = dialog(submit), pending = state.submitDialog();
  expect(state.closingDialog.value).toBe(true);
  expect(state.submitting.value).toBe(true);
  await state.submitDialog();
  expect(submit).toHaveBeenCalledTimes(1);
  state.closeDialog();expect(state.closingDialog.value).toBe(true);
  resolve("CLOSING-1");await pending;
  expect(state.closingDialog.value).toBe(false);
  expect(state.submitting.value).toBe(false);
 });
 it.each([undefined, () => Promise.reject(new Error("network")), () => Promise.resolve(null)])("keeps amounts and shows an error when confirmation fails", async submit => {
  const state = dialog(submit);
  expect(await state.submitDialog()).toBe(false);
  expect(state.closingDialog.value).toBe(true);
  expect(state.dialog_data.value.payment_reconciliation[0].closing_amount).toBe(10);
  expect(state.submissionError.value).not.toBe("");
  expect(state.submitting.value).toBe(false);
 });
 it("keeps the dialog open and identifies an item with no valuation", async () => {
  const state=dialog(() => Promise.reject({responseJSON:{_server_messages:JSON.stringify([JSON.stringify({message:'Valuation Rate for the Item <a>ITEM-42</a>, is required to do accounting entries.'})])}}));
  await state.submitDialog();
  expect(state.closingDialog.value).toBe(true);
  expect(state.submissionError.value).toContain('ITEM-42');
  expect(state.dialog_data.value.payment_reconciliation[0].closing_amount).toBe(10);
 });
 it.each(["", null, undefined, "abc", "10x", Infinity])("reports invalid amounts", async amount => {
  const submit = vi.fn(), state = dialog(submit);
  state.dialog_data.value.payment_reconciliation[0].closing_amount = amount;
  expect(await state.submitDialog()).toBe(false);
  expect(submit).not.toHaveBeenCalled();
  expect(state.submissionError.value).not.toBe("");
 });
});
