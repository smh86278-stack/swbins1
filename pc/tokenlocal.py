# -*- coding: utf-8 -*-
"""허브 없는 PC 의 화면 펫 × Claude Code 토큰 사용량 — 이 PC 의 Claude Code 기록을 직접, 읽기만 한다.

허브가 있으면 chat.py 가 허브 /api/tokens 값을 쓰고, 허브가 없을 때(이 메신저 혼자 도는 PC)만 여기로 온다.
- ~/.claude/sessions/<pid>.json : 지금 켜진 세션(sessionId·status·cwd). 비정상 종료로 남은 파일은 pid 가 살아 있는지로 거른다.
- ~/.claude/projects/**/*.jsonl : assistant 줄의 message.usage — 같은 응답이 여러 줄로 적히므로 message.id + requestId 로 한 번만 센다.
  읽는 파일은 「최근 1시간 안에 바뀐 것 + 지금 켜진 세션의 것」만. 늘어난 부분만 이어 읽고, 기억은 메모리에만(파일로 남기지 않는다).
- 읽기는 뒤쪽 스레드에서 — 메신저 요청은 받아 둔 값을 바로 돌려받는다(처음 한 번만 잠깐 기다린다). 한 번에 읽는 시간에 상한이 있다.
- 돌려주는 것은 허브 tokenusage.view() 의 일부 모양(files·rate.m10·limits·sessions). 한도는 허브에서 정하는 것이라 여기선 없다
  → 컨디션은 여유·바쁨만, 지침·탈진은 없다. 경로를 걸러 내는 건 chat.pet_tokens 가 한다(폴더 이름만 화면으로).
기록 폴더가 없으면 files 0 → 펫 기능이 조용히 꺼진다.
"""
import datetime
import json
import os
import threading
import time

_CLAUDE = os.environ.get("CLAUDE_CONFIG_DIR") or os.path.join(os.path.expanduser("~"), ".claude")   # chat.py CLAUDE_PROJECTS 와 같은 자리
ROOT = os.path.join(_CLAUDE, "projects")
LIVE_DIR = os.path.join(_CLAUDE, "sessions")

TTL = 20            # 초 — 이보다 오래된 값이면 뒤에서 다시 읽는다
ACTIVE = 3600       # 이 안에 바뀐 기록 파일만 읽는다(켜진 세션 파일은 오래됐어도)
RATE = 600          # 속도는 최근 10분
BUDGET = 2.0        # 초 — 한 번 읽을 때의 상한(넘으면 쉬었다 이어서)
CHUNK = 8 << 20     # 파일 하나를 한 번에 읽는 양
FIRST_WAIT = 1.5    # 처음 부를 때만 이만큼 기다려 본다

_lock = threading.Lock()        # 기억(_files·_owner)
_run_lock = threading.Lock()    # 뒤쪽 읽기는 하나만
_files = {}                     # rel → {'size','mtime','off','recs': {key: [ts, sid, i, o, cw, cr]}, 'sess': {sid: {...}}}
_owner = {}                     # 응답 키 → 센 파일(이어 하기로 복사된 기록은 한 번만)
_snap = {"at": 0.0, "v": None}
_worker = None


def reset():
    """시험용 — 기억을 비운다."""
    global _worker
    with _lock:
        _files.clear()
        _owner.clear()
        _snap.update(at=0.0, v=None)
        _worker = None
    global _p_worker
    with _p_lock:
        _p_files.clear()
        _p_owner.clear()
        _p_snap.update(at=0.0, v=None)
        _p_worker = None


def _ts(s):
    try:
        return datetime.datetime.fromisoformat(str(s).replace("Z", "+00:00")).timestamp()
    except ValueError:
        return None


def folder_name(path):
    p = str(path or "").rstrip("\\/")
    return p.replace("\\", "/").split("/")[-1] if p else ""


