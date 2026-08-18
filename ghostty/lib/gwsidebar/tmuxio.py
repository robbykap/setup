"""The only module that talks to the tmux binary. Injectable runner keeps callers testable."""

import subprocess

DEFAULT_SESSION = "gw"


def _default_runner(args, **kwargs):
    try:
        return subprocess.run(args, capture_output=True, text=True, check=False, **kwargs)
    except OSError as error:
        return subprocess.CompletedProcess(args, 127, "", str(error))


def run(*args, runner=None):
    runner = runner or _default_runner
    return runner(["tmux", *args])


def query(fmt: str, runner=None) -> str:
    result = run("display-message", "-p", fmt, runner=runner)
    if result.returncode != 0:
        return ""
    return (result.stdout or "").strip()


def session_name(runner=None) -> str:
    return query("#{session_name}", runner=runner) or DEFAULT_SESSION
