"""Retry only explicitly identified pre-posting stock conflicts, in a fresh transaction."""
from functools import wraps

import frappe
from frappe import _


def retry_stock_submission(function):
    @wraps(function)
    def wrapped(*args, **kwargs):
        previous = getattr(frappe.flags, 'posa_stock_retry_attempt', None)
        try:
            for attempt in range(3):
                frappe.flags.posa_stock_retry_attempt = attempt
                try:
                    return function(*args, **kwargs)
                except Exception as error:
                    if not getattr(error, 'posa_retry_before_stock_posting', False):
                        raise
                    frappe.db.rollback()
                    if attempt == 2:
                        frappe.throw(_('Another sale changed the stock. Refresh availability and retry this invoice.'))
        finally:
            frappe.flags.posa_stock_retry_attempt = previous
    return wrapped