def _pid_alive(pid):
    try:
        pid = int(pid)
    except (TypeError, ValueError):
        return False
    if os.name == "nt":
        import ctypes
        h = ctypes.windll.kernel32.OpenProcess(0x1000, False, pid)        # PROCESS_QUERY_LIMITED_INFORMATION
        if not h:
            return False
        code = ctypes.c_ulong()
        ok = ctypes.windll.kernel32.GetExitCodeProcess(h, ctypes.byref(code))
        ctypes.windll.kernel32.CloseHandle(h)
        return bool(ok) and code.value == 259                               # STILL_ACTIVE
    try:
        os.kill(pid, 0)
    except PermissionError:
        return True
    except OSError:
        return False
    return True


def live_detail():
    """{sessionId: {'status', 'cwd'}} — 그 폴더가 없으면(옛 Claude Code) None."""
    if not os.path.isdir(LIVE_DIR):
        return None
    out = {}
    for name in os.listdir(LIVE_DIR):
        if not name.endswith(".json"):
            continue
        try:
            with open(os.path.join(LIVE_DIR, name), encoding="utf-8") as f:
                d = json.load(f)
            if isinstance(d, dict) and d.get("sessionId") and _pid_alive(d.get("pid")):
                out[str(d["sessionId"])] = {"status": str(d.get("status") or ""), "cwd": str(d.get("cwd") or "")}
        except (OSError, ValueError, TypeError):
            continue
    return out


# ---------------------------------------------------------------- 읽기
def _sess(fr, sid, proj):
    return fr["sess"].setdefault(sid, {"proj": proj, "cwd": "", "last": 0.0, "total": 0})


def _line(fr, raw, proj, rel):
    if b'"usage"' not in raw or b'"assistant"' not in raw:
        return
    try:
        o = json.loads(raw)
    except ValueError:
        return
    if not isinstance(o, dict) or o.get("type") != "assistant":
        return
    m = o.get("message") or {}
    us = m.get("usage") if isinstance(m, dict) else None
    if not isinstance(us, dict) or str(m.get("model") or "").startswith("<"):    # <synthetic> — 실제 호출이 아니다
        return
    try:
        u = [int(us.get(k) or 0) for k in ("input_tokens", "output_tokens", "cache_creation_input_tokens", "cache_read_input_tokens")]
    except (TypeError, ValueError):
        return
    ts = _ts(o.get("timestamp"))
    if not any(u) or ts is None:
        return
    key = "%s|%s" % (m.get("id") or "", o.get("requestId") or "")
    if key == "|":
        key = "u|%s" % o.get("uuid")
    own = _owner.setdefault(key, rel)
    if own != rel:                                   # 다른 파일이 이미 센 응답
        return
    sid = str(o.get("sessionId") or "?")
    s = _sess(fr, sid, proj)
    old = fr["recs"].get(key)
    if old is not None:                              # 같은 응답의 다음 줄 — 앞 것을 빼고 새 것으로
        _sess(fr, old[1], proj)["total"] -= sum(old[2:])
    fr["recs"][key] = [ts, sid] + u
    s["total"] += sum(u)
    if o.get("cwd") and ts >= s["last"]:
        s["cwd"] = str(o["cwd"])
    s["last"] = max(s["last"], ts)


def _read_some(fr, path, proj, size, rel):
    with open(path, "rb") as f:
        f.seek(fr["off"])
        buf = f.read(min(size - fr["off"], CHUNK))
    end = buf.rfind(b"\n")
    if end < 0:
        if len(buf) >= CHUNK:                        # 한 줄이 너무 길다 — 건너뛴다
            fr["off"] += len(buf)
        return
    for raw in buf[:end].split(b"\n"):
        _line(fr, raw, proj, rel)
    fr["off"] += end + 1


def _drop(rel):
    fr = _files.pop(rel, None)
    for k in (fr or {}).get("recs", ()):
        if _owner.get(k) == rel:
            del _owner[k]


