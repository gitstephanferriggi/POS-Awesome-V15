import { printDocumentViaQz, type QzPrintDocumentOptions } from "./qzTray";
import { parseBooleanSetting } from "../utils/stock";
import {
	printRawDocumentViaQz,
	shouldUseRawDocumentPrinting,
	type RawDocumentPrintOptions,
} from "./rawDocumentPrint";

export { shouldUseRawDocumentPrinting } from "./rawDocumentPrint";

export interface ConfiguredQzDocumentPrintOptions extends QzPrintDocumentOptions {
	doc?: Record<string, any> | null;
	profile?: Record<string, any> | null;
	rawWidthChars?: number;
}

export async function printDocumentViaConfiguredQz(options: ConfiguredQzDocumentPrintOptions) {
	if (options.doctype === "JYSK Sales Deposit" && options.printFormat === "JYSK Deposit Document Pair") {
		// Separate jobs preserve the printer's end-of-document cut, including
		// long acknowledgements that need more than one roll-paper page.
		await printDocumentViaQz({ ...options, printFormat: "JYSK Order Acknowledgement" });
		try {
			await printDocumentViaQz({ ...options, printFormat: "JYSK Deposit Receipt" });
		} catch {
			throw new Error("The acknowledgement was sent to the printer, but the deposit receipt was not confirmed. Use Receipts / Reprint and select Deposit Receipt only. The payment is already saved; do not submit it again.");
		}
		return;
	}
	// Deposit formats contain two legally distinct frozen documents. Always
	// use their governed HTML; the generic raw invoice renderer has no deposit
	// tax lots, acknowledgement wording or two-document layout.
	if (shouldUseRawDocumentPrinting(options.profile) && options.doctype !== "JYSK Sales Deposit") {
		const rawOptions: RawDocumentPrintOptions = {
			doctype: options.doctype,
			name: options.name,
			doc: options.doc,
			profile: options.profile,
			printerName: options.printerName,
			widthChars: options.rawWidthChars,
		};
		await printRawDocumentViaQz(rawOptions);
		return;
	}

	await printDocumentViaQz(options);
}

export function shouldUseConfiguredQzDocumentPrinting(profile?: Record<string, any> | null) {
	return shouldUseRawDocumentPrinting(profile) || parseBooleanSetting(profile?.posa_silent_print);
}

function translate(text: string) {
	const translator = (globalThis as any).__ || (globalThis as any).frappe?._;
	return typeof translator === "function" ? translator(text) : text;
}

export function getQzPrintErrorMessage(error: unknown) {
	if (error instanceof Error && error.message) {
		return error.message;
	}
	if (typeof error === "string" && error.trim()) {
		return error.trim();
	}
	return translate("Unknown QZ Tray printing error.");
}

export function confirmDocumentPrintFallback(
	error: unknown,
	options: { raw?: boolean; offline?: boolean } = {},
) {
	const reason = getQzPrintErrorMessage(error);
	const title = options.offline
		? translate("Raw/QZ printing is not available while the POS is offline.")
		: options.raw
			? translate("Raw/QZ printing failed.")
			: translate("QZ Tray printing failed.");
	const message = `${title}\n\n${translate("Reason")}: ${reason}\n\n${translate("Do you want to print using the browser fallback instead?")}`;
	return window.confirm(message);
}
