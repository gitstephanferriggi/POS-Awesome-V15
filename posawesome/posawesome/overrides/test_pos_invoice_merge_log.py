"""Regression coverage for tax-inclusive credit-note consolidation rounding."""

import unittest
from types import SimpleNamespace
from unittest.mock import patch

import frappe
from erpnext.accounts.doctype.sales_invoice.sales_invoice import SalesInvoice
from erpnext.controllers.taxes_and_totals import calculate_taxes_and_totals

from posawesome.posawesome.overrides.pos_invoice_merge_log import CustomPOSInvoiceMergeLog


class Invoice(SimpleNamespace):
    def get(self, key, default=None):
        return getattr(self, key, default)

    def precision(self, field):
        return 2

    def is_rounded_total_disabled(self):
        return self.disable_rounded_total

    def set(self, key, value):
        setattr(self, key, value)

    def set_paid_amount(self):
        self.paid_amount = sum(p.amount for p in self.payments)
        self.base_paid_amount = sum(p.base_amount for p in self.payments)


class TestReturnConsolidationRounding(unittest.TestCase):
    def setUp(self):
        settings = patch("frappe.get_system_settings", return_value="Banker's Rounding")
        settings.start()
        self.addCleanup(settings.stop)
        translation = patch("erpnext.accounts.doctype.sales_invoice.sales_invoice._", side_effect=lambda text: text)
        translation.start()
        self.addCleanup(translation.stop)
        self.merge = object.__new__(CustomPOSInvoiceMergeLog)
        self.source = Invoice(
            rounded_total=-112.99, base_rounded_total=-112.99,
            rounding_adjustment=0, base_rounding_adjustment=0,
        )
        self.invoice = Invoice(
            is_return=1, is_consolidated=1, disable_rounded_total=0,
            currency="EUR", conversion_rate=1, grand_total=-112.99,
            rounded_total=-112.99, base_rounded_total=-112.99,
            rounding_adjustment=0, base_rounding_adjustment=0,
            paid_amount=-112.99, base_paid_amount=-112.99,
            write_off_amount=0, base_write_off_amount=0,
            items=[Invoice(net_amount=n, base_net_amount=n) for n in [-33.47, -15.25, -47.03]],
            taxes=[Invoice(tax_amount=-17.23, base_tax_amount=-17.23)],
            payments=[Invoice(amount=-112.99, base_amount=-112.99, mode_of_payment="Cash")],
            meta=SimpleNamespace(get_field=lambda field: True),
        )

    def recalculate_rounding(self):
        # The merger substitutes rounded net prices. This is the total that
        # ERPNext subsequently passes to its real rounding and POS validation.
        self.invoice.grand_total = -112.98
        controller = SimpleNamespace(doc=self.invoice, _set_in_company_currency=lambda *args: None)
        with patch("erpnext.controllers.taxes_and_totals.round_based_on_smallest_currency_fraction",
                   side_effect=lambda amount, *args: round(amount, 2)):
            calculate_taxes_and_totals.set_rounded_total(controller)

    def test_original_failure_is_reproduced(self):
        self.recalculate_rounding()
        with patch("erpnext.accounts.doctype.sales_invoice.sales_invoice.frappe.throw",
                   side_effect=frappe.ValidationError):
            with self.assertRaises(frappe.ValidationError):
                SalesInvoice.validate_pos(self.invoice)

    def test_refund_survives_erpnext_rounding_and_validation(self):
        self.merge._preserve_return_rounding(self.invoice, [self.source])
        self.merge._normalize_return_payments(self.invoice)
        self.recalculate_rounding()
        SalesInvoice.validate_pos(self.invoice)
        self.assertEqual(self.invoice.rounded_total, -112.99)
        self.assertEqual(self.invoice.rounding_adjustment, -0.01)
        self.assertEqual(self.invoice.base_rounding_adjustment, -0.01)
        self.assertEqual(self.invoice.paid_amount, -112.99)
        self.assertEqual(self.invoice.payments[0].mode_of_payment, "Cash")
        self.assertEqual(self.invoice.taxes[0].tax_amount, -17.23)

    def test_exact_total_needs_no_adjustment(self):
        self.invoice.taxes[0].tax_amount = -17.24
        self.invoice.taxes[0].base_tax_amount = -17.24
        self.merge._preserve_return_rounding(self.invoice, [self.source])
        self.assertEqual(self.invoice.rounding_adjustment, 0)

    def test_larger_discrepancy_is_not_classified_as_rounding(self):
        self.invoice.items[0].net_amount = -32.47
        self.merge._preserve_return_rounding(self.invoice, [self.source])
        self.assertEqual(self.invoice.rounding_adjustment, 0)

    def test_source_total_survives_profile_disabling_new_rounding(self):
        self.invoice.disable_rounded_total = 1
        self.merge._preserve_return_rounding(self.invoice, [self.source])
        self.recalculate_rounding()
        SalesInvoice.validate_pos(self.invoice)
        self.assertEqual(self.invoice.rounding_adjustment, -0.01)
        self.assertEqual(self.invoice.disable_rounded_total, 1)

    def test_missing_source_rounded_total_is_not_invented(self):
        self.source.rounded_total = 0
        self.merge._preserve_return_rounding(self.invoice, [self.source])
        self.assertEqual(self.invoice.rounding_adjustment, 0)

    def test_multiple_returns_accumulate_rounding(self):
        self.invoice.items *= 2
        self.invoice.taxes *= 2
        self.merge._preserve_return_rounding(self.invoice, [self.source, self.source])
        self.assertEqual(self.invoice.rounded_total, -225.98)
        self.assertEqual(self.invoice.rounding_adjustment, -0.02)

    def test_base_currency_rounding_is_preserved_separately(self):
        self.invoice.conversion_rate = 2
        self.source.base_rounded_total *= 2
        for row in self.invoice.items:
            row.base_net_amount *= 2
        self.invoice.taxes[0].base_tax_amount *= 2
        self.merge._preserve_return_rounding(self.invoice, [self.source])
        self.assertEqual(self.invoice.base_rounded_total, -225.98)
        self.assertEqual(self.invoice.base_rounding_adjustment, -0.02)
