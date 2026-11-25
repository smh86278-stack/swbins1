"""맡긴 일 체크포인트 — 「이 작업 전으로 되돌리기」(2026-11-26, Conductor·opcode 결).

작업 폴더가 git 저장소면 claude -p 직전(before)·끝난 뒤(after)의 파일 상태를 refs/dnc/<작업 id>/<before|after> 에 남긴다.
임시 인덱스(GIT_INDEX_FILE)로만 만들므로 사용자의 작업 트리·인덱스·브랜치는 건드리지 않고, 브랜치가 아니라 push 에도 안 실린다.
되돌리기는 before→after 사이에 바뀐 경로만, 지금 파일이 after 와 같을 때만 before 로 돌린다(그 뒤 사람이 또 고친 파일은 건너뛰고 알린다).
inbox-worker.ps1 의 Save-DncCheckpoint 도 같은 이름·같은 방식으로 남긴다.
"""
import os
import re
import subprocess
import tempfile
import uuid

KEEP = 40                       # 저장소마다 남기는 작업 수(작업마다 before·after 둘)
ID_RE = re.compile(r"[\w\-]{1,80}")
WRITE_RE = re.compile(r"^(Edit|Write|MultiEdit|NotebookEdit|Bash)\b")
_NOWIN = 0x08000000 if os.name == "nt" else 0
_ENV = {"GIT_AUTHOR_NAME": "D&C", "GIT_AUTHOR_EMAIL": "dnc@localhost", "GIT_COMMITTER_NAME": "D&C",
        "GIT_COMMITTER_EMAIL": "dnc@localhost", "GIT_TERMINAL_PROMPT": "0"}


def writes(tools):
    """파일을 바꿀 수 있는 작업인가(읽기 지시엔 스냅샷을 뜨지 않는다)."""
    return any(WRITE_RE.match(str(t)) for t in tools or [])


def _git(cwd, *args, env=None, data=None, timeout=120):
    e = dict(os.environ, **_ENV)
    e.pop("GIT_INDEX_FILE", None)
    if env:
        e.update(env)
    try:
        p = subprocess.run(["git", "-C", cwd] + list(args), input=data, capture_output=True, timeout=timeout,
                           env=e, creationflags=_NOWIN)
    except (OSError, subprocess.SubprocessError):
        return None
    return p.stdout if p.returncode == 0 else None


def _txt(b):
    return b.decode("utf-8", "replace").strip() if b is not None else None


def top(folder):
    if not folder or not os.path.isdir(folder):
        return None
    return _txt(_git(folder, "rev-parse", "--show-toplevel")) or None


def ref(job_id, tag):
    return "refs/dnc/%s/%s" % (job_id, tag)


def snap(folder, job_id, tag):
    """지금 파일 상태를 refs/dnc/<id>/<tag> 에 남긴다 → 커밋 해시(저장소가 아니거나 실패하면 None)."""
    if not ID_RE.fullmatch(str(job_id or "")) or tag not in ("before", "after"):
        return None
    root = top(folder)
    if not root:
        return None
    idx = os.path.join(tempfile.gettempdir(), "dnc-idx-%s" % uuid.uuid4().hex)
    env = {"GIT_INDEX_FILE": idx}
    try:
        head = _txt(_git(root, "rev-parse", "--verify", "-q", "HEAD"))
        if head and _git(root, "read-tree", "HEAD", env=env) is None:
            return None
        if _git(root, "add", "-A", env=env, timeout=300) is None:
            return None
        tree = _txt(_git(root, "write-tree", env=env))
        if not tree:
            return None
        c = _txt(_git(root, "commit-tree", tree, *(["-p", head] if head else []), "-m", "D&C %s %s" % (job_id, tag)))
        if not c or _git(root, "update-ref", ref(job_id, tag), c) is None:
            return None
        if tag == "after":
            prune(root)
        return c
    finally:
        for f in (idx, idx + ".lock"):
            try:
                os.remove(f)
            except OSError:
                pass


