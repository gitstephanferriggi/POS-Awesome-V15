import { extractServerMessage } from "../services/api";

function plainText(value: string): string {
	// Never render server-supplied markup in the dialog, including Item links.
	const withoutTags = value.replace(/<[^>]*>/g, " ");
	return withoutTags
		.replace(/&nbsp;/gi, " ")
		.replace(/&amp;/gi, "&")
		.replace(/&quot;/gi, '"')
		.replace(/&#39;|&apos;/gi, "'")
		.replace(/\s+/g, " ").trim();
}

export function closingFailureMessage(error: any): string {
	const payload = error?.responseJSON || error?.xhr?.responseJSON || error?.response?.data || error;
	const serverMessage = extractServerMessage(payload);
	const raw = serverMessage || payload?.exception || payload?.message || error?.message || "";
	const text = typeof raw === "string" ? plainText(raw) : "";
	const item = text.match(/Valuation Rate for the Item\s+(.+?),?\s+is required/i)?.[1]?.replace(/,$/, "");
	if (item) {
		return `Cannot close the till: item ${item.slice(0, 180)} has no stock valuation/cost available for this posting. Ask the stock or accounts team to record the correct incoming stock cost or set the correct Valuation Rate on the Item, then retry closing. Do not enter the selling price or an invented cost. Your closing amounts have been kept.`;
	}
	if (serverMessage && text) {
		return `The till could not be closed. ${text.slice(0, 1400)} Your closing amounts have been kept. Correct the issue before retrying.`;
	}
	// Do not expose raw Python tracebacks or assume a timed-out request rolled back.
	return "The server did not confirm that the till closed. Your closing amounts have been kept. Check the connection and verify the shift status before retrying. If it is still open, contact your administrator with the shift reference.";
}
