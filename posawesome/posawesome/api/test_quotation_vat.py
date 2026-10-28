"""Quotation APIs must use the same VAT policy as POS Sales Orders."""
import ast
import json
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import Mock


class QuotationVATTests(unittest.TestCase):
    def setUp(self):
        path = Path(__file__).with_name('quotations.py')
        nodes = [n for n in ast.parse(path.read_text()).body if isinstance(n, ast.FunctionDef)]
        for node in nodes:
            node.decorator_list = []
        self.env = {'json': json}
        exec(compile(ast.Module(body=nodes, type_ignores=[]), str(path), 'exec'), self.env)
        self.doc = SimpleNamespace(name='QTN', docstatus=1, flags=SimpleNamespace(), save=Mock(), submit=Mock())
        self.env['frappe'] = SimpleNamespace(get_doc=Mock(return_value=self.doc), flags=SimpleNamespace())
        self.env['apply_pos_tax_inclusion_contract'] = Mock()
        self.env['check_pos_inclusive_total'] = Mock()
        self.payload = json.dumps({'doctype': 'Quotation', 'pos_profile': 'Till', 'grand_total': 118, 'items': []})

    def test_draft_quotation_gets_tax_policy_and_total_guard(self):
        self.env['update_quotation'](self.payload)
        self.env['apply_pos_tax_inclusion_contract'].assert_called_once_with(self.doc)
        self.env['check_pos_inclusive_total'].assert_called_once_with(self.doc, 118)

    def test_submitted_quotation_gets_policy_and_guards_before_and_after_submit(self):
        self.env['submit_quotation'](self.payload)
        self.env['apply_pos_tax_inclusion_contract'].assert_called_once_with(self.doc)
        self.assertEqual(self.env['check_pos_inclusive_total'].call_count, 2)
        self.doc.submit.assert_called_once()

    def test_unexpected_added_tax_stops_submission(self):
        self.env['check_pos_inclusive_total'].side_effect = ValueError('Total changed')
        with self.assertRaisesRegex(ValueError, 'Total changed'):
            self.env['submit_quotation'](self.payload)
        self.doc.submit.assert_not_called()

    def test_profile_is_persisted_through_quote_order_and_delivery_metadata(self):
        fields = json.loads((Path(__file__).parents[2] / 'fixtures/custom_field.json').read_text())
        for doctype in ('Quotation', 'Sales Order', 'Delivery Note'):
            field = next(f for f in fields if f.get('dt') == doctype and f.get('fieldname') == 'pos_profile')
            self.assertEqual(field['options'], 'POS Profile')
            self.assertFalse(field['no_copy'])


if __name__ == '__main__':
    unittest.main()
