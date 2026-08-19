/**
 * Car Wash terminal-side printing (POS terminal + Star PassPRNT).
 *
 * This is the ONLY terminal-side print path for the Car Wash register. It is
 * scoped by the POS Profile flag `posa_carwash_terminal_print` (set on the Car
 * Wash POS Profile); for every other profile these helpers are inert and the
 * caller falls through to the normal POS Awesome browser/QZ print path
 * unchanged. No profile/company names are hard-coded in the frontend.
 *
 * Flow when the cashier presses Print / Reprint on the Car Wash register:
 *   1. `mint_print` (server, authenticated) validates the SUBMITTED Car Wash invoice,
 *      mints a short-lived signed single-use token and returns a full
 *      `starpassprnt://` URL. The PassPRNT `back` callback is fixed server-side
 *      to a LIGHTWEIGHT `print_return` page (NOT the POS route), so the return
 *      can never cold-boot a second POS Awesome.
 *   2. We navigate the CURRENT browsing context to that URL (never a new
 *      window/tab/popup). Android hands off to the official Star PassPRNT app,
 *      which fetches the receipt over the LAN and prints + cuts on the Star
 *      TSP100IIILAN at 192.168.7.4, then returns to `back`.
 *   3. PassPRNT's return is an external Android intent that Chrome opens in a
 *      new tab pointing at `print_return` (a tiny page with NO POS/Desk). That
 *      page forwards the print result to THIS POS tab via BroadcastChannel +
 *      localStorage. `listenForPassprntResult()` (installed at POS startup)
 *      receives it and shows a small toast — WITHOUT reloading, reopening
 *      payment, repeating the sale, or reprinting. The original POS tab stays
 *      the active register.
 *
 * No CUPS, no lp/lpr, no backend print, no auto-print. User-initiated only.
 */

import { useToastStore } from "../stores/toastStore";

declare const frappe: any;

// Internal channel / storage identifiers used to relay the print result from
// the lightweight return page back to the POS tab (not user-facing names).
const CHANNEL = "carwash_print";
const STORAGE_KEY = "carwash_print_result";

const isTruthyFlag = (v: any): boolean =>
	v === 1 || v === true || v === "1" || v === "true";

/**
 * True only for the Car Wash register, decided by the POS Profile flag
 * `posa_carwash_terminal_print` (a custom Check field on POS Profile set on the
 * Car Wash profile). No hard-coded profile/company name.
 */
export function isCarwashTerminalProfile(profile: any): boolean {
	if (!profile) return false;
	return isTruthyFlag(profile.posa_carwash_terminal_print);
}

const resolveInvoiceName = (input: { doc?: any; name?: string } = {}): string => {
	const raw = input.name || input.doc?.name || "";
	const name = String(raw || "").trim();
	return name && name !== "undefined" && name !== "null" ? name : "";
};

// Guard against duplicate launches when Print/Reprint is tapped repeatedly
// while PassPRNT is being prepared/opened. Shared by BOTH the sale-print and
// the Invoice Management reprint entry points (one implementation).
let terminalLaunchInFlight = false;

/**
 * Print (or reprint) a submitted Car Wash invoice via the terminal PassPRNT app.
 * Returns true when the PassPRNT URL was launched, false if a launch is already
 * in flight (duplicate tap ignored). Never falls back to any backend/browser
 * print path.
 */
export async function printCarwashViaTerminal(
	input: { doc?: any; name?: string; reprint?: boolean } = {},
): Promise<boolean> {
	const invoice = resolveInvoiceName(input);
	if (!invoice) {
		throw new Error("Cannot print without a submitted Car Wash invoice name");
	}

	// Duplicate-launch prevention: ignore re-entry while a launch is pending.
	if (terminalLaunchInFlight) {
		return false;
	}
	terminalLaunchInFlight = true;

	try {
		const res = await frappe.call({
			method:
				"bloominggarden.bloominggarden.carwash_print.terminal.mint_print",
			args: { invoice, reprint: input.reprint ? 1 : 0 },
		});

		const url = res?.message?.url;
		if (!url || typeof url !== "string" || !url.startsWith("starpassprnt://")) {
			throw new Error("Terminal print could not be prepared (no PassPRNT URL)");
		}

		// Launch the official Star PassPRNT app from the CURRENT browsing context.
		// Same-context navigation only: NO window.open / _blank / popup / new tab.
		// Android intercepts the starpassprnt:// scheme and hands off to PassPRNT.
		window.location.assign(url);
		// Release the guard shortly after (navigation to the app scheme does not
		// unload this page, so we must clear it so a later, deliberate reprint can
		// run). A short window is enough to swallow rapid double-taps.
		setTimeout(() => {
			terminalLaunchInFlight = false;
		}, 4000);
		return true;
	} catch (error) {
		// On failure, release immediately so the user can retry.
		terminalLaunchInFlight = false;
		throw error;
	}
}

// --- Result handling (POS tab side) -----------------------------------------

// Remember result ids we have already shown, so BroadcastChannel + storage
// (both may deliver the same result) toast only once. Idempotent.
const seenResultIds = new Set<string>();
let listenerInstalled = false;

function showResultToast(payload: any): void {
	if (!payload || payload.source !== "carwash_print") return;
	const id = String(payload.id || `${payload.code}:${payload.ts || ""}`);
	if (seenResultIds.has(id)) return; // already shown -> idempotent no-op
	seenResultIds.add(id);

	try {
		const toast = useToastStore();
		const success =
			payload.success === true ||
			payload.code === "0" ||
			/success/i.test(String(payload.message || ""));
		if (success) {
			toast.show({ title: "Receipt printed", color: "success" });
		} else {
			toast.show({
				title: "Print not completed",
				color: "error",
				detail: String(payload.message || `PassPRNT code ${payload.code}`),
			});
		}
	} catch {
		/* toast store not ready -> silent */
	}
}

/**
 * Install listeners so THIS POS tab receives the print result forwarded by the
 * lightweight `print_return` page (opened in a separate tab by PassPRNT's
 * return intent). Shows a small toast only. Does NOT reload, reopen payment,
 * repeat the sale, or reprint. Safe + idempotent (installs once; dedupes by
 * result id). Also drains any result already written to localStorage before
 * the listener was attached.
 */
export function listenForPassprntResult(): void {
	if (listenerInstalled) return;
	listenerInstalled = true;

	// 1) BroadcastChannel (Chrome 54+/Android 7.1 supported).
	try {
		const bc = new BroadcastChannel(CHANNEL);
		bc.onmessage = (ev: MessageEvent) => {
			showResultToast(ev?.data);
			// Clear any mirrored localStorage entry so it can't re-fire later.
			try {
				localStorage.removeItem(STORAGE_KEY);
			} catch {
				/* ignore */
			}
		};
	} catch {
		/* BroadcastChannel unavailable -> rely on storage event below */
	}

	// 2) localStorage 'storage' event (fires in OTHER same-origin tabs).
	try {
		window.addEventListener("storage", (ev: StorageEvent) => {
			if (ev.key !== STORAGE_KEY || !ev.newValue) return;
			try {
				showResultToast(JSON.parse(ev.newValue));
			} catch {
				/* ignore malformed */
			}
			try {
				localStorage.removeItem(STORAGE_KEY);
			} catch {
				/* ignore */
			}
		});
	} catch {
		/* ignore */
	}

	// 3) Drain a result that may already be sitting in localStorage (e.g. the
	//    return tab wrote it before this tab attached its listener).
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (raw) {
			showResultToast(JSON.parse(raw));
			localStorage.removeItem(STORAGE_KEY);
		}
	} catch {
		/* ignore */
	}
}
