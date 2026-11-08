"""Till overview must agree with one signed native payout, not deduct it twice."""
import unittest
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import frappe
from posawesome.posawesome.doctype.pos_closing_shift.closing_processing import creation, overview


class TestOverviewPayouts(unittest.TestCase):
    def run_overview(self, *, method="Cash", reference=False, currency="EUR", rate=1, change=0, payout=True, source_reference="OWNED-CREDIT", allocated=10):
        opening = SimpleNamespace(doctype="POS Opening Shift", name="OWNED-SHIFT", pos_profile="OWNED-PROFILE", company="Allowed Company")
        invoice = frappe._dict(name="OWNED-SALE", currency=currency, conversion_rate=rate,
            grand_total=30, rounded_total=30, base_grand_total=30*rate,
            change_amount=change, base_change_amount=change*rate,
            payments=[frappe._dict(mode_of_payment="Cash", amount=30+change, base_amount=(30+change)*rate)])
        entries = [frappe._dict(name="OWNED-PAYOUT", mode_of_payment=method, payment_type="Pay",
            paid_amount=10, base_paid_amount=10*rate, paid_to_account_currency=currency,
            source_exchange_rate=rate, unallocated_amount=(10-allocated) if reference else 10,
            base_unallocated_amount=(10-allocated)*rate if reference else 10*rate)] if payout else []
        references = [frappe._dict(parent="OWNED-PAYOUT", reference_doctype="Sales Invoice",
            reference_name=source_reference, allocated_amount=-allocated, base_allocated_amount=-allocated*rate)] if reference else []
        def rows(doctype, **kwargs):
            return references if doctype == "Payment Entry Reference" else []
        meta = SimpleNamespace(get=lambda key, default=None: [SimpleNamespace(fieldname="base_allocated_amount", fieldtype="Currency", options="")])
        with patch.object(creation, "authorized_opening_shift", return_value=opening), patch.object(overview.frappe, "get_doc", return_value=opening), patch.object(overview.frappe, "get_cached_value", return_value="EUR"), patch.object(overview.frappe, "db", MagicMock(get_value=lambda dt,name,field: 0 if field=="create_pos_invoice_instead_of_sales_invoice" else "Cash")), patch.object(overview.frappe, "get_meta", return_value=meta), patch.object(overview.frappe, "get_all", side_effect=rows), patch.object(overview, "get_pos_invoices", return_value=[invoice]), patch.object(overview, "get_payments_entries", return_value=entries):
            return overview.get_closing_shift_overview(opening.name)

    def test_cash_refund_reduces_till_once_with_or_without_credit_reference(self):
        for reference in (False, True):
            with self.subTest(reference=reference):
                result = self.run_overview(reference=reference)
                self.assertEqual(result["cash_expected"]["company_currency_total"], 20)
                self.assertEqual(result["payments_by_mode"][0]["total"], 20)

    def test_card_payout_does_not_reduce_cash(self):
        result = self.run_overview(method="Card")
        self.assertEqual(result["cash_expected"]["company_currency_total"], 30)
        self.assertEqual({r["mode_of_payment"]:r["total"] for r in result["payments_by_mode"]}, {"Cash":30,"Card":-10})

    def test_foreign_cash_payout_preserves_account_currency_and_company_value(self):
        result = self.run_overview(currency="USD", rate=1.2)
        self.assertEqual(result["cash_expected"]["company_currency_total"], 24)
        self.assertEqual(result["cash_expected"]["by_currency"][0]["total"], 20)

    def test_invoice_change_without_separate_payout_reduces_till_once(self):
        result = self.run_overview(change=10, payout=False)
        self.assertEqual(result["cash_expected"]["company_currency_total"], 30)
        self.assertEqual(result["change_returned"]["company_currency_total"], 10)

    def test_invoice_change_recorded_by_separate_payout_is_not_deducted_again(self):
        result = self.run_overview(change=10, reference=True, source_reference="OWNED-SALE")
        self.assertEqual(result["cash_expected"]["company_currency_total"], 30)
        self.assertEqual(result["change_returned"]["company_currency_total"], 10)

    def test_partly_allocated_payout_counts_the_allocated_and_residual_portions_once(self):
        result = self.run_overview(reference=True, allocated=4)
        self.assertEqual(result["cash_expected"]["company_currency_total"], 20)
