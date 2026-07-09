"""Registry-shape tests for course/overview.py: the Extractor base + PatternExtractor /
ImmediateExtractor subclasses, per-type `phases` ClassVar, and that Topics is registered."""

from course.overview import (
    ALL_SLUGS,
    EXTRACTORS,
    EXTRACTORS_BY_SLUG,
    Extractor,
    ImmediateExtractor,
    PatternExtractor,
)


class TestClassHierarchy:
    def test_subclasses_are_extractors(self):
        assert issubclass(PatternExtractor, Extractor)
        assert issubclass(ImmediateExtractor, Extractor)

    def test_phases_is_a_classvar_not_a_field(self):
        # phases lives on the class (behavior), so it is NOT a constructor argument (instance data).
        import inspect
        assert PatternExtractor.phases == ("extract", "analyze", "to_pdf")
        assert ImmediateExtractor.phases == ("topics", "to_pdf")
        assert Extractor.phases == ()
        assert "phases" not in inspect.signature(PatternExtractor).parameters
        assert "phases" not in inspect.signature(ImmediateExtractor).parameters

    def test_pattern_extractor_has_pattern_fields_and_prompt_file(self):
        ext = PatternExtractor(slug="x", title="X", patterns=("a",))
        assert ext.patterns == ("a",) and ext.before == 1 and ext.after == 3
        assert ext.prompt_file == "x.md"

    def test_immediate_extractor_has_no_pattern_attrs(self):
        ext = ImmediateExtractor(slug="topics", title="Topics")
        assert not hasattr(ext, "patterns")
        assert not hasattr(ext, "prompt_file")


class TestRegistry:
    def test_three_pattern_extractors(self):
        pattern = [e for e in EXTRACTORS if isinstance(e, PatternExtractor)]
        assert [e.slug for e in pattern] == ["exam-hints", "student-qa", "pitfalls"]

    def test_topics_registered_as_immediate(self):
        topics = EXTRACTORS_BY_SLUG["topics"]
        assert isinstance(topics, ImmediateExtractor)
        assert topics.title == "Topics"
        assert topics.phases == ("topics", "to_pdf")

    def test_all_slugs_and_declaration_order(self):
        assert ALL_SLUGS == ["exam-hints", "student-qa", "pitfalls", "topics"]
        assert [e.slug for e in EXTRACTORS] == ALL_SLUGS
