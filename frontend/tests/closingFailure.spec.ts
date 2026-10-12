import { describe, expect, it } from "vitest";
import { closingFailureMessage } from "../src/posapp/utils/closingFailure";
const valuation = 'Valuation Rate for the Item <a href="/app/item/ITEM-123">ITEM-123</a>, is required to do accounting entries for Sales Invoice TEST-1.<br>Here are the options to proceed:';
const payload = { _server_messages: JSON.stringify([JSON.stringify({ message: valuation })]) };
describe("readable till-closing failures", () => {
	it.each([payload, {responseJSON:payload}, {xhr:{responseJSON:payload}}, {response:{data:payload}}])("explains the missing cost and preserves the item reference", error => {
		const message = closingFailureMessage(error);
		expect(message).toContain('ITEM-123');
		expect(message).toContain('Valuation Rate');
		expect(message).toContain('stock or accounts team');
		expect(message).not.toContain('<a');
		expect(message).toContain('closing amounts have been kept');
	});
	it("handles the exception fallback without exposing a traceback", () => {
		expect(closingFailureMessage({responseJSON:{exception:valuation}})).toContain('ITEM-123');
		expect(closingFailureMessage({exception:'Traceback secret internal details'})).not.toContain('secret');
	});
	it("shows another ERP validation message as plain text", () => {
		const message=closingFailureMessage({_server_messages:JSON.stringify([JSON.stringify({message:'Not enough stock for <b>ITEM-2</b>'})])});
		expect(message).toContain('Not enough stock for ITEM-2');
		expect(message).not.toContain('<b>');
	});
	it.each([null, new Error('Network Error'), {_server_messages:'{broken'}])("handles missing or malformed errors without losing the retry warning", error => {
		expect(closingFailureMessage(error)).toContain('closing amounts have been kept');
	});
});
