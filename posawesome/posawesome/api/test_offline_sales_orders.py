"""Offline orders must use the order/deposit contract, never invoice payment rows."""
import ast
import json
from pathlib import Path
from types import SimpleNamespace
import sys
import unittest
from unittest.mock import Mock, patch


def load():
    p=Path(__file__).parent/'invoice_processing/creation.py'
    nodes=[n for n in ast.parse(p.read_text()).body if isinstance(n,ast.FunctionDef)]
    for node in nodes:node.decorator_list=[]
    env={'json':json,'_':lambda s:s,'STATE_POST_SUBMIT_DONE':'POST_SUBMIT_DONE'}
    exec(compile(ast.Module(body=nodes,type_ignores=[]),str(p),'exec'),env)
    return env


class OfflineSalesOrderTests(unittest.TestCase):
    def setUp(self):
        self.env=load();self.ledger=SimpleNamespace(name='request-lock',reload=Mock(),flags=SimpleNamespace())
        self.db=SimpleNamespace(sql=Mock(),savepoint=Mock(),rollback=Mock())
        self.env['frappe']=SimpleNamespace(db=self.db,throw=lambda m:(_ for _ in ()).throw(ValueError(m)))
        self.env['_get_or_create_submission_ledger']=Mock(return_value=self.ledger)
        self.env['_ledger_final_replay_response']=Mock(return_value=None)
        self.env['_update_submission_ledger']=Mock()
        self.submit=Mock(return_value={'name':'SO-RECOVERED','status':1})
        self.module=SimpleNamespace(submit_sales_order=self.submit)
        self.invoice={'doctype':'Sales Order','posting_date':'2026-10-27','payments':[{'mode_of_payment':'Cash','amount':962.67}]}

    def call(self):
        with patch.dict(sys.modules,{'posawesome.posawesome.api.sales_orders':self.module}):
            return self.env['_submit_offline_sales_order'](dict(self.invoice),{},'original-request')

    def test_correct_flow_preserves_payment_and_original_dates(self):
        result=self.call();payload=json.loads(self.submit.call_args.args[0])
        self.assertEqual(payload['payments'],self.invoice['payments'])
        self.assertEqual(payload['transaction_date'],'2026-10-27')
        self.assertEqual(self.submit.call_args.kwargs['payment_posting_date'],'2026-10-27')
        self.assertEqual(result['doctype'],'Sales Order');self.assertEqual(result['docstatus'],1)
        self.db.sql.assert_called_once();self.ledger.reload.assert_called_once()
        self.env['_update_submission_ledger'].assert_called_once_with(self.ledger,'POST_SUBMIT_DONE',invoice_name='SO-RECOVERED')

    def test_retry_returns_existing_order_without_another_deposit(self):
        response={'name':'SO-RECOVERED','docstatus':1}
        self.env['_ledger_final_replay_response'].return_value=response
        self.assertEqual(self.call(),response);self.submit.assert_not_called()

    def test_failed_deposit_rolls_back_order_and_never_marks_done(self):
        self.submit.side_effect=ValueError('Cash account invalid')
        with self.assertRaisesRegex(ValueError,'Cash account invalid'):self.call()
        self.db.rollback.assert_called_once_with(save_point='offline_sales_order')
        self.env['_update_submission_ledger'].assert_not_called()

    def test_cancelled_recovered_order_needs_review(self):
        self.env['_ledger_final_replay_response'].return_value={'docstatus':2}
        with self.assertRaises(ValueError):self.call()
        self.submit.assert_not_called()

    def test_submission_dispatches_before_invoice_conversion(self):
        dispatch=Mock(return_value={'name':'SO-RECOVERED'})
        self.env['_submit_offline_sales_order']=dispatch
        self.env['extract_invoice_client_request_id']=Mock(return_value='original-request')
        result=self.env['submit_invoice'](json.dumps(self.invoice),'{}')
        self.assertEqual(result['name'],'SO-RECOVERED')
        dispatch.assert_called_once_with(self.invoice,{},'original-request')


if __name__=='__main__':unittest.main()
