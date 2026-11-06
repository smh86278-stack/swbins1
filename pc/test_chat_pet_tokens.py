# -*- coding: utf-8 -*-
"""화면 펫 × Claude Code 토큰 사용량 시험 — 메일 서버·허브 없이 돈다.  python -m unittest test_chat_pet_tokens   (이 폴더에서)

- chat.pet_tokens: 허브 /api/tokens 값에서 필요한 것만(폴더 이름만, 경로는 빼고) 넘기는지
- chat.pet_tokens_cached: 허브가 없으면 이 PC 기록(tokenlocal)으로, 그것도 없으면 조용히 꺼지는지(files 0)
- tokenlocal: 임시 폴더에 만든 가짜 Claude Code 기록을 읽어 속도·켜진 세션을 만드는지(같은 응답은 한 번만)
- 그 결과를 허브와 같은 판정(../pet/pettok.js)에 먹이면 같게 나오는지(node 가 있으면)
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import chat  # noqa: E402
import tokenlocal  # noqa: E402

PETTOK = os.path.join(chat.PET_WEB, "pettok.js")        # 메신저가 내주는 그 파일(swbins1 은 ../pet, swbins2 는 허브 web\)
NODE = shutil.which("node")

HUB_VIEW = {  # 허브 view() 모양(필요 없는 칸까지 섞어서)
    "now": 1, "scanning": False, "files": 744, "root": "C:\\Users\\me\\.claude\\projects",
    "rate": {"m10": {"input": 27.4, "output": 5058.1, "cache_write": 27979.6, "cache_read": 2249133.4, "total": 2282198.5}},
    "today": {"total": 1}, "month": {"total": 2}, "models": [{"model": "x"}],
    "limits": {"day": 100, "month": None, "basis": "all", "dayState": {"cap": 100, "used": 85, "pct": 85.0}, "monthState": None},
    "sessions": [
        {"id": "aaaa1111", "project": "C--my-app", "cwd": "C:\\work\\my-app", "total": 38419777, "last": 1793608289052, "idle": 2, "busy": True},
        {"id": "bbbb2222", "project": "C--api-server", "cwd": "C:\\work\\api-server\\src", "name": "api-server",
         "total": 2230890, "last": 1793608256628, "idle": 35, "busy": False},
        {"id": "deadbeef", "project": "C--notes", "cwd": "", "total": 5, "last": 1, "busy": False},
    ],
}


class PetTokensFilter(unittest.TestCase):
    def test_only_needed_fields_and_folder_names(self):
        v = chat.pet_tokens(HUB_VIEW)
        self.assertEqual(set(v), {"files", "rate", "limits", "sessions"})
        self.assertEqual(v["files"], 744)
        self.assertEqual(v["rate"], {"m10": {"input": 27.4, "output": 5058.1, "cache_write": 27979.6}})
        self.assertEqual(v["limits"], {"dayState": {"pct": 85.0}, "monthState": None})
        self.assertEqual([(s["id"], s["name"], s["busy"]) for s in v["sessions"]],
                         [("aaaa1111", "my-app", True), ("bbbb2222", "api-server", False), ("deadbeef", "notes", False)])
        text = json.dumps(v, ensure_ascii=False)
        for leak in ("C:\\\\", "cwd", "project", "root", "models", ".claude"):   # 경로·기록 위치는 넘기지 않는다
            self.assertNotIn(leak, text)

    def test_off_when_empty(self):
        for raw in (None, {}, {"files": 0, "sessions": [{"id": "a"}]}, "oops", []):
            self.assertEqual(chat.pet_tokens(raw), {"files": 0})


class TokenProjectsFilter(unittest.TestCase):
    """허브 값에서 프로젝트별만 — 경로(project·cwd) 는 빼고 폴더 이름과 숫자만. 허브가 없고 아직 읽는 중이면 scanning."""

    def test_hub(self):
        raw = {"projects": [{"project": "C--secret-path-app", "name": "app", "cwd": "C:\secret\path\app", "input": 1, "output": 2,
                             "cache_write": 3, "cache_read": 4, "total": 10, "used": 10}],
               "projectsAll": [], "projectsAllFrom": "2026-10-06", "sessions": []}
        v = chat.token_projects_now(fetch=lambda: raw)
        self.assertEqual(v["source"], "hub")
        self.assertEqual(v["from"], "2026-10-06")
        self.assertEqual(v["projects"], [{"input": 1, "output": 2, "cache_write": 3, "cache_read": 4, "total": 10, "name": "app"}])
        self.assertNotIn("secret", json.dumps(v))

    def test_scanning(self):
        boom = lambda: (_ for _ in ()).throw(OSError())                                  # noqa: E731
        self.assertEqual(chat.token_projects_now(fetch=boom, local=lambda: None), {"scanning": True})
        self.assertEqual(chat.token_projects_now(fetch=lambda: {"files": 3}, local=lambda: None), {"scanning": True})   # 옛 허브(프로젝트 칸 없음)


class Cached(unittest.TestCase):
    def setUp(self):
        self.old = dict(chat._pet_tok)
        chat._pet_tok.update(at=0, v={"files": 0})

    def tearDown(self):
        chat._pet_tok.clear(); chat._pet_tok.update(self.old)

    def test_hub_first(self):
        local = []
        v = chat.pet_tokens_cached(lambda: HUB_VIEW, local=lambda: local.append(1) or {"files": 0})
        self.assertEqual(v["files"], 744)
        self.assertEqual(local, [])                                          # 허브가 있으면 이 PC 기록은 안 읽는다

    def test_local_when_no_hub_and_cached(self):
        calls = []

        def boom():
            calls.append(1)
            raise OSError("허브 없음")
        local = dict(HUB_VIEW, files=3, limits={})
        v = chat.pet_tokens_cached(boom, local=lambda: local)
        self.assertEqual(v["files"], 3)
        self.assertEqual(v["sessions"][0]["name"], "my-app")
        self.assertNotIn("work", json.dumps(v))                              # 이 PC 기록에서 와도 경로는 빠진다
        chat.pet_tokens_cached(boom, local=lambda: local)                     # 20초 안엔 다시 묻지 않는다
        self.assertEqual(len(calls), 1)

    def test_quiet_when_nothing(self):
        def boom():
            raise OSError("허브 없음")

        def broken():
            raise ValueError("기록 깨짐")
        self.assertEqual(chat.pet_tokens_cached(boom, local=lambda: {"files": 0}), {"files": 0})
        chat._pet_tok.update(at=0)
        self.assertEqual(chat.pet_tokens_cached(boom, local=broken), {"files": 0})


def _asst(ts, sid, mid, rid, inp, out, cw=0, cr=0, cwd="", model="claude-x"):
    return json.dumps({"type": "assistant", "sessionId": sid, "requestId": rid, "cwd": cwd,
                       "timestamp": time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime(ts)),
                       "message": {"id": mid, "model": model, "usage": {
                           "input_tokens": inp, "output_tokens": out, "cache_creation_input_tokens": cw,
                           "cache_read_input_tokens": cr}}})


class LocalRecords(unittest.TestCase):
    """허브 없는 PC — 이 PC 의 Claude Code 기록을 직접 읽기만."""

    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.old = (tokenlocal.ROOT, tokenlocal.LIVE_DIR)
        tokenlocal.ROOT = os.path.join(self.tmp, "projects")
        tokenlocal.LIVE_DIR = os.path.join(self.tmp, "sessions")
        tokenlocal.reset()
        now = time.time()
        proj = os.path.join(tokenlocal.ROOT, "C--work-my-app")
        os.makedirs(os.path.join(proj, "s1", "subagents"))
        with open(os.path.join(proj, "s1.jsonl"), "w", encoding="utf-8") as f:
            f.write("\n".join([
                _asst(now - 3000, "s1", "m0", "r0", 999, 999, cwd="C:\\work\\my-app"),       # 10분 넘음 — 속도엔 안 들어감
                _asst(now - 60, "s1", "m1", "r1", 100, 10, cw=5, cr=7, cwd="C:\\work\\my-app"),
                _asst(now - 50, "s1", "m1", "r1", 100, 40, cw=5, cr=7, cwd="C:\\work\\my-app"),  # 같은 응답의 다음 줄 — 나중 것만
                _asst(now - 40, "s1", "m9", "r9", 1, 1, model="<synthetic>"),                  # 실제 호출 아님
                json.dumps({"type": "user", "message": {"content": "대화 내용은 읽지 않는다"}}),
            ]) + "\n" + '{"type":"assis')                                                        # 아직 덜 쓰인 줄
        with open(os.path.join(proj, "s1", "subagents", "agent-1.jsonl"), "w", encoding="utf-8") as f:
            f.write(_asst(now - 30, "s1", "m2", "r2", 50, 50) + "\n")
            f.write(_asst(now - 50, "s1", "m1", "r1", 100, 40, cw=5, cr=7) + "\n")              # 다른 파일에 복사된 같은 응답
        old = os.path.join(tokenlocal.ROOT, "C--old", "s0.jsonl")                             # 오래된·꺼진 세션 — 안 읽는다
        os.makedirs(os.path.dirname(old))
        with open(old, "w", encoding="utf-8") as f:
            f.write(_asst(now - 90000, "s0", "mx", "rx", 5, 5) + "\n")
        os.utime(old, (now - 90000, now - 90000))
        os.makedirs(tokenlocal.LIVE_DIR)
        with open(os.path.join(tokenlocal.LIVE_DIR, "1.json"), "w", encoding="utf-8") as f:
            json.dump({"pid": os.getpid(), "sessionId": "s1", "status": "busy", "cwd": "C:\\work\\my-app"}, f)
        with open(os.path.join(tokenlocal.LIVE_DIR, "2.json"), "w", encoding="utf-8") as f:
            json.dump({"pid": 999999, "sessionId": "dead", "status": "idle"}, f)              # 비정상 종료로 남은 파일

    def tearDown(self):
        tokenlocal.ROOT, tokenlocal.LIVE_DIR = self.old
        tokenlocal.reset()
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_projects(self):
        """프로젝트별 — 오래된·꺼진 기록까지 전부, 같은 응답은 한 번(마지막 줄 값), synthetic 빼고, 이름은 폴더 이름만."""
        self.assertFalse(tokenlocal.project_refresh())
        v = tokenlocal.project_view()
        allp = {p["project"]: p for p in v["projectsAll"]}
        app = allp["C--work-my-app"]
        self.assertEqual((app["input"], app["output"], app["cache_write"], app["cache_read"]), (1149, 1089, 5, 7))
        self.assertEqual(app["name"], "my-app")
        self.assertEqual(allp["C--old"]["total"], 10)
        self.assertEqual(v["projectsAll"][0]["project"], "C--work-my-app")              # 많이 쓴 순
        self.assertEqual(v["projectsAllFrom"], time.strftime("%Y-%m-%d", time.localtime(time.time() - 90000)))
        # 화면으로 넘길 때는 폴더 이름과 숫자만
        out = chat.token_projects_now(fetch=lambda: (_ for _ in ()).throw(OSError()), local=tokenlocal.project_view)
        self.assertEqual(out["source"], "local")
        self.assertNotIn("project", out["projectsAll"][0])
        self.assertEqual(out["projectsAll"][0]["name"], "my-app")

    def test_view(self):
        v = tokenlocal.view()
        self.assertEqual(v["files"], 3)
        self.assertFalse(v["scanning"])
        m10 = v["rate"]["m10"]
        self.assertAlmostEqual(m10["input"], 15.0)                           # (100 + 50) / 10분
        self.assertAlmostEqual(m10["output"], 9.0)                           # (40 + 50) / 10분 — 10 은 덮였다
        self.assertAlmostEqual(m10["cache_write"], 0.5)
        self.assertEqual(len(v["sessions"]), 1)
        s = v["sessions"][0]
        self.assertEqual((s["id"], s["name"], s["busy"]), ("s1", "my-app", True))
        self.assertEqual(s["total"], 999 * 2 + 152 + 100)
        out = chat.pet_tokens(v)
        self.assertNotIn("work", json.dumps(out))
        self.assertNotIn("대화", json.dumps(out, ensure_ascii=False))

    def test_incremental(self):
        tokenlocal.view()
        with open(os.path.join(tokenlocal.ROOT, "C--work-my-app", "s1.jsonl"), "a", encoding="utf-8") as f:
            f.write('tant"}\n' + _asst(time.time() - 5, "s1", "m3", "r3", 200, 0) + "\n")    # 덜 쓰인 줄이 마저 쓰이고 새 줄
        v = tokenlocal.view()
        self.assertAlmostEqual(v["rate"]["m10"]["input"], 35.0)
        self.assertEqual(v["sessions"][0]["total"], 999 * 2 + 152 + 100 + 200)

    def test_idle_session_and_no_live_dir(self):
        with open(os.path.join(tokenlocal.LIVE_DIR, "1.json"), "w", encoding="utf-8") as f:
            json.dump({"pid": os.getpid(), "sessionId": "s1", "status": "idle", "cwd": "C:\\work\\my-app"}, f)
        self.assertFalse(tokenlocal.view()["sessions"][0]["busy"])
        shutil.rmtree(tokenlocal.LIVE_DIR)                                     # 옛 Claude Code — 최근 1시간 움직인 세션
        tokenlocal.reset()
        self.assertEqual([s["id"] for s in tokenlocal.view()["sessions"]], ["s1"])

    def test_no_records_is_off(self):
        tokenlocal.ROOT = os.path.join(self.tmp, "없음")
        tokenlocal.reset()
        self.assertEqual(tokenlocal.view()["files"], 0)
        self.assertEqual(chat.pet_tokens(tokenlocal.snapshot()), {"files": 0})

    def test_snapshot_background(self):
        v = tokenlocal.snapshot(wait=5)
        self.assertEqual(v["files"], 3)
        t0 = time.time()
        self.assertEqual(tokenlocal.snapshot()["files"], 3)                  # 받아 둔 값을 바로
        self.assertLess(time.time() - t0, 0.5)


class TokensRoute(unittest.TestCase):
    """GET /api/tokens — 이 PC 주소(Host)로 온 요청만, 토큰 없이 읽기만."""

    def setUp(self):
        self.old = (chat.PORT, dict(chat._pet_tok))
        self.srv = chat.Server(("127.0.0.1", 0), chat.Handler)
        chat.PORT = self.srv.server_address[1]
        threading.Thread(target=self.srv.serve_forever, daemon=True).start()
        chat._pet_tok.update(at=9e18, v=chat.pet_tokens(HUB_VIEW))       # 허브·기록을 읽지 않게 받아 둔 것으로

    def tearDown(self):
        self.srv.shutdown(); self.srv.server_close()
        chat.PORT = self.old[0]
        chat._pet_tok.clear(); chat._pet_tok.update(self.old[1])

    def get(self, path, host=None):
        req = urllib.request.Request("http://127.0.0.1:%d%s" % (chat.PORT, path))
        if host:
            req.add_header("Host", host)
        try:
            with urllib.request.urlopen(req, timeout=5) as r:
                return r.status, r.read()
        except urllib.error.HTTPError as e:
            return e.code, e.read()

    def test_route(self):
        code, body = self.get("/api/tokens")
        self.assertEqual(code, 200)
        self.assertEqual(json.loads(body)["sessions"][0]["name"], "my-app")
        self.assertEqual(self.get("/api/tokens", host="evil.example:%d" % chat.PORT)[0], 403)   # DNS 리바인딩 막기 그대로
        code, js = self.get("/pet/pettok.js")
        self.assertEqual(code, 200)
        with open(PETTOK, "rb") as f:
            self.assertEqual(js, f.read())

    @unittest.skipUnless(NODE, "node 가 없으면 건너뜀")
    def test_same_verdict_as_hub(self):
        """메신저가 넘긴 값으로도 허브 값 그대로와 같은 컨디션·동료 펫이 나온다."""
        js = ("globalThis.window=globalThis;require(process.argv[1]);const T=window.PetTok;"
              "const [a,b]=JSON.parse(require('fs').readFileSync(0,'utf8'));"
              "const f=v=>({c:T.condition(v),b:T.buddies(v).list.map(x=>[x.id,x.name,x.state,x.seed])});"
              "console.log(JSON.stringify([f(a),f(b)]))")
        r = subprocess.run([NODE, "-e", js, os.path.abspath(PETTOK)], input=json.dumps([HUB_VIEW, chat.pet_tokens(HUB_VIEW)]),
                           capture_output=True, text=True, encoding="utf-8", timeout=30)
        self.assertEqual(r.returncode, 0, r.stderr)
        hub, mine = json.loads(r.stdout)
        self.assertEqual(mine["c"], "tired")                                # 오늘 한도 85% → 지침
        self.assertEqual(hub, mine)
        self.assertEqual([x[1] for x in mine["b"]], ["api-server", "notes", "my-app"])


if __name__ == "__main__":
    unittest.main()
