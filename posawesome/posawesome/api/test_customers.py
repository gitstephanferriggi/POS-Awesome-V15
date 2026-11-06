import importlib.util
import json
import pathlib
import sys
import types
import unittest
from datetime import datetime
from types import SimpleNamespace


REPO_ROOT = pathlib.Path(__file__).resolve().parents[3]
CUSTOMERS_API_PATH = REPO_ROOT / "posawesome" / "posawesome" / "api" / "customers.py"


class AttrDict(dict):
    __getattr__ = dict.get


def _install_stubs():
    frappe_module = types.ModuleType("frappe")
    frappe_utils_module = types.ModuleType("frappe.utils")
    frappe_caching_module = types.ModuleType("frappe.utils.caching")
    erpnext_loyalty_module = types.ModuleType(
        "erpnext.accounts.doctype.loyalty_program.loyalty_program"
    )
    api_utils_module = types.ModuleType("posawesome.posawesome.api.utils")
    stored_value_module = types.ModuleType("posawesome.posawesome.api.stored_value")

    state = {
        "loyalty_detail_calls": 0,
        "get_all_calls": [],
        "contacts": [],
        "changed_contacts": [],
        "sql_calls": [],
    }

    def get_all(doctype, **kwargs):
        state["get_all_calls"].append((doctype, kwargs))
        if doctype == "Customer":
            return [
                AttrDict(
                    {
                        "name": "CUST-001",
                        "modified": "2026-05-21 10:00:00",
                        "customer_name": "Alpha Customer",
                        "loyalty_program": "Retail Loyalty",
                        "default_price_list": "Standard Selling",
                    }
                )
            ]
        return []

    def get_loyalty_program_details_with_points(*args, **kwargs):
        state["loyalty_detail_calls"] += 1
        raise AssertionError("Bulk customer sync must not fetch loyalty point balances")

    frappe_module._ = lambda text: text
    frappe_module.whitelist = lambda *args, **kwargs: (lambda fn: fn)
    frappe_module.throw = lambda message: (_ for _ in ()).throw(Exception(message))
    frappe_module.get_all = get_all
    frappe_module.get_doc = lambda *args, **kwargs: None
    frappe_module.get_value = lambda *args, **kwargs: None
    def sql(query, values, as_dict=False):
        state["sql_calls"].append((query, values))
        return state["changed_contacts"] if "SELECT DISTINCT" in query else state["contacts"]

    frappe_module.db = SimpleNamespace(
        sql=sql,
        get_value=lambda *args, **kwargs: None,
        count=lambda *args, **kwargs: 0,
        escape=lambda value: f"'{value}'",
    )

    frappe_utils_module.nowdate = lambda: "2026-05-21"
    frappe_utils_module.flt = lambda value=0, precision=None: float(value or 0)
    frappe_utils_module.cstr = lambda value="": "" if value is None else str(value)
    frappe_utils_module.get_datetime = lambda value: datetime.fromisoformat(value) if isinstance(value, str) else value
    frappe_caching_module.redis_cache = lambda ttl=None: (lambda fn: fn)
    erpnext_loyalty_module.get_loyalty_program_details_with_points = (
        get_loyalty_program_details_with_points
    )
    api_utils_module.assert_pos_profile_write_allowed = lambda *args, **kwargs: None
    api_utils_module.fetch_sales_person_names = lambda *args, **kwargs: []
    stored_value_module.get_stored_value_summary = lambda *args, **kwargs: {}

    sys.modules["frappe"] = frappe_module
    sys.modules["frappe.utils"] = frappe_utils_module
    sys.modules["frappe.utils.caching"] = frappe_caching_module
    sys.modules[
        "erpnext.accounts.doctype.loyalty_program.loyalty_program"
    ] = erpnext_loyalty_module
    sys.modules["posawesome.posawesome.api.utils"] = api_utils_module
    sys.modules["posawesome.posawesome.api.stored_value"] = stored_value_module

    return state


def _load_module():
    module_name = "posawesome.posawesome.api.customers"
    spec = importlib.util.spec_from_file_location(module_name, CUSTOMERS_API_PATH)
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    return module


