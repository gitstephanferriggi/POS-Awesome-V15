import frappe
from frappe import _


def validate_adverts(doc, method=None):
    if len(doc.get("posa_customer_display_adverts") or []) > 10:
        frappe.throw(_("Customer Display supports a maximum of 10 adverts."))
