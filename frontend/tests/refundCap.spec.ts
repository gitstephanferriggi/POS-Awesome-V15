import { describe, expect, it } from "vitest";
import { authoritativeRefundCap } from "../src/posapp/utils/refundCap";

describe("authoritative refund balance", () => {
	it("uses remaining paid value rather than the original invoice total", () => {
		expect(authoritativeRefundCap({grand_total: 118, outstanding_amount: 0, posa_refundable_amount: 59})).toBe(59);
	});
	it("does not invent refundable cash from an older cached invoice", () => {
		expect(authoritativeRefundCap({grand_total: 118, outstanding_amount: 0})).toBe(0);
	});
	it("preserves an exhausted carried balance over a stale original balance", () => {
		expect(authoritativeRefundCap({posa_refundable_amount: 0}, {posa_refundable_amount: 118})).toBe(0);
	});
	it.each([NaN, Infinity, -1, "118"])("rejects malformed balance %s", value => {
		expect(authoritativeRefundCap({posa_refundable_amount: value})).toBe(0);
	});
});
