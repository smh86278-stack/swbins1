"""D&C 메신저 셋째 묶음 뒷부분(2026-11-26) — 서버 쪽 도우미.

  ④ diff_file        되돌리기 스냅샷(refs/dnc/<작업>/before..after)으로 바뀐 파일 하나의 차이
  ⑤ wt_*             따로 해 보기 — git worktree 에서 돌리고 [합치기]·[버리기]
  P4 side_*          옆 질문 — 일하는 세션을 --fork-session 으로 갈라 읽기 전용으로 답
  P7 limit_reset     사용 한도 오류에서 풀리는 시각 읽기
  P10 leftovers      끝난 작업이 남긴 프로세스(그 작업 시간대에 생겨 부모가 사라진 개발 도구)
사용자 작업 트리·브랜치를 바꾸는 동작(합치기·버리기·프로세스 끄기)은 화면의 확인 창을 거친 요청에서만 부른다.
"""
import json
import os
import re
import subprocess
import time
from datetime import datetime, timedelta

import checkpoint

IS_WIN = os.name == "nt"
_NOWIN = 0x08000000 if IS_WIN else 0
ID_RE = re.compile(r"[\w\-]{1,80}")


def _run(args, cwd=None, timeout=60, data=None):
    """(returncode, stdout, stderr) — git 은 사용자 이름(작성자)을 그대로 쓴다(checkpoint._git 은 D&C 이름)."""
    e = dict(os.environ, GIT_TERMINAL_PROMPT="0")
    e.pop("GIT_INDEX_FILE", None)
    try:
        p = subprocess.run(args, cwd=cwd, input=data, capture_output=True, timeout=timeout, env=e, creationflags=_NOWIN)
    except (OSError, subprocess.SubprocessError) as ex:
        return 1, "", str(ex)
    dec = lambda b: (b or b"").decode("utf-8", "replace").strip()
    return p.returncode, dec(p.stdout), dec(p.stderr)


# ------------------------------------------------------------------ ④ diff 보기
DIFF_MAX = 800                                   # 줄 — 넘으면 자른다


def _rel(root, path):
    p = str(path or "").replace("\\", "/")
    r = root.replace("\\", "/").rstrip("/")
    if p.lower().startswith(r.lower() + "/"):
        p = p[len(r) + 1:]
    return p.lstrip("/")


def diff_file(folder, job_id, path):
    """그 작업이 바꾼 파일 하나의 before→after 차이. 작업이 바꾼 파일이 아니면 ValueError."""
    if not ID_RE.fullmatch(str(job_id or "")):
        raise ValueError("작업이 없습니다")
    root = checkpoint.top(folder)
    if not root:
        raise ValueError("git 저장소가 아니라 차이를 볼 수 없습니다")
    b, a = checkpoint._rev(root, checkpoint.ref(job_id, "before")), checkpoint._rev(root, checkpoint.ref(job_id, "after"))
    if not (b and a):
        raise ValueError("이 작업의 스냅샷이 없습니다(이 기능 전에 끝난 작업)")
    changed = {p: st for st, p in checkpoint.changes(root, b, a)}
    rel = _rel(root, path)
    if rel not in changed:
        hit = [p for p in changed if p.lower() == rel.lower() or p.lower().endswith("/" + rel.lower())]
        if len(hit) != 1:
            raise ValueError("이 작업이 바꾼 파일이 아닙니다: %s" % rel)
        rel = hit[0]
    code, out, err = _run(["git", "-C", root, "diff", "--no-color", "--no-ext-diff", "-U3", b, a, "--", rel], timeout=60)
    lines = out.splitlines()
    return {"path": rel, "status": changed[rel], "diff": "\n".join(lines[:DIFF_MAX]), "truncated": len(lines) > DIFF_MAX,
            "binary": "Binary files" in out[:400]}


