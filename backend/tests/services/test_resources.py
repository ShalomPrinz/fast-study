import importlib
import sys
from pathlib import Path

import services.resources as resources


class TestResourcePath:
    def test_resolves_against_the_backend_root_in_dev(self):
        assert resources.resource_path("assets", "fonts").is_dir()
        assert resources.resource_path("credentials.json").name == "credentials.json"

    def test_joins_onto_meipass_when_frozen(self, tmp_path, monkeypatch):
        monkeypatch.setattr(sys, "_MEIPASS", str(tmp_path), raising=False)
        frozen = importlib.reload(resources)
        try:
            assert frozen.resource_path("assets", "fonts") == tmp_path / "assets/fonts"
        finally:
            monkeypatch.undo()
            importlib.reload(resources)

    def test_no_parts_gives_the_root_itself(self):
        assert resources.resource_path() == Path(resources._ROOT)
