"""Analyze logic tests — analyze() and its PROMPT_DIR/LLMClient deps live in
course/analyze.py; overview.py is registry-only."""

from unittest.mock import MagicMock, patch

import pytest
from course import analyze as ca
from course import overview as ep
from course.overview import PatternExtractor
from services.llm_client import GeminiRateLimitError


class TestPromptFiles:
    def test_prompt_files_exist(self):
        # Each pattern extractor must have a prompt file where analyze looks for it
        # (immediate extractors have no Gemini prompt / prompt_file).
        for ext in ep.EXTRACTORS:
            if isinstance(ext, PatternExtractor):
                assert (ca.PROMPT_DIR / ext.prompt_file).is_file(), ext.slug


class TestAnalyze:
    """analyze() is glue over LLMClient — mocked client only, no network."""

    def _fake_client(self, text="ניתוח"):
        client = MagicMock()
        client.generate.return_value = text
        return client

    def test_contents_order_prompt_course_report(self):
        ext = ep.EXTRACTORS_BY_SLUG["pitfalls"]
        fake = self._fake_client()
        with patch.object(ca, "LLMClient", return_value=fake) as ctor:
            result = ca.analyze(ext, "REPORT TEXT", "מבני נתונים")

        ctor.assert_called_once_with()
        contents = fake.generate.call_args.args[0]
        assert contents[0] == (ca.PROMPT_DIR / ext.prompt_file).read_text(
            encoding="utf-8"
        )
        assert "מבני נתונים" in contents[1]
        assert contents[2] == "REPORT TEXT"
        assert result == "ניתוח"

    def test_an_api_failure_names_itself_with_the_providers_text_as_detail(self):
        fake = MagicMock()
        fake.generate.side_effect = RuntimeError("500 fake gemini is down")
        with patch.object(ca, "LLMClient", return_value=fake):
            with pytest.raises(RuntimeError, match="fake gemini is down") as e:
                ca.analyze(ep.EXTRACTORS[0], "report", "קורס")
        assert (e.value.code, e.value.params) == (
            "analysis_failed",
            {"detail": "500 fake gemini is down"},
        )

    def test_a_quota_hit_keeps_its_own_code(self):
        quota = GeminiRateLimitError(
            {"message": "quota", "is_daily": True, "quota_id": None, "model": "m"}
        )
        fake = MagicMock()
        fake.generate.side_effect = quota
        with patch.object(ca, "LLMClient", return_value=fake):
            with pytest.raises(GeminiRateLimitError) as e:
                ca.analyze(ep.EXTRACTORS[0], "report", "קורס")
        assert e.value.code == "gemini_quota_exhausted"