# ------------------------------------------------------------------ ③ 위험 작업 — danger-guard.js 와 같은 판정(권한 질문 문구용)
DANGER_PY = [
    (r"(^|[\s;&|(])(rm|rmdir|unlink|shred)(\s|$)", "파일·폴더 지우기"),
    (r"(^|[\s;&|(])(del|erase|rd)\s+", "파일·폴더 지우기"),
    (r"\bremove-item\b|(^|[\s;&|(])ri\s+", "파일·폴더 지우기"),
    (r"\bgit\s+push\b", "git push(원격에 올리기)"),
    (r"\bgit\s+reset\s+[^\n]*--hard\b", "git reset --hard(고친 것 버리기)"),
    (r"\bgit\s+clean\b", "git clean(추적 안 하는 파일 지우기)"),
    (r"\bgit\s+(checkout|restore)\s+[^\n]*(--\s+\.|\s\.(\s|$)|--worktree|-f\b|--force\b)", "git checkout/restore 로 고친 것 버리기"),
    (r"\bgit\s+branch\s+[^\n]*-(D|d)\b|\bgit\s+branch\s+[^\n]*--delete\b", "git 브랜치 지우기"),
    (r"\bgit\s+stash\s+(drop|clear)\b", "git stash 버리기"),
    (r"\bgit\s+(rebase|filter-branch|filter-repo)\b", "git 이력 고쳐 쓰기"),
    (r"\bgit\s+update-ref\s+-d\b|\bgit\s+tag\s+[^\n]*-d\b", "git 참조 지우기"),
    (r"\bnpm\s+(publish|unpublish)\b|\bgh\s+release\s+(create|delete)\b|\bgh\s+repo\s+delete\b", "배포·공개"),
    (r"(^|[\s;&|(])(format|mkfs|diskpart|shutdown|restart-computer|stop-computer)\b|\bdd\s+if=", "디스크·전원"),
    (r"\b(taskkill|stop-process|kill|pkill|killall)\b", "프로세스 끄기"),
    (r"\breg\s+(delete|add)\b|\bremove-itemproperty\b|\bset-itemproperty\b", "레지스트리 바꾸기"),
]
_DANGER = [(re.compile(p, re.I), n) for p, n in DANGER_PY]


def danger_name(cmd):
    """위험한 명령이면 그 이름(권한 질문에 「⚠ 위험 작업」으로 보인다), 아니면 ''."""
    c = " ".join(re.sub(r"^\s*rtk\s+", "", str(cmd or "")).split())
    return next((n for r, n in _DANGER if r.search(c)), "") if c else ""


# ------------------------------------------------------------------ ⑤ 따로 해 보기(git worktree)
WT_MARK = re.compile(r"^[ \t]*\[dnc:wt\][ \t\r]*$\n?", re.M)
WT_NOTE = ("\n\n(따로 해 보기 — 이 작업 폴더는 원래 저장소와 떨어진 git worktree(브랜치 %s)다. 여기서 마음껏 고치되 "
           "push · merge · 브랜치 바꾸기는 하지 말 것. 커밋은 해도 된다. 합칠지 버릴지는 사용자가 메신저에서 정한다.)")


def wt_strip(text):
    """지시 글의 「따로 해 보기」 표식 줄 → (뗀 글, 있었나)."""
    s = str(text or "")
    return (WT_MARK.sub("", s).rstrip(), True) if WT_MARK.search(s) else (s, False)


def wt_add(folder, job_id):
    """<저장소>/../.dnc-wt/<작업> 에 dnc/<작업> 브랜치로 worktree → {repo, path, branch, workdir} 또는 None(저장소 아님·실패)."""
    if not ID_RE.fullmatch(str(job_id or "")):
        return None
    root = checkpoint.top(folder)
    if not root:
        return None
    root = os.path.normpath(root)
    path = os.path.join(os.path.dirname(root), ".dnc-wt", str(job_id))
    branch = "dnc/%s" % job_id
    os.makedirs(os.path.dirname(path), exist_ok=True)
    code, _o, err = _run(["git", "-C", root, "worktree", "add", "-b", branch, path, "HEAD"], timeout=300)
    if code != 0:
        return None
    rel = os.path.relpath(os.path.normpath(folder), root)
    wd = path if rel in (".", "") or rel.startswith("..") else os.path.join(path, rel)
    return {"repo": root, "path": path, "branch": branch, "workdir": wd if os.path.isdir(wd) else path}


