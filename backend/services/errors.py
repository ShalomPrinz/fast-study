"""The machine `code` + flat `params` every failure carries beside its English prose.
Vocabulary and the reasoning behind the split: docs/ERROR-CODES.md at the repo root."""


class CodedError(RuntimeError):
    """A failure naming itself: a stable `code` and flat `params` beside the developer-facing
    prose. Subclassed where a caller has to catch the failure by type."""

    # message/code are positional-only: `latex_error` carries a param literally named `message`.
    def __init__(self, message: str, code: str, /, **params):
        super().__init__(message)
        self.code = code
        self.params = params


def failure(message: str, code: str, /, **params) -> dict:
    """One failure body — the shape every non-2xx answers with."""

    return {"error": message, "code": code, "params": params}


def error_fields(exc: BaseException, fallback: str) -> tuple[str, dict]:
    """The (code, params) of any exception: its own when it carries them, else `fallback`
    with str(exc) as `detail` — third-party text never gets a code of its own."""

    if isinstance(exc, CodedError):
        return exc.code, exc.params
    return fallback, {"detail": str(exc)}
