"""Contract checks for the JYSK bridge without a database or business writes."""
import ast
import pathlib
import sys
import types
import unittest
from unittest.mock import Mock,patch

class TestJyskBulkStock(unittest.TestCase):
    def setUp(self):
        source=pathlib.Path(__file__).parent/'item_processing'/'stock.py'
        tree=ast.parse(source.read_text())
        tree.body=[n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name=='_get_jysk_bulk_stock_availability']
        self.api=types.ModuleType('jysk_malta.api.stock');self.api.get_availability=Mock(return_value=[])
        self.db=types.SimpleNamespace(get_value=Mock(return_value=0),get_descendants=Mock(return_value=[]))
        self.batch=Mock(return_value=2)
        namespace={'frappe':types.SimpleNamespace(db=self.db),'flt':lambda x:float(x or 0),'cstr':lambda x:'' if x is None else str(x),'get_batch_qty':self.batch}
        exec(compile(tree,str(source),'exec'),namespace)
        self.read=namespace['_get_jysk_bulk_stock_availability']
        self.modules=patch.dict(sys.modules,{'jysk_malta.api.stock':self.api});self.modules.start();self.addCleanup(self.modules.stop)

    def test_ten_thousand_items_use_one_warehouse_read(self):
        self.api.get_availability.return_value=[{'item_code':'P000001','available_qty':7}]
        data=[{'item_code':f'P{i:06}','warehouse':'Lija'}for i in range(10000)]
        actual=self.read(data)
        self.assertEqual(len(actual),10000)
        self.assertEqual(actual[('P000001','Lija','')],7)
        self.assertEqual(actual[('P000002','Lija','')],0)
        self.api.get_availability.assert_called_once_with(warehouse='Lija')

    def test_group_and_leaf_share_reads_and_keep_reservation_aware_values(self):
        self.db.get_value.side_effect=lambda dt,name,field:int(name=='Group')
        self.db.get_descendants.return_value=['Lija','Qormi']
        self.api.get_availability.side_effect=lambda **kw:[{'item_code':'A','available_qty':3 if kw['warehouse']=='Lija'else 0}]
        actual=self.read([{'item_code':'A','warehouse':'Group'},{'item_code':'A','warehouse':'Lija'}])
        self.assertEqual(actual,{('A','Group',''):3,('A','Lija',''):3})
        self.assertEqual(self.api.get_availability.call_count,2)

    def test_batch_is_capped_by_available_reservation_balance(self):
        self.api.get_availability.return_value=[{'item_code':'A','available_qty':1}]
        actual=self.read([{'item_code':'A','warehouse':'Lija','batch_no':'BATCH'}])
        self.assertEqual(actual[('A','Lija','BATCH')],1)
        self.batch.assert_called_once_with('BATCH','Lija')

    def test_empty_group_does_not_fall_back_to_other_warehouses(self):
        self.db.get_value.return_value=1
        self.assertEqual(self.read([{'item_code':'A','warehouse':'Empty'}]),{('A','Empty',''):0})
        self.api.get_availability.assert_not_called()

    def test_blind_stock_access_rejection_is_not_suppressed(self):
        self.api.get_availability.side_effect=PermissionError('blind stock protection')
        with self.assertRaises(PermissionError):self.read([{'item_code':'A','warehouse':'Lija'}])

    def test_duplicate_requests_and_invalid_rows_do_not_add_queries(self):
        self.read([{'item_code':'A','warehouse':'Lija'},{'item_code':'A','warehouse':'Lija'},{'item_code':'A'},{'warehouse':'Lija'}])
        self.api.get_availability.assert_called_once_with(warehouse='Lija',item_code='A')

if __name__=='__main__':unittest.main()