def _wt_ok(wt):
    if not isinstance(wt, dict):
        return False
    repo, path, br = str(wt.get("repo") or ""), str(wt.get("path") or ""), str(wt.get("branch") or "")
    want = os.path.normcase(os.path.join(os.path.dirname(os.path.normpath(repo)), ".dnc-wt"))
    return bool(repo and path and br.startswith("dnc/") and os.path.normcase(os.path.dirname(os.path.normpath(path))) == want)


def wt_state(wt):
    """화면용 — {exists, ahead(합칠 커밋 수), dirty(아직 커밋 안 한 파일 수)}."""
    if not _wt_ok(wt):
        return {"exists": False}
    if not os.path.isdir(wt["path"]):
        return {"exists": False}
    _c, dirty, _e = _run(["git", "-C", wt["path"], "status", "--porcelain=v1"], timeout=30)
    _c2, ahead, _e2 = _run(["git", "-C", wt["repo"], "rev-list", "--count", "HEAD.." + wt["branch"]], timeout=30)
    return {"exists": True, "dirty": len([x for x in dirty.splitlines() if x.strip()]),
            "ahead": int(ahead) if ahead.isdigit() else 0, "branch": wt["branch"]}


def wt_merge(wt, message):
    """worktree 의 변경을 커밋하고 지금 브랜치에 --no-ff 로 합친 뒤 worktree·브랜치를 정리. 충돌이면 되돌리고 알린다."""
    if not _wt_ok(wt) or not os.path.isdir(wt["path"]):
        raise ValueError("따로 해 본 작업 공간이 없습니다(이미 합쳤거나 버렸습니다)")
    path, repo, br = wt["path"], wt["repo"], wt["branch"]
    _run(["git", "-C", path, "add", "-A"], timeout=300)
    if _run(["git", "-C", path, "diff", "--cached", "--quiet"], timeout=60)[0] != 0:
        code, _o, err = _run(["git", "-C", path, "commit", "-m", message], timeout=120)
        if code != 0:
            raise ValueError("따로 해 본 변경을 커밋하지 못했습니다: %s" % err[-300:])
    _c, ahead, _e = _run(["git", "-C", repo, "rev-list", "--count", "HEAD.." + br], timeout=30)
    if ahead == "0":
        wt_drop(wt)
        return {"ok": True, "merged": False, "note": "바뀐 것이 없어 합칠 게 없었습니다 — 작업 공간만 정리했습니다"}
    _c, cur, _e = _run(["git", "-C", repo, "rev-parse", "--abbrev-ref", "HEAD"], timeout=30)
    code, out, err = _run(["git", "-C", repo, "merge", "--no-ff", "--no-edit", "-m", message, br], timeout=300)
    if code != 0:
        _run(["git", "-C", repo, "merge", "--abort"], timeout=60)
        why = (err or out)[-400:]
        raise ValueError("합치지 못했습니다(지금 폴더에 겹치는 고침이 있거나 충돌) — 아무것도 바꾸지 않고 되돌렸습니다.\n%s" % why)
    _c, head, _e = _run(["git", "-C", repo, "rev-parse", "--short", "HEAD"], timeout=30)
    wt_drop(wt)
    return {"ok": True, "merged": True, "into": cur, "commit": head}


def wt_drop(wt):
    """worktree 와 dnc/ 브랜치를 지운다."""
    if not _wt_ok(wt):
        raise ValueError("따로 해 본 작업 공간이 아닙니다")
    repo, path, br = wt["repo"], wt["path"], wt["branch"]
    if os.path.isdir(path):
        _run(["git", "-C", repo, "worktree", "remove", "--force", path], timeout=300)
    _run(["git", "-C", repo, "worktree", "prune"], timeout=60)
    _run(["git", "-C", repo, "branch", "-D", br], timeout=60)
    return {"ok": True, "gone": not os.path.isdir(path)}


# ------------------------------------------------------------------ P4 옆 질문
_FORK = {}


def fork_supported(claude):
    """claude --help 에 --fork-session 이 있나(한 번만 본다)."""
    key = " ".join(claude or [])
    if key not in _FORK:
        code, out, err = _run(list(claude) + ["--help"], timeout=30)
        _FORK[key] = "--fork-session" in (out + err)
    return _FORK[key]


