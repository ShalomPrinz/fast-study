"""Registry-shape tests for course/overview.py: the Extractor base + PatternExtractor /
ImmediateExtractor subclasses, per-type `phases` ClassVar (tuples of `Phase`), the `Phase`
value type, the phase-chain / output-filename helpers, and that Topics is registered."""

from course.overview import (
    ALL_SLUGS,
    EXTRACTORS,
    EXTRACTORS_BY_SLUG,
    Extractor,
    ImmediateExtractor,
    PatternExtractor,
    Phase,
)


class TestPhase:
    def test_id_and_suffix(self):
        assert (Phase.EXTRACT.id, Phase.EXTRACT.suffix) == ("extract", ".txt")
        assert (Phase.ANALYZE.id, Phase.ANALYZE.suffix) == ("analyze", ".md")
        assert (Phase.TOPICS.id, Phase.TOPICS.suffix) == ("topics", ".md")
        assert (Phase.TO_PDF.id, Phase.TO_PDF.suffix) == ("to_pdf", ".pdf")

    def test_from_id_round_trips(self):
        for p in Phase:
            assert Phase.from_id(p.id) is p

    def test_from_id_unknown_is_none(self):
        assert Phase.from_id("bogus") is None


class TestClassHierarchy:
    def test_subclasses_are_extractors(self):
        assert issubclass(PatternExtractor, Extractor)
        assert issubclass(ImmediateExtractor, Extractor)

    def test_phases_is_a_classvar_not_a_field(self):
        # phases lives on the class (behavior), so it is NOT a constructor argument (instance data).
        import inspect

        assert PatternExtractor.phases == (Phase.EXTRACT, Phase.ANALYZE, Phase.TO_PDF)
        assert ImmediateExtractor.phases == (Phase.TOPICS, Phase.TO_PDF)
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
        assert topics.phases == (Phase.TOPICS, Phase.TO_PDF)

    def test_all_slugs_and_declaration_order(self):
        assert ALL_SLUGS == ["exam-hints", "student-qa", "pitfalls", "topics"]
        assert [e.slug for e in EXTRACTORS] == ALL_SLUGS


class TestPhasesFrom:
    """`phases_from` computes the sub-chain to run; `output_file` names a phase's on-disk output."""

    def test_none_is_full_chain(self):
        exam = EXTRACTORS_BY_SLUG["exam-hints"]
        assert exam.phases_from(None) == (Phase.EXTRACT, Phase.ANALYZE, Phase.TO_PDF)

    def test_from_analyze_on_pattern_extractor(self):
        exam = EXTRACTORS_BY_SLUG["exam-hints"]
        assert exam.phases_from(Phase.ANALYZE) == (Phase.ANALYZE, Phase.TO_PDF)

    def test_from_to_pdf_on_pattern_extractor(self):
        exam = EXTRACTORS_BY_SLUG["exam-hints"]
        assert exam.phases_from(Phase.TO_PDF) == (Phase.TO_PDF,)

    def test_from_phase_not_in_chain_is_full_chain(self):
        # topics lacks EXTRACT/ANALYZE → a from_phase it doesn't declare falls back to its full chain.
        topics = EXTRACTORS_BY_SLUG["topics"]
        assert topics.phases_from(Phase.EXTRACT) == (Phase.TOPICS, Phase.TO_PDF)
        assert topics.phases_from(Phase.TOPICS) == (Phase.TOPICS, Phase.TO_PDF)

    def test_output_file_uses_slug_and_phase_suffix(self):
        exam = EXTRACTORS_BY_SLUG["exam-hints"]
        assert exam.output_file(Phase.EXTRACT) == "exam-hints.txt"
        assert exam.output_file(Phase.ANALYZE) == "exam-hints.md"
        topics = EXTRACTORS_BY_SLUG["topics"]
        assert topics.output_file(Phase.TO_PDF) == "topics.pdf"

    def test_phase_ids_are_the_wire_strings(self):
        # phase_ids serializes the phase chain without callers reaching into Phase.id themselves.
        assert EXTRACTORS_BY_SLUG["exam-hints"].phase_ids == (
            "extract",
            "analyze",
            "to_pdf",
        )
        assert EXTRACTORS_BY_SLUG["topics"].phase_ids == ("topics", "to_pdf")
