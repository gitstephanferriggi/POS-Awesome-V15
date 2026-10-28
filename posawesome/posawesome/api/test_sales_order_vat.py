"""VAT rows must exist before saving inclusive offline orders and mapping invoices."""
import ast
import json
from pathlib import Path
from types import SimpleNamespace
import sys
import unittest
from unittest.mock import Mock, patch


def functions(filename):
    path = Path(__file__).with_name(filename)
    nodes = [n for n in ast.parse(path.read_text()).body if isinstance(n, ast.FunctionDef)]
    for node in nodes:
        node.decorator_list = []
    env = {"json": json, "cint": lambda x: int(x or 0), "flt": lambda x, p=None: round(float(x or 0), p) if p is not None else float(x or 0)}
    exec(compile(ast.Module(body=nodes, type_ignores=[]), str(path), "exec"), env)
    return env


class Doc(dict):
    def __getattr__(self, name):
        return self.get(name)

    def __setattr__(self, name, value):
        self[name] = value

    def set(self, name, value):
        self[name] = value

    def precision(self, field):
        return 2


def fail(message):
    raise ValueError(message)


class TaxRowsTest(unittest.TestCase):
    def setUp(self):
        self.env = functions('tax_contracts.py')
        self.env['cint'] = int
        self.env['frappe'] = SimpleNamespace(get_cached_value=self.value, throw=fail)
        self.inclusive = 1
        self.company = 'Shop'
        self.rows = [{"charge_type": "On Net Total", "account_head": "VAT", "included_in_print_rate": 0},
                     {"charge_type": "Actual", "included_in_print_rate": 1}]
        self.load = Mock(side_effect=lambda *a: [dict(r) for r in self.rows])
        self.modules = patch.dict(sys.modules, {'erpnext.controllers.accounts_controller': SimpleNamespace(get_taxes_and_charges=self.load)})
        self.modules.start()
        self.addCleanup(self.modules.stop)

    def value(self, dt, name, field):
        if field == 'posa_tax_inclusive':
            return self.inclusive
        if field == 'company':
            return self.company
        if field == 'taxes_and_charges':
            return 'Regular'

    def order(self, **kwargs):
        return Doc(doctype='Sales Order', pos_profile='Till', company='Shop', taxes=[], **kwargs)

    def test_empty_offline_taxes_load_profile_template_and_include_vat(self):
        order = self.order()
        self.assertTrue(self.env['apply_pos_tax_inclusion_contract'](order))
        self.load.assert_called_once_with('Sales Taxes and Charges Template', 'Regular')
        self.assertEqual(order.taxes_and_charges, 'Regular')
        self.assertEqual([t['included_in_print_rate'] for t in order.taxes], [1, 0])

    def test_order_specific_template_takes_precedence(self):
        order = self.order(taxes_and_charges='Customer template')
        self.env['apply_pos_tax_inclusion_contract'](order)
        self.load.assert_called_once_with('Sales Taxes and Charges Template', 'Customer template')

    def test_exclusive_profile_stays_exclusive(self):
        self.inclusive = 0
        order = self.order()
        self.env['apply_pos_tax_inclusion_contract'](order)
        self.assertEqual([t['included_in_print_rate'] for t in order.taxes], [0, 0])

    def test_non_pos_orders_keep_normal_tax_behavior(self):
        order = Doc(doctype='Sales Order', company='Shop', taxes=[])
        self.assertFalse(self.env['apply_pos_tax_inclusion_contract'](order))
        self.load.assert_not_called()

    def test_existing_tax_rows_and_rates_are_preserved(self):
        order = self.order()
        order.taxes = [{'charge_type': 'On Net Total', 'rate': 5, 'included_in_print_rate': 0}]
        self.env['apply_pos_tax_inclusion_contract'](order)
        self.load.assert_not_called()
        self.assertEqual(order.taxes[0]['rate'], 5)
        self.assertEqual(order.taxes[0]['included_in_print_rate'], 1)

    def test_wrong_company_is_rejected(self):
        self.company = 'Other'
        with self.assertRaisesRegex(ValueError, 'company'):
            self.env['apply_pos_tax_inclusion_contract'](self.order())
        self.load.assert_not_called()

    def test_hook_sets_flags_before_erpnext_calculates(self):
        order = self.order()
        self.env['validate_pos_sales_order'](order, 'before_validate')
        self.assertEqual(order.taxes[0]['included_in_print_rate'], 1)