def _walk(live, now):
    """읽을 파일 {rel: (path, size, mtime, proj)} 와 기록 파일 수."""
    want, count = {}, 0
    for dp, _dn, fn in os.walk(ROOT):
        for n in fn:
            if not n.endswith(".jsonl"):
                continue
            count += 1
            p = os.path.join(dp, n)
            rel = os.path.relpath(p, ROOT)
            parts = rel.split(os.sep)
            sid = parts[1] if len(parts) > 2 else n[:-6]     # <프로젝트>/<세션>.jsonl · <프로젝트>/<세션>/subagents/*.jsonl
            try:
                st = os.stat(p)
            except OSError:
                continue
            if now - st.st_mtime < ACTIVE or sid in live:
                want[rel] = (p, st.st_size, st.st_mtime, parts[0])
    return want, count


def refresh(budget=BUDGET):
    """늘어난 부분만 읽는다. 시간이 다 되면 남은 일이 있다는 뜻으로 True."""
    t0 = time.time()
    live = live_detail()
    if not os.path.isdir(ROOT):
        with _lock:
            for rel in list(_files):
                _drop(rel)
        return False, 0, live
    want, count = _walk(live or {}, t0)
    more = False
    with _lock:
        for rel in [r for r in _files if r not in want]:
            _drop(rel)
        todo = sorted(((mt, rel, p, size, proj) for rel, (p, size, mt, proj) in want.items()), reverse=True)   # 최근 파일부터
        for mt, rel, p, size, proj in todo:
            fr = _files.get(rel)
            if fr and fr["size"] == size and fr["mtime"] == mt:
                continue
            if time.time() - t0 > budget:
                more = True
                break
            if fr is None or size < fr["off"]:          # 처음이거나 줄어듦 — 처음부터
                _drop(rel)
                fr = _files[rel] = {"size": 0, "mtime": 0, "off": 0, "recs": {}, "sess": {}}
            done = True
            try:
                while fr["off"] < size:
                    if time.time() - t0 > budget:
                        done = False
                        break
                    before = fr["off"]
                    _read_some(fr, p, proj, size, rel)
                    if fr["off"] == before:              # 끝에 아직 덜 쓰인 줄만 남았다
                        break
            except OSError:
                continue
            if not done:                                 # 시간이 다 돼 다 못 읽었다 — 크기를 기억하지 않아 다음에 이어서
                more = True
                break
            fr["size"], fr["mtime"] = size, mt
    return more, count, live


def view(budget=BUDGET):
    """한 번 읽고 허브 view() 의 일부 모양으로."""
    more, count, on = refresh(budget)
    now = time.time()
    with _lock:
        rate = [0, 0, 0]
        sess = {}
        for fr in _files.values():
            for r in fr["recs"].values():
                if r[0] >= now - RATE:
                    for k in range(3):
                        rate[k] += r[2 + k]
            for sid, s in fr["sess"].items():
                t = sess.setdefault(sid, {"id": sid, "proj": s["proj"], "cwd": "", "last": 0.0, "total": 0})
                t["total"] += s["total"]
                if s["last"] >= t["last"]:
                    t["last"], t["cwd"] = s["last"], s["cwd"] or t["cwd"]
    live = sorted((s for s in sess.values() if (s["id"] in on if on is not None else now - s["last"] < ACTIVE)),
                  key=lambda s: -s["last"])
    sessions = [{"id": s["id"][:8], "project": s["proj"], "cwd": s["cwd"],
                 "name": folder_name((on or {}).get(s["id"], {}).get("cwd") or s["cwd"]) or s["proj"],
                 "total": s["total"], "last": int(s["last"] * 1000),
                 "busy": (on[s["id"]]["status"] == "busy") if on is not None else now - s["last"] < 120} for s in live]
    per_min = RATE / 60.0
    return {"files": count, "scanning": more,
            "rate": {"m10": {"input": rate[0] / per_min, "output": rate[1] / per_min, "cache_write": rate[2] / per_min}},
            "limits": {"dayState": None, "monthState": None},
            "sessions": sessions}


