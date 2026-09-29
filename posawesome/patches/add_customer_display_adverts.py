import frappe

from posawesome.patches.add_customer_display_settings import _upsert_custom_field


def execute():
    frappe.reload_doc("posawesome", "doctype", "pos_customer_display_advert")
    for field in [
        {
            "fieldname": "posa_enable_customer_display_adverts",
            "label": "Enable Customer Display Adverts",
            "fieldtype": "Check",
            "default": "0",
            "depends_on": "eval:doc.posa_enable_customer_display==1",
            "insert_after": "posa_auto_open_customer_display",
            "description": "Show adverts 5 seconds after the bill is finished and no bill is active. Rotate every 10 seconds.",
        },
        {
            "fieldname": "posa_customer_display_adverts",
            "label": "Customer Display Adverts",
            "fieldtype": "Table",
            "options": "POS Customer Display Advert",
            "depends_on": "eval:doc.posa_enable_customer_display==1 && doc.posa_enable_customer_display_adverts==1",
            "insert_after": "posa_enable_customer_display_adverts",
            "description": "Add up to 10 images. Drag rows to change their display order. Switching adverts off keeps this list.",
        },
    ]:
        _upsert_custom_field(field)
    frappe.clear_cache(doctype="POS Profile")
