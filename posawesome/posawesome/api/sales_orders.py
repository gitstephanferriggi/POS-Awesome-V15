# Copyright (c) 2020, Youssef Restom and contributors
# For license information, please see license.txt

import json

import frappe
from frappe.utils import cint, flt, getdate, nowdate

from posawesome.posawesome.api.payment_entry import create_payment_entry
from posawesome.posawesome.api.tax_contracts import apply_pos_tax_inclusion_contract


def _payment_entry_job(order_name, payments):
    """Background task to create payment entries."""
    so_doc = frappe.get_doc("Sales Order", order_name)
    _create_payment_entries(so_doc, payments)


@frappe.whitelist()
def search_orders(company, currency, order_name=None):
    filters = {
        "billing_status": ["in", ["Not Billed", "Partly Billed"]],
        "docstatus": 1,
        "company": company,
        "currency": currency,
    }
    if order_name:
        filters["name"] = ["like", f"%{order_name}%"]
    orders_list = frappe.get_list(
        "Sales Order",
        filters=filters,
        fields=["name"],
        limit_page_length=0,
        order_by="customer",
    )
    data = []
    for order in orders_list:
        data.append(frappe.get_doc("Sales Order", order["name"]))
    return data


def _map_delivery_dates(data):
    """Ensure mandatory delivery_date fields are populated."""

    def parse_date(value):
        if not value:
            return None
        if isinstance(value, str):
            normalized = value.strip()
            if not normalized:
                return None
            if normalized.lower() in {"invalid date", "nan", "none", "null", "undefined"}:
                return None
            value = normalized
        try:
            return str(getdate(value))
        except Exception:
            return None

    previous_delivery_date = parse_date(data.get("delivery_date"))

    # The POS picker is authoritative when it supplies a valid date.
    order_delivery_date = (
        parse_date(data.get("posa_delivery_date"))
        or previous_delivery_date
        or parse_date(data.get("transaction_date"))
        or parse_date(data.get("posting_date"))
        or str(getdate(nowdate()))
    )
    data["delivery_date"] = order_delivery_date

    # Map item level delivery dates
    for item in data.get("items", []):
        if not isinstance(item, dict):
            continue

        item_delivery = (
            parse_date(item.get("posa_delivery_date"))
            or parse_date(item.get("delivery_date"))
            or order_delivery_date
        )
        if item_delivery == previous_delivery_date:
            item_delivery = order_delivery_date
        if item_delivery:
            item["delivery_date"] = item_delivery
            item["posa_delivery_date"] = item_delivery


@frappe.whitelist()
def update_sales_order(data):
    """Create or update a Sales Order document."""
    data = json.loads(data)
    _map_delivery_dates(data)
    if data.get("name") and frappe.db.exists("Sales Order", data.get("name")):
        so_doc = frappe.get_doc("Sales Order", data.get("name"))
        so_doc.update(data)
    else:
        so_doc = frappe.get_doc(data)

    so_doc.flags.ignore_permissions = True
    frappe.flags.ignore_account_permission = True
    so_doc.docstatus = 0
    apply_pos_tax_inclusion_contract(so_doc)
    so_doc.save()
    return so_doc


def _create_payment_entries(so_doc, payments, posting_date=None):
    """Create payment entries referencing the sales order."""
    payment_date = getdate(posting_date) if posting_date else nowdate()
    for pay in payments or []:
        if not pay.get("amount"):
            continue

        # Create payment entry using helper to ensure exchange rates are set
        pe = create_payment_entry(
            company=so_doc.company,
            customer=so_doc.customer,
            amount=pay.get("amount"),
            currency=pay.get("currency") or so_doc.currency,
            mode_of_payment=pay.get("mode_of_payment"),
            reference_no=so_doc.get("posa_pos_opening_shift"),
            reference_date=payment_date,
            posting_date=payment_date,
            submit=0,
        )

        # Link payment entry to the sales order
        pe.append(
            "references",
            {
                "allocated_amount": pay.get("amount"),
                "reference_doctype": "Sales Order",
                "reference_name": so_doc.name,
            },
        )

        pe.flags.ignore_permissions = True
        frappe.flags.ignore_account_permission = True
        pe.save()
        pe.submit()