# ---------------------------------------------------------------- 프로젝트별(이번 달 · 전체) — 허브 없는 PC 의 「비용」 칸
# 위 펫용 읽기와 따로 논다: 남아 있는 기록 파일 전부를 늘어난 만큼만 이어 읽고, 응답마다 [날짜, 입력, 출력, 캐시 쓰기, 캐시 읽기] 만 기억한다.
P_TTL = 300                     # 초 — 이보다 오래된 값이면 뒤에서 다시 읽는다
_p_lock = threading.Lock()
_p_run = threading.Lock()
_p_files = {}                   # rel → {'size','mtime','off','proj','recs': {key: [날짜, i, o, cw, cr]}}
_p_owner = {}
_p_snap = {"at": 0.0, "v": None}
_p_worker = None


def _p_line(fr, raw, rel):
    if b'"usage"' not in raw or b'"assistant"' not in raw:
        return
    try:
        o = json.loads(raw)
    except ValueError:
        return
    if not isinstance(o, dict) or o.get("type") != "assistant":
        return
    m = o.get("message") or {}
    us = m.get("usage") if isinstance(m, dict) else None
    if not isinstance(us, dict) or str(m.get("model") or "").startswith("<"):
        return
    try:
        u = [int(us.get(k) or 0) for k in ("input_tokens", "output_tokens", "cache_creation_input_tokens", "cache_read_input_tokens")]
    except (TypeError, ValueError):
        return
    ts = _ts(o.get("timestamp"))
    if not any(u) or ts is None:
        return
    key = "%s|%s" % (m.get("id") or "", o.get("requestId") or "")
    if key == "|":
        key = "u|%s" % o.get("uuid")
    if _p_owner.setdefault(key, rel) != rel:
        return
    fr["recs"][key] = [time.strftime("%Y-%m-%d", time.localtime(ts))] + u     # 같은 응답의 다음 줄이면 덮어쓴다(마지막 값)
    if o.get("cwd"):
        fr["cwd"] = str(o["cwd"])


def _p_drop(rel):
    fr = _p_files.pop(rel, None)
    for k in (fr or {}).get("recs", ()):
        if _p_owner.get(k) == rel:
            del _p_owner[k]


def project_refresh(budget=BUDGET):
    """늘어난 부분만 읽는다. 시간이 다 되면 True(남은 일 있음)."""
    t0 = time.time()
    with _p_lock:
        if not os.path.isdir(ROOT):
            for rel in list(_p_files):
                _p_drop(rel)
            return False
        want = {}
        for dp, _dn, fn in os.walk(ROOT):
            for n in fn:
                if n.endswith(".jsonl"):
                    p = os.path.join(dp, n)
                    try:
                        st = os.stat(p)
                    except OSError:
                        continue
                    rel = os.path.relpath(p, ROOT)
                    want[rel] = (p, st.st_size, st.st_mtime, rel.split(os.sep)[0])
        for rel in [r for r in _p_files if r not in want]:
            _p_drop(rel)
        for rel, (p, size, mt, proj) in sorted(want.items(), key=lambda x: -x[1][2]):
            fr = _p_files.get(rel)
            if fr and fr["size"] == size and fr["mtime"] == mt:
                continue
            if time.time() - t0 > budget:
                return True
            if fr is None or size < fr["off"]:
                _p_drop(rel)
                fr = _p_files[rel] = {"size": 0, "mtime": 0, "off": 0, "proj": proj, "cwd": "", "recs": {}}
            try:
                while fr["off"] < size:
                    if time.time() - t0 > budget:
                        return True
                    with open(p, "rb") as f:
                        f.seek(fr["off"])
                        buf = f.read(min(size - fr["off"], CHUNK))
                    end = buf.rfind(b"\n")
                    if end < 0:
                        if len(buf) >= CHUNK:
                            fr["off"] += len(buf)
                            continue
                        break
                    for raw in buf[:end].split(b"\n"):
                        _p_line(fr, raw, rel)
                    fr["off"] += end + 1
            except OSError:
                continue
            fr["size"], fr["mtime"] = size, mt
    return False


