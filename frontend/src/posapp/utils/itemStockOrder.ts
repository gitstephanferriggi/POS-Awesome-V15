/** Keep display ordering numeric and independent of descriptions. */
export function compareStockDescending(left: object, right: object) {
 const quantity = (item: object) => {
  const value = Number((item as { actual_qty?: unknown }).actual_qty);
  return Number.isFinite(value) ? value : 0;
 };
 return quantity(right) - quantity(left);
}