def prune(root, keep=KEEP):
    """작업이 keep 개를 넘으면 오래된 작업의 refs 를 지운다."""
    out = _txt(_git(root, "for-each-ref", "--sort=-creatordate", "--format=%(refname)", "refs/dnc/"))
    if not out:
        return 0
    jobs, gone = [], 0
    for r in out.splitlines():
        j = r.split("/")[2] if r.count("/") >= 3 else ""
        if j and j not in jobs:
            jobs.append(j)
    for j in jobs[keep:]:
        for tag in ("before", "after"):
            if _git(root, "update-ref", "-d", ref(j, tag)) is not None:
                gone += 1
    return gone


def _rev(root, name):
    return _txt(_git(root, "rev-parse", "--verify", "-q", name + "^{commit}"))


def info(folder, job_id):
    """화면용 — {"repo": 저장소인가, "before": 있나, "after": 있나, "n": 바뀐 파일 수}."""
    out = {"repo": False, "before": False, "after": False, "n": 0}
    if not ID_RE.fullmatch(str(job_id or "")):
        return out
    root = top(folder)
    if not root:
        return out
    out["repo"] = True
    b, a = _rev(root, ref(job_id, "before")), _rev(root, ref(job_id, "after"))
    out["before"], out["after"] = bool(b), bool(a)
    if b and a:
        out["n"] = len(changes(root, b, a))
    return out


def changes(root, b, a):
    """before→after 사이에 바뀐 [(상태, 경로)] — 경로는 저장소 기준(/)."""
    raw = _git(root, "diff-tree", "-r", "--no-renames", "--name-status", "-z", b, a)
    if raw is None:
        return []
    parts = raw.decode("utf-8", "replace").split("\0")
    return [(parts[i], parts[i + 1]) for i in range(0, len(parts) - 1, 2) if parts[i]]


def _blob(root, commit, path):
    return _txt(_git(root, "rev-parse", "--verify", "-q", "%s:%s" % (commit, path)))


def restore(folder, job_id):
    """그 작업이 바꾼 파일을 작업 전으로 → {"ok", "reverted": [...], "removed": [...], "skipped": [{path, why}]}."""
    if not ID_RE.fullmatch(str(job_id or "")):
        raise ValueError("작업 번호가 올바르지 않습니다")
    root = top(folder)
    if not root:
        raise ValueError("git 저장소가 아닌 폴더라 되돌릴 수 없습니다")
    b, a = _rev(root, ref(job_id, "before")), _rev(root, ref(job_id, "after"))
    if not (b and a):
        raise ValueError("이 작업의 체크포인트가 없습니다(수정 허용 작업이 끝난 뒤에만 생깁니다)")
    reverted, removed, skipped = [], [], []
    idx = os.path.join(tempfile.gettempdir(), "dnc-idx-%s" % uuid.uuid4().hex)
    env = {"GIT_INDEX_FILE": idx}
    try:
        for st, path in changes(root, b, a):
            full = os.path.join(root, *path.split("/"))
            after_blob = _blob(root, a, path)
            if os.path.isfile(full):
                now = _txt(_git(root, "hash-object", "--path", path, "--", path))
            else:
                now = None
            if now != after_blob:                  # 작업 뒤에 또 바뀐 파일 — 손대지 않는다
                skipped.append({"path": path, "why": "작업 뒤에 또 바뀜" if now else "작업 뒤에 지워짐"})
                continue
            if _blob(root, b, path):                # 작업 전에 있던 파일 → 그 내용으로(임시 인덱스라 진짜 인덱스는 그대로)
                if _git(root, "checkout", b, "--", path, env=env) is None:
                    skipped.append({"path": path, "why": "되돌리지 못함"})
                else:
                    reverted.append(path)
            else:                                   # 작업이 새로 만든 파일 → 지운다
                try:
                    os.remove(full)
                    removed.append(path)
                except OSError:
                    skipped.append({"path": path, "why": "지우지 못함"})
    finally:
        for f in (idx, idx + ".lock"):
            try:
                os.remove(f)
            except OSError:
                pass
    return {"ok": True, "reverted": reverted, "removed": removed, "skipped": skipped}