@frappe.whitelist()
def submit_sales_order(order, payment_posting_date=None):
    """Submit sales order and create payment entries."""
    order = json.loads(order)
    _map_delivery_dates(order)
    if order.get("name") and frappe.db.exists("Sales Order", order.get("name")):
        so_doc = frappe.get_doc("Sales Order", order.get("name"))
        so_doc.update(order)
    else:
        so_doc = frappe.get_doc(order)

    payments = order.get("payments")

    so_doc.flags.ignore_permissions = True
    frappe.flags.ignore_account_permission = True
    apply_pos_tax_inclusion_contract(so_doc)
    so_doc.save()
    _check_inclusive_order_total(so_doc, order.get("grand_total"))
    so_doc.submit()
    _check_inclusive_order_total(so_doc, order.get("grand_total"))

    # Keep the deposit and order in the same request transaction. Any payment
    # failure rolls back the order; printing begins only after both are saved.
    if payments:
        if payment_posting_date:
            _create_payment_entries(so_doc, payments, posting_date=payment_posting_date)
        else:
            _create_payment_entries(so_doc, payments)

    return {"name": so_doc.name, "status": so_doc.docstatus}


def _check_inclusive_order_total(doc, expected_total):
    if expected_total is None or not doc.get("pos_profile"):
        return
    if not cint(frappe.get_cached_value("POS Profile", doc.pos_profile, "posa_tax_inclusive")):
        return
    precision = doc.precision("grand_total")
    if flt(doc.grand_total, precision) != flt(expected_total, precision):
        frappe.throw(
            "VAT-inclusive order total changed during tax calculation. "
            "The order and payment were not submitted."
        )


@frappe.whitelist(methods=["POST"])
def repair_offline_sales_order_vat(sales_order, apply=0):
    """Preview or repair only an unfulfilled offline order with missing tax rows.

    Sales Orders have no general-ledger entries. Keep the submitted order and
    its existing advance; record an audit comment instead of cancelling either.
    """
    frappe.only_for("System Manager")
    doc = frappe.get_doc("Sales Order", sales_order, for_update=True)
    doc.check_permission("write")
    if doc.docstatus != 1 or doc.status in ("Closed", "On Hold"):
        frappe.throw("Only an open submitted Sales Order can be repaired.")
    for child in ("Sales Invoice Item", "Delivery Note Item"):
        if frappe.db.exists(child, {"sales_order": sales_order, "docstatus": ["!=", 2]}):
            frappe.throw("An invoice or delivery already references this order; review it before repairing VAT.")
    ledger_name = frappe.db.get_value(
        "POS Invoice Submission Ledger",
        {"document_type": "Sales Order", "invoice_name": sales_order, "state": "POST_SUBMIT_DONE"},
        "name",
    )
    if not ledger_name:
        frappe.throw("The original offline submission ledger is required.")
    ledger = frappe.get_doc("POS Invoice Submission Ledger", ledger_name)
    original = json.loads(ledger.invoice_payload)
    profile = original.get("pos_profile")
    if original.get("doctype") != "Sales Order" or original.get("taxes") or not profile:
        frappe.throw("This repair is only for offline Sales Orders originally saved without tax rows.")
    if original.get("company") != doc.company or original.get("customer") != doc.customer:
        frappe.throw("The order no longer matches its original offline transaction.")
    if not cint(frappe.get_cached_value("POS Profile", profile, "posa_tax_inclusive")):
        frappe.throw("The original POS Profile must use VAT-inclusive prices.")

    def item_values(items):
        return [(i.get("item_code"), flt(i.get("qty")), flt(i.get("rate"), 6)) for i in items]

    if item_values(original.get("items", [])) != item_values(doc.items):
        frappe.throw("The order items have changed; review VAT manually.")
    original_total = original.get("grand_total")
    if original_total is None or flt(doc.grand_total, 2) != flt(original_total, 2):
        frappe.throw("The order total no longer matches the original amount.")
    if doc.taxes:
        frappe.throw("This order already has tax rows; no repair was applied.")
    before = {k: doc.get(k) for k in ("net_total", "total_taxes_and_charges", "grand_total", "advance_paid")}
    doc.pos_profile = profile
    apply_pos_tax_inclusion_contract(doc, recalculate=False)
    if not doc.taxes:
        frappe.throw("No tax rows were found in the POS Profile tax template.")
    doc.calculate_taxes_and_totals()
    _check_inclusive_order_total(doc, original_total)
    result = {
        "name": doc.name,
        "before": before,
        "after": {k: doc.get(k) for k in before},
        "applied": bool(cint(apply)),
    }
    if cint(apply):
        doc.flags.ignore_validate_update_after_submit = True
        doc.save()
        _check_inclusive_order_total(doc, original_total)
        if flt(doc.advance_paid, 2) != flt(before["advance_paid"], 2):
            frappe.throw("The existing advance changed; VAT repair was rolled back.")
        doc.add_comment(
            "Comment",
            "Restored inclusive VAT from the original offline submission; "
            "order total and existing cash advance unchanged. " + json.dumps(result),
        )
    return result