def project_view():
    """{'projects': 이번 달, 'projectsAll': 전체, 'projectsAllFrom': 'YYYY-MM-DD'} — 허브 /api/tokens 의 같은 이름 칸과 같은 모양(이름은 폴더 이름만)."""
    month = time.strftime("%Y-%m")
    per, per_all, cwd, first = {}, {}, {}, None
    with _p_lock:
        for fr in _p_files.values():
            p = fr["proj"]
            if fr["cwd"] and (p not in cwd or len(fr["cwd"]) < len(cwd[p])):
                cwd[p] = fr["cwd"]
            for r in fr["recs"].values():
                first = r[0] if first is None or r[0] < first else first
                for tgt in ((per_all, per) if r[0][:7] == month else (per_all,)):
                    a = tgt.setdefault(p, [0, 0, 0, 0])
                    for k in range(4):
                        a[k] += r[1 + k]

    def plist(pp):
        out = [{"project": p, "name": folder_name(cwd.get(p)) or p, "input": u[0], "output": u[1], "cache_write": u[2],
                "cache_read": u[3], "total": sum(u), "used": sum(u)} for p, u in pp.items() if any(u)]
        return sorted(out, key=lambda x: -x["used"])
    return {"projects": plist(per), "projectsAll": plist(per_all), "projectsAllFrom": first}


def _p_work():
    global _p_worker
    try:
        with _p_run:
            while project_refresh():
                time.sleep(0.2)
            v = project_view()
            with _p_lock:
                _p_snap.update(at=time.time(), v=v)
    except Exception:
        with _p_lock:
            _p_snap.update(at=time.time(), v=_p_snap["v"])
    finally:
        _p_worker = None


def project_snapshot(wait=FIRST_WAIT):
    """받아 둔 값을 바로 — 오래됐으면 뒤에서 다시 읽는다. 처음 읽는 중이면 None(화면은 「읽는 중」)."""
    global _p_worker
    with _p_lock:
        v, at = _p_snap["v"], _p_snap["at"]
        start = time.time() - at >= P_TTL and _p_worker is None
        if start:
            _p_worker = w = threading.Thread(target=_p_work, name="token-projects", daemon=True)
    if start:
        w.start()
        if v is None and wait:
            w.join(wait)
            with _p_lock:
                v = _p_snap["v"]
    return v


def _work():
    global _worker
    try:
        with _run_lock:
            while True:
                v = view()
                with _lock:
                    _snap.update(at=time.time(), v=v)
                if not v.get("scanning"):
                    break
                time.sleep(0.2)                          # 처음엔 파일이 많을 수 있다 — 쉬어 가며 이어 읽는다
    except Exception:
        with _lock:
            _snap.update(at=time.time(), v=_snap["v"] or {"files": 0})
    finally:
        _worker = None


def snapshot(wait=FIRST_WAIT):
    """받아 둔 값을 바로 — 오래됐으면 뒤에서 다시 읽기 시작한다. 처음 한 번만 wait 초까지 기다린다. 못 읽으면 {'files': 0}."""
    global _worker
    with _lock:
        v, at = _snap["v"], _snap["at"]
        start = time.time() - at >= TTL and _worker is None
        if start:
            _worker = threading.Thread(target=_work, name="pet-tokens", daemon=True)
            w = _worker
    if start:
        w.start()
        if v is None and wait:
            w.join(wait)
            with _lock:
                v = _snap["v"]
    return v or {"files": 0}
