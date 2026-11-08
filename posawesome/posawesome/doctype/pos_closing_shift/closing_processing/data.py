import frappe
from frappe.utils import cint
from posawesome.posawesome.doctype.pos_closing_shift.closing_processing.invoices import (
    submit_printed_invoices,
)


@frappe.whitelist()
def get_cashiers(doctype, txt, searchfield, start, page_len, filters):
    cashiers_list = frappe.get_all("POS Profile User", filters=filters, fields=["user"])
    result = []
    for cashier in cashiers_list:
        user_email = frappe.get_value("User", cashier.user, "email")
        if user_email:
            # Return list of tuples in format (value, label) where value is user ID and label shows both ID and email
            result.append([cashier.user, f"{cashier.user} ({user_email})"])
    return result


@frappe.whitelist()
def get_pos_invoices(pos_opening_shift, doctype=None, submit_printed=1, for_update=False):
    if not doctype:
        pos_profile = frappe.db.get_value("POS Opening Shift", pos_opening_shift, "pos_profile")
        use_pos_invoice = frappe.db.get_value(
            "POS Profile",
            pos_profile,
            "create_pos_invoice_instead_of_sales_invoice",
        )
        doctype = "POS Invoice" if use_pos_invoice else "Sales Invoice"
    if doctype not in ("Sales Invoice", "POS Invoice"):
        frappe.throw("Choose Sales Invoice or POS Invoice")
    for_update = bool(cint(for_update))
    if cint(submit_printed):
        submit_printed_invoices(pos_opening_shift, doctype, for_update=for_update)
    cond = " and ifnull(consolidated_invoice,'') = ''" if doctype == "POS Invoice" else ""
    lock = " ORDER BY name FOR UPDATE" if for_update else ""
    data = frappe.db.sql(
        f"""
	select
		name
	from
		`tab{doctype}`
	where
		docstatus = 1 and posa_pos_opening_shift = %s{cond}{lock}
	""",
        (pos_opening_shift),
        as_dict=1,
    )

    data = [frappe.get_doc(doctype, d.name, for_update=for_update).as_dict() for d in data]

    return data


SUPPORTS_REFUND_SHIFT_LINKS = True


def _payment_opening(name, for_update=False):
    from posawesome.posawesome.api.pos_access import (
        get_authenticated_pos_user, get_authorized_pos_profile, user_can_manage_pos,
    )
    user = get_authenticated_pos_user()
    opening = frappe.get_doc("POS Opening Shift", name, for_update=for_update)
    get_authorized_pos_profile(opening.pos_profile, company=opening.company)
    if opening.docstatus != 1 or (opening.user != user and not user_can_manage_pos(user)):
        frappe.throw(frappe._("You can only read payment activity for your own authorised POS shift."), frappe.PermissionError)
    return opening


@frappe.whitelist()
def get_payments_entries(pos_opening_shift, for_update=False):
    # One OR query counts each payment once while keeping its actual receipt
    # reference. Sites without the optional custom field use the legacy path.
    opening = _payment_opening(pos_opening_shift, for_update=bool(cint(for_update)))
    linked = frappe.db.has_column("Payment Entry", "jysk_refund_opening_shift")
    condition = "(reference_no=%s OR jysk_refund_opening_shift=%s)" if linked else "reference_no=%s"
    values = (opening.company, pos_opening_shift, pos_opening_shift) if linked else (opening.company, pos_opening_shift)
    if cint(for_update):
        return frappe.db.sql(
            """SELECT name,mode_of_payment,paid_amount,base_paid_amount,
            paid_from_account_currency,paid_to_account_currency,target_exchange_rate,
            reference_no,posting_date,party_type,party,payment_type
            FROM `tabPayment Entry` WHERE docstatus=1 AND company=%s AND """ + condition + """
            AND payment_type IN ('Receive','Pay') ORDER BY name FOR UPDATE""",
            values, as_dict=True,
        )
    filters = {"docstatus":1, "company":opening.company, "payment_type":["in",["Receive","Pay"]]}
    optional = {"or_filters":{"reference_no":pos_opening_shift, "jysk_refund_opening_shift":pos_opening_shift}} if linked else {}
    if not linked:
        filters["reference_no"] = pos_opening_shift
    return frappe.get_all(
        "Payment Entry",
        filters=filters,
        **optional,
        fields=[
            "name",
            "mode_of_payment",
            "paid_amount",
            "base_paid_amount",
            "paid_from_account_currency",
            "paid_to_account_currency",
            "target_exchange_rate",
            "reference_no",
            "posting_date",
            "party_type",
            "party",
            "payment_type",
        ],
    )