class RepairTest(unittest.TestCase):
    def setUp(self):
        self.env = functions('sales_orders.py')
        self.original = {'doctype': 'Sales Order', 'pos_profile': 'Till', 'customer': 'Customer',
                         'company': 'Shop', 'grand_total': 118, 'taxes': [],
                         'items': [{'item_code': 'A', 'qty': 1, 'rate': 118}]}
        self.order = Doc(doctype='Sales Order', name='SO', docstatus=1, status='To Deliver and Bill',
                         company='Shop', customer='Customer', items=[dict(self.original['items'][0])],
                         grand_total=118, net_total=118, total_taxes_and_charges=0, advance_paid=118,
                         taxes=[], flags=SimpleNamespace(), check_permission=Mock(), save=Mock(), add_comment=Mock())
        # dict.items is a method, whereas Frappe's Document.items is a child table.
        self.order = SimpleNamespace(**self.order)
        self.order.get = lambda key, default=None: getattr(self.order, key, default)
        self.order.precision = lambda field: 2
        def calculate():
            self.order.net_total = 100
            self.order.total_taxes_and_charges = 18
        self.order.calculate_taxes_and_totals = calculate
        self.ledger = SimpleNamespace(invoice_payload=json.dumps(self.original))
        self.db = SimpleNamespace(exists=Mock(return_value=False), get_value=Mock(return_value='ledger'))
        self.frappe = SimpleNamespace(only_for=Mock(), db=self.db, throw=fail,
                                      get_doc=Mock(side_effect=lambda dt, *a, **k: self.order if dt == 'Sales Order' else self.ledger),
                                      get_cached_value=Mock(return_value=1))
        self.env['frappe'] = self.frappe
        def apply(doc, **kwargs):
            doc.taxes = [{'included_in_print_rate': 1}]
        self.env['apply_pos_tax_inclusion_contract'] = Mock(side_effect=apply)

    def call(self, apply=0):
        return self.env['repair_offline_sales_order_vat']('SO', apply)

    def test_preview_calculates_but_does_not_save(self):
        result = self.call()
        self.assertEqual(result['after']['grand_total'], 118)
        self.assertEqual(result['after']['total_taxes_and_charges'], 18)
        self.assertFalse(result['applied'])
        self.order.save.assert_not_called()
        self.order.add_comment.assert_not_called()
        self.frappe.only_for.assert_called_once_with('System Manager')
        self.frappe.get_doc.assert_any_call('Sales Order', 'SO', for_update=True)

    def test_apply_preserves_advance_and_adds_audit_comment(self):
        self.assertTrue(self.call(1)['applied'])
        self.order.save.assert_called_once()
        self.assertTrue(self.order.flags.ignore_validate_update_after_submit)
        self.order.add_comment.assert_called_once()
        self.assertEqual(self.order.advance_paid, 118)

    def test_invoice_or_delivery_blocks_repair(self):
        self.db.exists.return_value = True
        with self.assertRaisesRegex(ValueError, 'invoice or delivery'):
            self.call(1)
        self.order.save.assert_not_called()

    def test_missing_ledger_blocks_repair(self):
        self.db.get_value.return_value = None
        with self.assertRaisesRegex(ValueError, 'ledger'):
            self.call(1)

    def test_changed_items_block_repair(self):
        self.order.items[0]['rate'] = 119
        with self.assertRaisesRegex(ValueError, 'items have changed'):
            self.call(1)

    def test_existing_tax_rows_block_second_repair(self):
        self.order.taxes = [{'rate': 18}]
        with self.assertRaisesRegex(ValueError, 'already has tax rows'):
            self.call(1)

    def test_total_increase_blocks_save(self):
        self.order.calculate_taxes_and_totals = lambda: setattr(self.order, 'grand_total', 139.24)
        with self.assertRaisesRegex(ValueError, 'total changed'):
            self.call(1)
        self.order.save.assert_not_called()

    def test_advance_change_is_rejected(self):
        self.order.save.side_effect = lambda: setattr(self.order, 'advance_paid', 0)
        with self.assertRaisesRegex(ValueError, 'advance changed'):
            self.call(1)
        self.order.add_comment.assert_not_called()

    def test_future_submission_rejects_added_vat(self):
        self.order.pos_profile = 'Till'
        self.order.grand_total = 139.24
        with self.assertRaisesRegex(ValueError, 'total changed'):
            self.env['_check_inclusive_order_total'](self.order, 118)

    def test_future_exclusive_submission_keeps_normal_tax_behavior(self):
        self.order.pos_profile = 'Till'
        self.order.grand_total = 139.24
        self.frappe.get_cached_value.return_value = 0
        self.env['_check_inclusive_order_total'](self.order, 118)

    def test_original_exclusive_profile_blocks_repair(self):
        self.frappe.get_cached_value.return_value = 0
        with self.assertRaisesRegex(ValueError, 'VAT-inclusive'):
            self.call(1)


if __name__ == '__main__':
    unittest.main()
