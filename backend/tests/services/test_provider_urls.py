"""Where every Groq and Gemini request goes, pinned as literals against the real SDK clients
with only the wire intercepted — and proof that no ambient variable can move them."""

import httpx
import pytest
import requests
import transcribe
from services import providers
from services.llm_client import LLMClient

# Every variable an SDK reads to redirect a call; unset in the "clean" run so a developer's
# shell cannot make the literals pass or fail by accident.
AMBIENT = {
    "GROQ_BASE_URL": "http://127.0.0.1:9",
    "GOOGLE_GEMINI_BASE_URL": "http://127.0.0.1:9",
    "GOOGLE_VERTEX_BASE_URL": "http://127.0.0.1:9",
    "GOOGLE_GENAI_USE_VERTEXAI": "true",
    "GOOGLE_GENAI_USE_ENTERPRISE": "true",
}

UPLOAD_URL = (
    "https://generativelanguage.googleapis.com/upload/v1beta/files?upload_id=u1"
)


# Each variable alone as well as all at once: with Vertex on, the SDK reads the Vertex base
# URL instead, so only a solo run proves GOOGLE_GEMINI_BASE_URL is ignored.
@pytest.fixture(params=["clean", *AMBIENT, "all"])
def env(request, monkeypatch):
    for var in (
        *AMBIENT,
        "GOOGLE_API_KEY",
        "GOOGLE_CLOUD_PROJECT",
        "GOOGLE_CLOUD_LOCATION",
    ):
        monkeypatch.delenv(var, raising=False)
    for var, value in AMBIENT.items():
        if request.param in (var, "all"):
            monkeypatch.setenv(var, value)


def _canned(request: httpx.Request) -> httpx.Response:
    """The smallest well-formed reply each endpoint needs for the SDK call to complete."""

    url = str(request.url)
    if "audio/transcriptions" in url:
        return httpx.Response(200, text="שלום", request=request)
    if url == UPLOAD_URL:
        return httpx.Response(
            200,
            headers={"x-goog-upload-status": "final"},
            json={"file": {"name": "files/f1", "mimeType": "text/plain"}},
            request=request,
        )
    if "/upload/" in url:
        return httpx.Response(
            200, headers={"x-goog-upload-url": UPLOAD_URL}, json={}, request=request
        )
    if ":generateContent" in url:
        body = {
            "candidates": [{"content": {"role": "model", "parts": [{"text": "hi"}]}}]
        }
        return httpx.Response(200, json=body, request=request)
    return httpx.Response(200, json={}, request=request)


@pytest.fixture
def sent(monkeypatch):
    """Every httpx request either SDK sends, answered from _canned and never networked."""

    requests_seen: list[httpx.Request] = []

    def send(self, request, **kwargs):
        requests_seen.append(request)
        return _canned(request)

    monkeypatch.setattr(httpx.Client, "send", send)
    return requests_seen


class TestGroq:
    def test_transcription(self, env, sent, tmp_path, monkeypatch):
        monkeypatch.setenv("GROQ_API_KEY", "gsk_test")
        monkeypatch.setattr(transcribe, "get_duration", lambda _path: 60.0)

        def one_chunk(_audio, tmpdir, index, _seconds):
            path = tmp_path / f"chunk_{index}.mp3"
            path.write_bytes(b"ID3")
            return str(path)

        monkeypatch.setattr(transcribe, "split_one_chunk", one_chunk)
        audio = tmp_path / "audio.mp3"
        audio.write_bytes(b"ID3")

        assert transcribe.transcribe_audio(str(audio)) == "שלום"
        assert [(r.method, str(r.url)) for r in sent] == [
            ("POST", "https://api.groq.com/openai/v1/audio/transcriptions")
        ]
        assert sent[0].headers["Authorization"] == "Bearer gsk_test"


class TestGemini:
    def test_generate(self, env, sent):
        assert (
            LLMClient(model="gemini-test", api_key="AIza_test").generate(["x"]) == "hi"
        )
        assert [(r.method, str(r.url)) for r in sent] == [
            (
                "POST",
                "https://generativelanguage.googleapis.com/v1beta/models/gemini-test:generateContent",
            )
        ]
        assert sent[0].headers["x-goog-api-key"] == "AIza_test"

    def test_upload_file(self, env, sent, tmp_path):
        path = tmp_path / "transcript.txt"
        path.write_text("שלום", encoding="utf-8")

        LLMClient(model="gemini-test", api_key="AIza_test").upload_file(
            path, "text/plain"
        )
        assert [(r.method, str(r.url)) for r in sent] == [
            ("POST", "https://generativelanguage.googleapis.com/upload/v1beta/files"),
            ("POST", UPLOAD_URL),
        ]
        assert sent[0].headers["x-goog-api-key"] == "AIza_test"

    def test_delete_file(self, env, sent):
        LLMClient(model="gemini-test", api_key="AIza_test").delete_file("files/f1")
        assert [(r.method, str(r.url)) for r in sent] == [
            ("DELETE", "https://generativelanguage.googleapis.com/v1beta/files/f1")
        ]
        assert sent[0].headers["x-goog-api-key"] == "AIza_test"


class TestProbe:
    @pytest.mark.parametrize(
        "provider, url, header, value",
        [
            (
                "groq",
                "https://api.groq.com/openai/v1/models",
                "Authorization",
                "Bearer k",
            ),
            (
                "gemini",
                "https://generativelanguage.googleapis.com/v1beta/models",
                "x-goog-api-key",
                "k",
            ),
        ],
    )
    def test_probe(self, env, monkeypatch, provider, url, header, value):
        seen: list[requests.PreparedRequest] = []

        def send(self, request, **kwargs):
            seen.append(request)
            response = requests.Response()
            response.status_code = 200
            response.request = request
            return response

        monkeypatch.setattr(requests.adapters.HTTPAdapter, "send", send)

        assert providers.probe_key(provider, "k") == "valid"
        assert [(r.method, r.url) for r in seen] == [("GET", url)]
        assert seen[0].headers[header] == value