SIDE_NOTE = ("[옆 질문] 지금 이 세션의 본 작업은 다른 곳에서 계속되고 있다. 이건 그 작업과 별개로 사용자가 옆에서 묻는 질문이다. "
             "파일을 고치거나 명령을 실행하지 말고, 지금까지의 맥락으로 짧게 답만 하라. 본 작업을 이어서 하지 말 것.\n\n질문: ")


def side_args(claude, session_id, guard=""):
    args = list(claude) + ["-p", "--resume", session_id, "--fork-session", "--output-format", "json",
                           "--permission-mode", "dontAsk", "--allowedTools", "Read", "Glob", "Grep"]
    if guard:
        at = args.index("-p")
        args[at:at] = ["--settings", guard]
    return args


# ------------------------------------------------------------------ P7 한도 풀리면 보내기
LIMIT_RE = re.compile(r"(usage limit|rate limit|hit your limit|limit reached|session limit|weekly limit|5-hour limit|"
                      r"사용\s*한도|한도에\s*(도달|닿)|한도를\s*초과|한도가\s*찼)", re.I)


def limit_reset(text, now=None, default_min=60):
    """한도 오류 글이면 풀리는 시각(유닉스 초), 아니면 None. 시각을 못 읽으면 now+default_min 분."""
    s = str(text or "")
    if not LIMIT_RE.search(s):
        return None
    now = now or time.time()
    m = re.search(r"\|(\d{10})\b", s)                                 # 'Claude AI usage limit reached|1795650000'
    if m and int(m.group(1)) > now - 3600:
        return float(m.group(1))
    base = datetime.fromtimestamp(now)
    m = re.search(r"resets?\s*(?:at\s*)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?", s, re.I) or \
        re.search(r"(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b", s, re.I)
    if m:
        h, mi, ap = int(m.group(1)), int(m.group(2) or 0), (m.group(3) or "").lower()
        if ap == "pm" and h < 12:
            h += 12
        if ap == "am" and h == 12:
            h = 0
        if 0 <= h < 24 and 0 <= mi < 60:
            t = base.replace(hour=h, minute=mi, second=0, microsecond=0)
            if t.timestamp() <= now:
                t += timedelta(days=1)
            return t.timestamp() + 60                                  # 풀린 직후 1분 여유
    m = re.search(r"(오전|오후)?\s*(\d{1,2})시(?:\s*(\d{1,2})분)?", s)
    if m:
        h, mi = int(m.group(2)), int(m.group(3) or 0)
        if m.group(1) == "오후" and h < 12:
            h += 12
        if 0 <= h < 24:
            t = base.replace(hour=h, minute=mi, second=0, microsecond=0)
            if t.timestamp() <= now:
                t += timedelta(days=1)
            return t.timestamp() + 60
    m = re.search(r"(?:in|after)\s*(\d{1,3})\s*(hour|hr|h|minute|min|m)\b", s, re.I) or re.search(r"(\d{1,3})\s*(시간|분)\s*(?:뒤|후)", s)
    if m:
        n, u = int(m.group(1)), m.group(2).lower()
        return now + n * (3600 if u.startswith("h") or u == "시간" else 60) + 60
    return now + default_min * 60


# ------------------------------------------------------------------ P10 남은 프로세스 정리
DEV_NAMES = {"node.exe", "python.exe", "pythonw.exe", "php.exe", "java.exe", "javaw.exe", "deno.exe", "bun.exe", "ruby.exe",
             "go.exe", "dotnet.exe", "esbuild.exe", "uvicorn.exe", "gunicorn.exe", "npm.exe", "npx.exe", "pnpm.exe", "yarn.exe",
             "cmd.exe", "bash.exe", "sh.exe", "powershell.exe", "pwsh.exe", "conhost.exe", "http-server.exe", "vite.exe",
             "node", "python", "python3", "php", "java", "deno", "bun", "ruby", "go", "dotnet", "npm", "npx", "bash", "sh"}
