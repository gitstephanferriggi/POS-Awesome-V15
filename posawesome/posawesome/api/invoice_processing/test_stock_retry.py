"""Only a safe pre-posting stock conflict can restart a submission transaction."""
import types
import unittest
from unittest.mock import Mock, patch

from posawesome.posawesome.api.invoice_processing import stock_retry


class StockSubmissionRetryTests(unittest.TestCase):
    def setUp(self):
        self.runtime = types.SimpleNamespace(flags=types.SimpleNamespace(posa_stock_retry_attempt='outer'),
            db=types.SimpleNamespace(rollback=Mock()), throw=Mock(side_effect=ValueError))
        self.scope = patch.object(stock_retry, 'frappe', self.runtime)
        self.scope.start()
        self.translation = patch.object(stock_retry, "_", lambda text: text)
        self.translation.start()
        self.addCleanup(self.translation.stop)
        self.addCleanup(self.scope.stop)

    def conflict(self):
        error = RuntimeError('current stock snapshot changed')
        error.posa_retry_before_stock_posting = True
        return error

    def test_fresh_transaction_retry_preserves_original_call_payload(self):
        calls = []
        @stock_retry.retry_stock_submission
        def submit(payload):
            calls.append((payload, self.runtime.flags.posa_stock_retry_attempt))
            if len(calls) == 1:
                raise self.conflict()
            return {'name': 'same-submission'}
        payload = '{"client_request_id":"stable"}'
        self.assertEqual(submit(payload), {'name': 'same-submission'})
        self.assertEqual(calls, [(payload, 0), (payload, 1)])
        self.runtime.db.rollback.assert_called_once()
        self.assertEqual(self.runtime.flags.posa_stock_retry_attempt, 'outer')

    def test_unmarked_payment_error_is_not_replayed(self):
        submit = Mock(side_effect=RuntimeError('payment state requires repair'))
        with self.assertRaisesRegex(RuntimeError, 'payment state'):
            stock_retry.retry_stock_submission(submit)()
        submit.assert_called_once()
        self.runtime.db.rollback.assert_not_called()

    def test_retry_is_bounded_and_reports_actionable_message(self):
        submit = Mock(side_effect=lambda: (_ for _ in ()).throw(self.conflict()))
        with self.assertRaises(ValueError):
            stock_retry.retry_stock_submission(submit)()
        self.assertEqual(submit.call_count, 3)
        self.assertEqual(self.runtime.db.rollback.call_count, 3)
        self.assertIn('Refresh availability', self.runtime.throw.call_args.args[0])
        self.assertEqual(self.runtime.flags.posa_stock_retry_attempt, 'outer')

    def test_nested_retry_scope_is_restored(self):
        @stock_retry.retry_stock_submission
        def inner():
            self.assertEqual(self.runtime.flags.posa_stock_retry_attempt, 0)
        @stock_retry.retry_stock_submission
        def outer():
            inner()
            self.assertEqual(self.runtime.flags.posa_stock_retry_attempt, 0)
        outer()
        self.assertEqual(self.runtime.flags.posa_stock_retry_attempt, 'outer')
