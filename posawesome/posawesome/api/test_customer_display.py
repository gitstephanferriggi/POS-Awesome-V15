import importlib.util
import pathlib
import sys
import types
import unittest
from unittest.mock import patch


class TestCustomerDisplayAdverts(unittest.TestCase):
    def test_server_enforces_limit_even_when_adverts_are_disabled(self):
        frappe_stub = types.ModuleType("frappe")
        frappe_stub._ = lambda text: text

        def throw(message):
            raise ValueError(message)

        frappe_stub.throw = throw
        spec = importlib.util.spec_from_file_location(
            "customer_display_under_test", pathlib.Path(__file__).with_name("customer_display.py")
        )
        module = importlib.util.module_from_spec(spec)
        with patch.dict(sys.modules, {"frappe": frappe_stub}):
            spec.loader.exec_module(module)
        for count in (0, 1, 2, 10):
            module.validate_adverts({"posa_customer_display_adverts": [{}] * count})
        module.validate_adverts({})
        with self.assertRaisesRegex(ValueError, "maximum of 10"):
            module.validate_adverts({
                "posa_enable_customer_display_adverts": 0,
                "posa_customer_display_adverts": [{}] * 11,
            })


if __name__ == "__main__":
    unittest.main()
