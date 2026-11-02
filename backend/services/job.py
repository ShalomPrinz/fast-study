import ctypes
import logging
import sys
from ctypes import wintypes

log = logging.getLogger("job")

_JobObjectExtendedLimitInformation = 9
_KILL_ON_JOB_CLOSE = 0x2000
_BREAKAWAY_OK = 0x800

# Held for the process's life: the OS closing it at exit is what kills the job's members.
_job = None


class _BasicLimits(ctypes.Structure):
    _fields_ = [
        ("PerProcessUserTimeLimit", ctypes.c_int64),
        ("PerJobUserTimeLimit", ctypes.c_int64),
        ("LimitFlags", ctypes.c_uint32),
        ("MinimumWorkingSetSize", ctypes.c_size_t),
        ("MaximumWorkingSetSize", ctypes.c_size_t),
        ("ActiveProcessLimit", ctypes.c_uint32),
        ("Affinity", ctypes.c_size_t),
        ("PriorityClass", ctypes.c_uint32),
        ("SchedulingClass", ctypes.c_uint32),
    ]


class _IoCounters(ctypes.Structure):
    _fields_ = [(n, ctypes.c_uint64) for n in ("r", "w", "o", "rb", "wb", "ob")]


class _ExtendedLimits(ctypes.Structure):
    _fields_ = [
        ("BasicLimitInformation", _BasicLimits),
        ("IoInfo", _IoCounters),
        ("ProcessMemoryLimit", ctypes.c_size_t),
        ("JobMemoryLimit", ctypes.c_size_t),
        ("PeakProcessMemoryUsed", ctypes.c_size_t),
        ("PeakJobMemoryUsed", ctypes.c_size_t),
    ]


def join_kill_on_close_job() -> None:
    """Windows only: join a kill-on-close job so ffmpeg/pandoc/tectonic die with this process."""

    global _job
    if sys.platform != "win32" or _job is not None:
        return
    k32 = ctypes.WinDLL("kernel32", use_last_error=True)
    k32.CreateJobObjectW.argtypes = [ctypes.c_void_p, wintypes.LPCWSTR]
    k32.CreateJobObjectW.restype = wintypes.HANDLE
    k32.SetInformationJobObject.argtypes = [
        wintypes.HANDLE,
        ctypes.c_int,
        ctypes.c_void_p,
        wintypes.DWORD,
    ]
    k32.SetInformationJobObject.restype = wintypes.BOOL
    k32.AssignProcessToJobObject.argtypes = [wintypes.HANDLE, wintypes.HANDLE]
    k32.AssignProcessToJobObject.restype = wintypes.BOOL
    k32.CloseHandle.argtypes = [wintypes.HANDLE]
    k32.CloseHandle.restype = wintypes.BOOL
    k32.GetCurrentProcess.argtypes = []
    k32.GetCurrentProcess.restype = wintypes.HANDLE

    job = k32.CreateJobObjectW(None, None)
    if not job:
        log.error(
            f"CreateJobObjectW failed (error {ctypes.get_last_error()}); children outlive a dead backend"
        )
        return
    info = _ExtendedLimits()
    info.BasicLimitInformation.LimitFlags = _KILL_ON_JOB_CLOSE | _BREAKAWAY_OK
    if not k32.SetInformationJobObject(
        job, _JobObjectExtendedLimitInformation, ctypes.byref(info), ctypes.sizeof(info)
    ):
        log.error(
            f"SetInformationJobObject failed (error {ctypes.get_last_error()}); children outlive a dead backend"
        )
        k32.CloseHandle(job)
        return
    if not k32.AssignProcessToJobObject(job, k32.GetCurrentProcess()):
        log.error(
            f"AssignProcessToJobObject failed (error {ctypes.get_last_error()}); children outlive a dead backend"
        )
        k32.CloseHandle(job)
        return
    _job = job
