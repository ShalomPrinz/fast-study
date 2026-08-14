"""Name sanitization: the rule that keeps Hebrew lecture titles legal on NTFS as well as ext4."""

import pytest
from fs import crud
from fs.paths import MAX_NAME_LEN, lecture_dir, safe_name


class TestSafeName:
    def test_drops_windows_illegal_characters(self):
        assert safe_name("שיעור 3: מבוא <א>") == "שיעור 3 מבוא א"

    def test_strips_trailing_dots_and_spaces(self):
        # Windows strips these itself, which would desync the returned name from disk.
        assert safe_name("Intro. . ") == "Intro"

    def test_suffixes_reserved_device_names_with_extension_too(self):
        assert safe_name("CON") == "CON_"
        assert safe_name("com1.txt") == "com1.txt_"

    def test_truncates_to_the_max_path_budget(self):
        assert len(safe_name("א" * 200)) == MAX_NAME_LEN

    def test_is_idempotent(self):
        for name in ("שיעור 3: מבוא", "CON", "Intro. ", "א" * 200):
            assert safe_name(safe_name(name)) == safe_name(name)

    def test_rejects_a_name_with_nothing_legal_left(self):
        with pytest.raises(ValueError):
            safe_name(" ?? ")


class TestSanitizedResolution:
    def test_create_lecture_writes_the_sanitized_dir(self, data_root):
        crud.create_lecture("Algo", "שיעור 3: מבוא", "lecture")

        assert (data_root / "Algo" / "שיעור 3 מבוא").is_dir()

    def test_the_raw_name_still_resolves_to_that_dir(self, data_root):
        crud.create_lecture("Algo", "שיעור 3: מבוא", "recitation")

        assert lecture_dir("Algo", "שיעור 3: מבוא", "recitation").is_dir()