class TestCustomersApi(unittest.TestCase):
    def test_balance_distinguishes_unavailable_native_summary_from_real_zero(self):
        party = types.ModuleType('erpnext.accounts.party')
        sys.modules['erpnext.accounts.party'] = party
        self.module.frappe.log_error = lambda *args: None
        self.module.frappe.get_traceback = lambda: 'synthetic failure'
        self.module.frappe.db.get_value = lambda *args, **kwargs: 'Private customer'
        for summary, expected, visible in [
            (None, None, False), ([], None, True),
            ([{'company': 'MDF', 'total_unpaid': None}], None, True),
            ([{'company': 'OTHER', 'total_unpaid': 100}], None, True),
            ([{'company': 'MDF', 'total_unpaid': 0, 'currency': 'EUR'}], 0, True),
            ([{'company': 'MDF', 'total_unpaid': 125.50, 'currency': 'EUR'}], 125.50, True),
        ]:
            with self.subTest(summary=summary):
                party.get_dashboard_info = lambda *args: summary
                result = self.module.get_customer_balance('CUST', company='MDF')
                self.assertEqual(result['balance'], expected)
                self.assertEqual(result['customer_name'] is not None, visible)

    def test_balance_failure_never_claims_customer_has_zero_balance(self):
        party = types.ModuleType('erpnext.accounts.party')
        sys.modules['erpnext.accounts.party'] = party
        def fail(*args): raise PermissionError('Synthetic denied summary')
        party.get_dashboard_info = fail
        self.module.frappe.log_error = lambda *args: None
        self.module.frappe.get_traceback = lambda: 'synthetic failure'
        self.assertEqual(self.module.get_customer_balance('CUST', company='MDF'),
                         {'balance': None, 'customer_name': None, 'currency': None})

    def setUp(self):
        self._orig_sys_modules = sys.modules.copy()
        self.state = _install_stubs()
        self.module = _load_module()

    def tearDown(self):
        sys.modules.clear()
        sys.modules.update(self._orig_sys_modules)

    def test_customer_list_does_not_fetch_loyalty_balances_per_customer(self):
        rows = self.module.get_customer_names(
            json.dumps({"name": "POS-TEST"}),
            limit=1000,
        )

        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["name"], "CUST-001")
        self.assertEqual(rows[0]["loyalty_program"], "Retail Loyalty")
        self.assertNotIn("loyalty_points", rows[0])
        self.assertNotIn("conversion_factor", rows[0])
        self.assertEqual(self.state["loyalty_detail_calls"], 0)


    def test_linked_phone_is_not_reclassified_as_mobile(self):
        self.state["contacts"] = [AttrDict(link_name="CUST-001", phone="+356 9912 3456", mobile_no="", modified="2026-11-02 12:00:00")]
        rows = self.module.get_customer_names(json.dumps({"name": "POS-TEST"}), limit=1000)
        self.assertEqual(rows[0]["phone"], "+356 9912 3456")
        self.assertFalse(rows[0].get("mobile_no"))
        self.assertEqual(rows[0]["contact_numbers"], ["+356 9912 3456"])
        self.assertEqual(rows[0]["modified"], "2026-11-02 12:00:00")
        self.assertEqual(len(self.state["sql_calls"]), 1)
        self.assertEqual(self.state["sql_calls"][0][1], {"names": ("CUST-001",)})

    def test_preserves_master_mobile_and_searches_secondary_contact_channels(self):
        self.state["contacts"] = [
            AttrDict(link_name="CUST-001", phone="2123 4567", mobile_no="9912 3456", modified=None),
            AttrDict(link_name="CUST-001", phone="2123 4567", mobile_no="9922 3344", modified=None),
            AttrDict(link_name="OTHER", phone="SECRET", mobile_no="", modified=None),
        ]
        original = {"name": "CUST-001", "mobile_no": "9944 5566"}
        result = self.module._with_linked_customer_phones([original])[0]
        self.assertEqual(result["mobile_no"], "9944 5566")
        self.assertEqual(result["contact_numbers"], ["9944 5566", "9912 3456", "2123 4567", "9922 3344"])
        self.assertEqual(original, {"name": "CUST-001", "mobile_no": "9944 5566"})

    def test_no_contacts_returns_empty_channels_without_crashing(self):
        result = self.module._with_linked_customer_phones([{"name": "CUST-001"}])[0]
        self.assertEqual(result["phone"], "")
        self.assertEqual(result["contact_numbers"], [])
        self.assertEqual(self.module._with_linked_customer_phones([]), [])

    def test_incremental_sync_includes_contact_edits_and_keeps_profile_scope_and_cursor(self):
        self.state["changed_contacts"] = [AttrDict(link_name="CUST-001")]
        self.module.get_customer_names(json.dumps({"name": "POS-TEST"}), limit=1000,
                                       start_after="CUST-000", modified_after="2026-11-01 00:00:00")
        _, args = self.state["get_all_calls"][-1]
        self.assertEqual(args["filters"], {"disabled": 0, "name": [">", "CUST-000"]})
        self.assertEqual(args["or_filters"], [["modified", ">", "2026-11-01T00:00:00"], ["name", "in", ["CUST-001"]]])

    def test_incremental_sync_without_contact_changes_retains_customer_watermark(self):
        self.module.get_customer_names(json.dumps({"name": "POS-TEST"}), limit=1000,
                                       modified_after="2026-11-01 00:00:00")
        _, args = self.state["get_all_calls"][-1]
        self.assertEqual(args["filters"]["modified"], [">", "2026-11-01T00:00:00"])
        self.assertIsNone(args["or_filters"])


    def test_customer_update_preserves_removed_form_fields(self):
        customer = SimpleNamespace(name="CUST-001", gender="Existing gender", posa_referral_code="Existing code", posa_birthday="1990-01-01", save=lambda: None)
        self.module.frappe.get_doc = lambda *args: customer
        result = self.module.create_customer("Existing customer", "Test Co", "{}", customer_id="CUST-001", method="update")
        self.assertEqual(result.gender, "Existing gender")
        self.assertEqual(result.posa_referral_code, "Existing code")
        self.assertEqual(result.posa_birthday, "1990-01-01")


if __name__ == "__main__":
    unittest.main()
