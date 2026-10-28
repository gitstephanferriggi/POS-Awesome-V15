"""Cache the configured receipt, checking profile/image permissions."""
import ast
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import Mock


class OfflinePrintContextTests(unittest.TestCase):
    def load(self, profile, template=None, letter=None, file=None):
        p=Path(__file__).with_name('print_formats.py')
        nodes=[n for n in ast.parse(p.read_text()).body if isinstance(n,ast.FunctionDef)]
        for n in nodes:n.decorator_list=[]
        docs={'POS Profile':profile,'Print Format':template,'Letter Head':letter,'File':file}
        env={'frappe':SimpleNamespace(get_doc=Mock(side_effect=lambda dt,n:docs[dt]))}
        exec(compile(ast.Module(body=nodes,type_ignores=[]),str(p),'exec'),env)
        return env['get_offline_print_context']

    def profile(self, fields):
        return SimpleNamespace(name='Shop',letter_head=fields.get('letter_head'),get=fields.get,check_permission=Mock())

    def test_caches_configured_layout_and_inlines_logo(self):
        p=self.profile({'print_format':'Normal','letter_head':'Shop Logo'})
        template=SimpleNamespace(html='<h1>Normal receipt</h1>',css='body{}',modified='2026-10-28')
        letter=SimpleNamespace(content='<img src="/files/logo.png">')
        image=SimpleNamespace(check_permission=Mock(),get_content=Mock(return_value=b'logo'))
        r=self.load(p,template,letter,image)('Shop')
        self.assertEqual(r['html'],template.html);self.assertIn('data:image/png;base64,',r['letter_head'])
        p.check_permission.assert_called_once_with('read');image.check_permission.assert_called_once_with('read')

    def test_unreadable_profile_denied(self):
        p=self.profile({});p.check_permission.side_effect=PermissionError('Denied')
        with self.assertRaises(PermissionError):self.load(p)('Shop')

    def test_missing_format_does_not_choose_another_shops_template(self):
        r=self.load(self.profile({}))('Shop');self.assertEqual(r['html'],'');self.assertIsNone(r['format'])

    def test_external_logo_is_not_fetched_by_server(self):
        p=self.profile({'print_format':'Normal','letter_head':'Logo'})
        template=SimpleNamespace(html='Receipt',css='',modified='today')
        r=self.load(p,template,SimpleNamespace(content='<img src="https://external.example/logo.png">'))('Shop')
        self.assertIn('https://external.example/',r['letter_head'])


if __name__=='__main__':unittest.main()
