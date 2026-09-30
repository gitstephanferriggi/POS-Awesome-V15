"""Isolated regression tests for Sales Order dates and deposit completion."""
import ast
import datetime
import json
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import Mock


def load_functions():
    tree = ast.parse(Path(__file__).with_name('sales_orders.py').read_text())
    functions = [n for n in tree.body if isinstance(n, ast.FunctionDef)]
    for function in functions:
        function.decorator_list = []
    env = {'json': json, 'getdate': lambda value: datetime.date.fromisoformat(str(value)),
           'nowdate': lambda: '2026-09-30'}
    exec(compile(ast.Module(body=functions, type_ignores=[]), 'sales_orders.py', 'exec'), env)
    return env


class SalesOrderRegressionTest(unittest.TestCase):
    def test_picker_replaces_inherited_dates_but_preserves_separate_schedule(self):
        env = load_functions()
        data = {'delivery_date': '2026-09-29', 'posa_delivery_date': '2026-10-05',
                'items': [{'delivery_date': '2026-09-29'},
                          {'delivery_date': '2026-10-08'}, {}]}
        env['_map_delivery_dates'](data)
        self.assertEqual(data['delivery_date'], '2026-10-05')
        self.assertEqual([x['delivery_date'] for x in data['items']],
                         ['2026-10-05', '2026-10-08', '2026-10-05'])
        env['_map_delivery_dates'](data)
        self.assertEqual(data['items'][1]['delivery_date'], '2026-10-08')

    def test_invalid_picker_falls_back(self):
        env = load_functions()
        data = {'posa_delivery_date': 'Invalid date', 'transaction_date': '2026-09-30', 'items': [{}]}
        env['_map_delivery_dates'](data)
        self.assertEqual(data['items'][0]['delivery_date'], '2026-09-30')

    def test_deposit_completed_before_success_and_failure_propagates(self):
        env = load_functions()
        doc = SimpleNamespace(name='SO-TEST', docstatus=1, flags=SimpleNamespace(),
                              save=Mock(), submit=Mock())
        env['frappe'] = SimpleNamespace(get_doc=Mock(return_value=doc), flags=SimpleNamespace())
        env['apply_pos_tax_inclusion_contract'] = Mock()
        payment = Mock()
        env['_create_payment_entries'] = payment
        payload = json.dumps({'payments': [{'amount': 10}], 'items': []})
        self.assertEqual(env['submit_sales_order'](payload)['status'], 1)
        payment.assert_called_once_with(doc, [{'amount': 10}])
        payment.side_effect = ValueError('Deposit rejected')
        with self.assertRaisesRegex(ValueError, 'Deposit rejected'):
            env['submit_sales_order'](payload)


if __name__ == '__main__':
    unittest.main()
