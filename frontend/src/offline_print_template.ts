import {
	getPrintTemplate,
	getOfflinePrintContext,
	getOpeningStorage,
	getStoredCustomer,
	getTermsAndConditions,
	memoryInitPromise,
} from "./offline/index";
import nunjucks from "nunjucks";

declare const frappe: any;

function normaliseTemplate(template: string) {
	if (!template) return template;
	// Server-only ledger lookups cannot run on a disconnected till. Keep the
	// normal template's layout, using only the saved transaction's payment data.
	template = template.replace(
		/{%-?\s*set\s+(\w+)\s*=\s*frappe\.db\.sql\([\s\S]*?%}/g,
		(tag, variable) => {
			if (tag.includes("tabPayment Entry")) {
				return `{% set ${variable} = ${/GROUP BY/i.test(tag) ? "[]" : "doc.paid_amount"} %}`;
			}
			if (tag.includes("tabLoyalty Point Entry"))
				return `{% set ${variable} = none %}`;
			throw new Error(
				"This receipt contains a server lookup that cannot be printed offline. Connect before printing.",
			);
		},
	);
	return template.replace(/"""([\s\S]*?)"""/g, (_, str) => {
		const escaped = str
			.replace(/\\/g, "\\\\")
			.replace(/"/g, '\\"')
			.replace(/\r?\n/g, "\\n");
		return `"${escaped}"`;
	});
}

function attachFormatter(obj: any) {
	if (!obj || typeof obj !== "object" || obj.get_formatted) return;
	obj.get = function (field: string, fallback: any = null) {
		return this[field] ?? fallback;
	};
	obj.get_formatted = function (field: string) {
		const value = this?.[field];
		if (value == null) return "";
		if (
			typeof value === "number" &&
			!["qty", "rate_percent", "loyalty_points"].includes(field)
		) {
			return new Intl.NumberFormat(undefined, {
				minimumFractionDigits: 2,
				maximumFractionDigits: 2,
			}).format(value);
		}
		return value;
	};
}

function computePaidAmount(doc: any) {
	if (!doc) return 0;

	const sign = doc.is_return ? -1 : 1;
	const paymentsTotal = (doc.payments || []).reduce(
		(sum: number, p: any) => sum + Math.abs(parseFloat(p.amount) || 0),
		0,
	);
	const changeAmount = Math.abs(parseFloat(doc.change_amount) || 0);

	const creditSale =
		doc.is_credit_sale === true ||
		doc.is_credit_sale === 1 ||
		doc.is_credit_sale === "1" ||
		String(doc.is_credit_sale).toLowerCase() === "yes";

	if (creditSale || paymentsTotal === 0) {
		return 0;
	}

	const paidAmount = paymentsTotal
		? Math.max(paymentsTotal - changeAmount, 0)
		: Math.abs(parseFloat(doc.paid_amount ?? doc.grand_total ?? 0) || 0);
	return sign * paidAmount;
}

function defaultOfflineHTML(invoice: any, terms = "") {
	if (!invoice) return "";

	const itemsRows = (invoice.items || [])
		.map((it: any) => {
			const sn = it.serial_no
				? `<div class="serial">SR.No: ${it.serial_no.replace(/\n/g, ", ")}</div>`
				: "";
			const marker =
				invoice.posa_show_custom_name_marker_on_print &&
				it.name_overridden
					? " (custom)"
					: "";
			return `<tr>
                <td>${it.item_code}${
					it.item_name && it.item_name !== it.item_code
						? `<div class="item-name">${it.item_name}${marker}</div>`
						: ""
				}${sn}</td>
                <td class="qty">${it.qty} ${it.uom || ""}</td>
                <td class="rate">${it.rate}</td>
                <td class="amount">${it.amount}</td>
            </tr>`;
		})
		.join("");

	const taxesRows = (invoice.taxes || [])
		.map(
			(row: any) => `<tr>
                <td style="width:60%">${row.description}@${row.rate}%</td>
                <td style="width:40%; text-align:right;">${row.tax_amount}</td>
            </tr>`,
		)
		.join("");

	const discountRow = invoice.discount_amount
		? `<tr>
                <td style="width:60%">Discount</td>
                <td style="width:40%; text-align:right;">${invoice.discount_amount}</td>
            </tr>`
		: "";

	const changeRow = invoice.change_amount
		? `<tr>
                <td style="width:60%">Change Amount</td>
                <td style="width:40%; text-align:right;">${invoice.change_amount}</td>
            </tr>`
		: "";

	const termsSection = terms
		? `<div class="terms"><strong>Terms & Conditions</strong><div>${terms}</div></div>`
		: "";

	const paidAmount = computePaidAmount(invoice);

	return `<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>Invoice ${invoice.name || ""}</title>
    <style>
        body { font-family: Arial, sans-serif; width: 80mm; margin: 0 auto; padding: 5mm; }
        .header { text-align: center; }
        .header h2 { margin: 0; }
        .info { margin-bottom: 4px; }
        .info div { font-size: 12px; line-height: 1.2; }
        table { width: 100%; border-collapse: collapse; }
        th, td { font-size: 12px; padding: 4px 0; border-bottom: 1px dashed #ccc; }
        th { text-align: left; }
        td.qty, td.rate, td.amount { text-align: right; }
        table.totals td { border-bottom: none; }
        .terms { margin-top: 8px; font-size: 10px; }
        .footer { text-align: center; margin-top: 8px; font-size: 11px; }
    </style>
</head>
<body>
    <div class="header">
        <h2>${invoice.company || "Invoice"}</h2>
        <p><strong>${invoice.is_duplicate ? "Duplicate" : "Original"}</strong></p>
    </div>
    <div class="info">
        <div><strong>Invoice:</strong> ${invoice.name || ""}</div>
        <div><strong>Date:</strong> ${invoice.posting_date || ""} ${invoice.posting_time || ""}</div>
        <div><strong>Customer:</strong> ${invoice.customer_name || invoice.customer || ""}</div>
        <div><strong>Mobile:</strong> ${invoice.contact_mobile || ""}</div>
        <div><strong>Additional Note:</strong> ${invoice.posa_notes || ""}</div>
        ${invoice.posa_authorization_code ? `<div><strong>Authorization Code:</strong> ${invoice.posa_authorization_code}</div>` : ""}
    </div>
    <table class="items">
        <thead>
            <tr>
                <th style="width:40%">Item</th>
                <th style="width:20%; text-align:right;">Qty</th>
                <th style="width:20%; text-align:right;">Rate</th>
                <th style="width:20%; text-align:right;">Amt</th>
            </tr>
        </thead>
        <tbody>${itemsRows}</tbody>
    </table>
    <table class="totals">
        <tbody>
            ${taxesRows}
            ${discountRow}
            <tr>
                <td style="width:60%"><strong>Total</strong></td>
                <td style="width:40%; text-align:right;">${invoice.grand_total}</td>
            </tr>
            <tr>
                <td style="width:60%">Paid</td>
                <td style="width:40%; text-align:right;">${paidAmount}</td>
            </tr>
            ${changeRow}
        </tbody>
    </table>
    ${termsSection}
    <div class="footer">Thank you, please visit again.</div>
</body>
</html>`;
}

export default async function renderOfflineInvoiceHTML(invoice: any) {
	if (!invoice) return "";

	await memoryInitPromise;

	const cached = getOfflinePrintContext();
	const profile = getOpeningStorage()?.pos_profile;
	const profileName = invoice.pos_profile || profile?.name;
	const receipt = cached && cached.profile === profileName ? cached : null;
	const configuredFormat =
		profile?.name === profileName &&
		(profile?.print_format_for_online || profile?.print_format);
	if (
		configuredFormat &&
		(!receipt?.html || receipt.format !== configuredFormat)
	) {
		throw new Error(
			"The normal receipt layout is not cached for this till. Connect to load it before printing.",
		);
	}
	if (profileName && !receipt)
		throw new Error(
			"The normal receipt layout is not cached for this till. Connect to load it before printing.",
		);
	const template = normaliseTemplate(
		receipt?.html ||
			(!configuredFormat && !profileName ? getPrintTemplate() : ""),
	);
	const terms = getTermsAndConditions();
	const doc = {
		...invoice,
		terms: invoice.terms || terms,
		terms_and_conditions: invoice.terms_and_conditions || terms,
	};

	doc.paid_amount = computePaidAmount(doc);
	const pending = Number(doc.docstatus) !== 1;
	const customer = doc.customer
		? await getStoredCustomer(doc.customer)
		: null;
	doc.customer_name =
		doc.customer_name || customer?.customer_name || doc.customer;
	if (!doc.name && pending) doc.name = "Not assigned yet";
	attachFormatter(doc);
	(doc.items || []).forEach((row: any) => attachFormatter(row));
	(doc.taxes || []).forEach((row: any) => attachFormatter(row));
	(doc.payments || []).forEach((row: any) => attachFormatter(row));
	const offlineReference = String(doc.posa_client_request_id || "").replace(
		/[&<>"']/g,
		(c) =>
			({
				"&": "&amp;",
				"<": "&lt;",
				">": "&gt;",
				'"': "&quot;",
				"'": "&#39;",
			})[c] || c,
	);
	const pendingLabel = pending
		? `<div style="border:2px solid #000;padding:6px;text-align:center;font-weight:bold">Pending synchronisation<br>Not yet recorded in ERPNext${offlineReference ? `<br><small>Offline reference: ${offlineReference}</small>` : ""}</div>`
		: "";

	if (!template) {
		console.warn(
			"No offline print template cached; using fallback template",
		);
		return pendingLabel + defaultOfflineHTML(doc, doc.terms_and_conditions);
	}

	try {
		const env = nunjucks.configure({ autoescape: true });
		env.addFilter("format_currency", (value: unknown, currency: string) => {
			const number =
				typeof value === "number" ? value : parseFloat(String(value));
			if (Number.isNaN(number)) return value;
			try {
				return new Intl.NumberFormat(undefined, {
					style: currency ? "currency" : "decimal",
					currency: currency || undefined,
				}).format(number);
			} catch {
				return currency ? `${currency} ${number}` : String(number);
			}
		});
		env.addFilter("currency", (value: unknown, currency: string) =>
			(env as any).filters.format_currency(value, currency),
		);
		(env as any).getFilter = function (name: string) {
			return (this as any).filters[name] || ((v: unknown) => v);
		};

		const context = {
			doc,
			letter_head: new nunjucks.runtime.SafeString(
				receipt?.letter_head || "",
			),
			terms: doc.terms,
			terms_and_conditions: doc.terms_and_conditions,
			_: frappe?._ ? frappe._ : (t: string) => t,
			frappe: {
				db: {
					get_value: (_dt: string, _name: string, field: string) =>
						customer?.[field] || "",
				},
				utils: {
					today: () => doc.posting_date || doc.transaction_date || "",
					fmt_money: (value: any) =>
						new Intl.NumberFormat(undefined, {
							minimumFractionDigits: 2,
							maximumFractionDigits: 2,
						}).format(Number(value || 0)),
				},
				get_list: () => [],
			},
		};
		const body = env.renderString(template, context);
		return `<!doctype html><html><head><meta charset="utf-8"><style>
		body{font-family:Arial,sans-serif;margin:0} .print-format{width:80mm;box-sizing:border-box;padding:4mm;font-size:12px}
		.text-center{text-align:center}.text-right{text-align:right}table{width:100%;border-collapse:collapse}td,th{padding:2px}
		img{max-width:100%;height:auto} ${receipt?.css || ""}</style></head><body><div class="print-format">${pendingLabel}${body}</div></body></html>`;
	} catch (e) {
		console.error("Failed to render offline invoice", e);
		if (configuredFormat || receipt)
			throw new Error(
				"The normal receipt could not be rendered offline. The transaction remains saved; connect before printing.",
			);
		return pendingLabel + defaultOfflineHTML(doc, doc.terms_and_conditions);
	}
}