# 절대 끄지 않는 것 — 허브·서비스·메신저·게이트웨이·워커·Claude 본체·편집기·브라우저 도구(CLAUDE.md: 이름으로 일괄 종료 금지, 명령줄로 거른다)
KEEP_RE = re.compile(r"(?i)(macro-?hub|macrohub|\\app\.py|/app\.py|--child|chat\.py|chat_runner|mail-gateway|mail-sorter|inbox-worker|"
                     r"dispatch-?chat|svc_|job_|claude(\.exe|\.cmd)?\b|\\\.claude\\|/\.claude/|anthropic|electron|dnc-|\bdnc\b|"
                     r"playwright|mcp|serena|rtk\b|ai-art|studio\\app|code\.exe|cursor|phpstorm|idea64|jetbrains|"
                     r"dispatchchat|taskhand|dungilog|hangyeoul|nunmaeul|nameless|usage-?tray|ollama|docker|wsl|"
                     r"conhost\.exe\s+0x|windowsapps|system32\\(?!cmd\.exe|windowspowershell))")


def _ps_procs():
    """윈도우 프로세스 목록 [{pid, ppid, name, cmd, start}] — start 는 유닉스 초."""
    ps = ("Get-CimInstance Win32_Process | ForEach-Object { [pscustomobject]@{ pid=$_.ProcessId; ppid=$_.ParentProcessId; "
          "name=$_.Name; cmd=$_.CommandLine; start=if ($_.CreationDate) { ([DateTimeOffset]$_.CreationDate).ToUnixTimeSeconds() } else { 0 } } } "
          "| ConvertTo-Json -Compress")
    code, out, err = _run(["powershell", "-NoProfile", "-NonInteractive", "-Command", ps], timeout=60)
    if code != 0 or not out:
        return []
    try:
        v = json.loads(out)
    except ValueError:
        return []
    return v if isinstance(v, list) else [v]


def _parse_time(s):
    try:
        return datetime.strptime(str(s or ""), "%Y-%m-%d %H:%M:%S").timestamp()
    except ValueError:
        return 0


def leftovers(job, procs=None):
    """끝난 작업이 남긴 것으로 보이는 프로세스 — 그 작업 시간대(시작~끝+15초)에 생겼고, 부모가 이미 사라졌거나
    claude 본체(claude_pid)였거나 그런 프로세스의 자식인 개발 도구. 허브·서비스·메신저·Claude 등은 늘 뺀다."""
    if not isinstance(job, dict) or job.get("status") not in ("done", "error"):
        return []
    t0, t1 = _parse_time(job.get("started_at")), _parse_time(job.get("finished_at"))
    if not t0 or not t1:
        return []
    if procs is None:
        if not IS_WIN:
            return []
        procs = _ps_procs()
    alive = {int(p.get("pid") or 0) for p in procs}
    me, cpid = os.getpid(), int(job.get("claude_pid") or 0)
    picked = set()
    ordered = sorted(procs, key=lambda p: int(p.get("start") or 0))
    for p in ordered:
        pid, ppid, st = int(p.get("pid") or 0), int(p.get("ppid") or 0), int(p.get("start") or 0)
        name, cmd = str(p.get("name") or "").lower(), str(p.get("cmd") or "")
        if pid in (0, 4, me) or not (t0 - 2 <= st <= t1 + 15):
            continue
        if name not in DEV_NAMES or KEEP_RE.search(cmd) or KEEP_RE.search(name):
            continue
        if (cpid and ppid == cpid) or ppid not in alive or ppid in picked:
            picked.add(pid)
    return [{"pid": int(p["pid"]), "name": p.get("name") or "", "cmd": str(p.get("cmd") or "")[:400],
             "start": int(p.get("start") or 0)} for p in ordered if int(p.get("pid") or 0) in picked]


def kill_leftovers(job, pids):
    """leftovers 로 다시 고른 것 가운데 화면에서 고른 PID 만 끈다(아무 PID 나 끄지 않는다)."""
    now = {x["pid"]: x for x in leftovers(job)}
    want = [int(p) for p in pids or [] if str(p).isdigit() and int(p) in now]
    done, fail = [], []
    for pid in want:
        if IS_WIN:
            code, _o, err = _run(["taskkill", "/PID", str(pid), "/T", "/F"], timeout=30)
        else:
            try:
                os.kill(pid, 15)
                code, err = 0, ""
            except OSError as e:
                code, err = 1, str(e)
        (done if code == 0 else fail).append({"pid": pid, "name": now[pid]["name"], "why": "" if code == 0 else err[-200:]})
    return {"ok": True, "killed": done, "failed": fail}
