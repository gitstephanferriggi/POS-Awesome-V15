from frappe.custom.doctype.custom_field.custom_field import create_custom_fields


def execute():
    create_custom_fields({doctype: [{
        "fieldname": "pos_profile",
        "label": "POS Profile",
        "fieldtype": "Link",
        "options": "POS Profile",
        "insert_after": "taxes_and_charges",
        "read_only": 1,
        "print_hide": 1,
        "no_copy": 0,
    }] for doctype in ("Quotation", "Delivery Note")})
