"""PDF mathematical Unicode regression; no runtime documents required."""
import importlib
from pathlib import Path
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "agent/skills/pdf-reader/scripts"))


class PdfInfoTest(unittest.TestCase):
    def test_mathematical_alphanumeric_unicode_range(self):
        class Doc(list):
            metadata = {}
            closed = False
            def get_toc(self): return []
            def close(self): self.closed = True

        text = "\U0001D400\U0001D7FF\U0001D3FF\U0001D800a∫"
        doc = Doc([SimpleNamespace(get_text=lambda: text, get_images=lambda **kw: [])])
        with patch.dict(sys.modules, {"pymupdf": SimpleNamespace(open=lambda _: doc)}):
            pdf_info = importlib.import_module("pdf_info")
            result = pdf_info.analyze("synthetic.pdf")
        self.assertEqual(result["pages"][0]["math_density"], 0.5)
        self.assertTrue(doc.closed)


if __name__ == "__main__":
    unittest.main()
