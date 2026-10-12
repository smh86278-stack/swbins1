# -*- coding: utf-8 -*-
"""'이 PC 에서 직접 실행'(runner.py) 시험 — 진짜 메일 서버·claude 없이 돈다.  python -m unittest test_runner   (이 폴더에서)

가짜 IMAP(메모리 메일함)과 가짜 claude(파이썬 스크립트 — 받은 인자·폴더·지시문을 적고 JSON 결과를 낸다)로
받기 → 실행 → 회신, 이어서 하기(--resume), 선택지 답, 쓰기 확인, 멈춤(자식 프로세스까지), 접수 신호, 막힘을 본다.
"""
import email
import email.policy
import email.utils
import imaplib
import json
import os
import shutil
import sys
import tempfile
import textwrap
import threading
import time
import unittest
from email.message import EmailMessage

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import chat  # noqa: E402
import runner  # noqa: E402

ME = "me@example.com"
SESSION = "11111111-2222-3333-4444-555555555555"

FAKE_CLAUDE = textwrap.dedent(r'''
    import json, os, subprocess, sys, time
    prompt = sys.stdin.buffer.read().decode("utf-8")
    with open(os.environ["FAKE_CLAUDE_LOG"], "a", encoding="utf-8") as f:
        f.write(json.dumps({"args": sys.argv[1:], "cwd": os.getcwd(), "prompt": prompt}, ensure_ascii=False) + "\n")
    if "SLEEP" in prompt:                          # 오래 걸리는 일 — 자식(손자) 프로세스도 하나 띄워 둔다
        c = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(60)"])
        with open(os.environ["FAKE_CLAUDE_CHILD"], "w") as f:
            f.write(str(c.pid))
        time.sleep(60)
    result = "끝냈습니다"
    if "ASK" in prompt:
        result += '\n\n```choices\n{"question": "다음은?", "multi": false, "options": ["더 보기", "여기서 멈춤"]}\n```'
    print(json.dumps({"type": "result", "is_error": False, "result": result, "session_id": "%s",
                      "total_cost_usd": 0.01, "duration_ms": 1200, "permission_denials": []}))
''' % SESSION)


class FakeIMAP:
    """메모리 메일함 하나(INBOX). 메일은 [uid, 원문, 들어온 시각]."""

    def __init__(self, box):
        self.box = box
        self.untagged_responses = {}

    def list(self):
        return "OK", [b'(\\HasNoChildren) "/" "INBOX"']

    def select(self, name, readonly=False):
        self.untagged_responses = {"UIDVALIDITY": [b"7"]}
        return "OK", [str(len(self.box["mails"])).encode()]

    def uid(self, cmd, *args):
        mails = self.box["mails"]
        if cmd == "SEARCH":
            return "OK", [b" ".join(str(u).encode() for u, _, _ in mails)]
        want, what, out = set(args[0].split(",")), args[1], []
        for u, raw, at in mails:
            if str(u) not in want:
                continue
            if "HEADER.FIELDS" in what:
                head = raw.split(b"\n\n", 1)[0]
                out += [(b'%d (UID %d INTERNALDATE %s BODY[HEADER.FIELDS (SUBJECT)] {%d}' % (
                    u, u, imaplib.Time2Internaldate(at).encode(), len(head)), head), b")"]
            else:
                out += [(b"%d (UID %d BODY[] {%d}" % (u, u, len(raw)), raw), b")"]
        return "OK", out

    def append(self, mailbox, flags, date, raw):
        self.box["appended"].append((flags, raw))
        add(self.box, raw)
        return "OK", [b"APPEND completed"]

    def logout(self):
        pass


def add(box, raw, at=None):
    box["uid"] += 1
    box["mails"].append([box["uid"], raw, at or time.time()])


def mail(subject, body="", sender=ME, msgid=None, reply_to=None, headers=None):
    m = EmailMessage()
    m["Subject"], m["From"], m["To"] = subject, sender, ME
    m["Date"] = email.utils.formatdate(localtime=True)
    m["Message-ID"] = msgid or email.utils.make_msgid(domain="example.com")
    if reply_to:
        m["In-Reply-To"] = m["References"] = reply_to
    for k, v in (headers or {}).items():
        m[k] = v
    m.set_content(body or " ")
    return m.as_bytes(), m["Message-ID"]


def alive(pid):
    if sys.platform == "win32":
        import ctypes
        k = ctypes.windll.kernel32
        h = k.OpenProcess(0x1000, False, pid)              # PROCESS_QUERY_LIMITED_INFORMATION
        if not h:
            return False
        code = ctypes.c_ulong()
        k.GetExitCodeProcess(h, ctypes.byref(code))
        k.CloseHandle(h)
        return code.value == 259                           # STILL_ACTIVE
    try:
        os.kill(pid, 0)
    except OSError:
        return False
    try:                                                   # 끝났지만 부모가 거두지 않은 좀비는 죽은 것으로 친다
        return os.waitpid(pid, os.WNOHANG) == (0, 0)
    except ChildProcessError:
        return True


class RunnerTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.work = os.path.join(self.tmp, "work")
        os.makedirs(self.work)
        self.box = {"mails": [], "appended": [], "uid": 0}
        self.calls = os.path.join(self.tmp, "calls.jsonl")
        fake = os.path.join(self.tmp, "fake_claude.py")
        with open(fake, "w", encoding="utf-8") as f:
            f.write(FAKE_CLAUDE)
        os.environ["FAKE_CLAUDE_LOG"] = self.calls
        os.environ["FAKE_CLAUDE_CHILD"] = os.path.join(self.tmp, "child.pid")
        # 이 PC 의 진짜 설정·메일·게이트웨이와 닿지 않게 모두 바꿔 둔다
        for name, val in (("OWN_CFG", os.path.join(self.tmp, "config.json")), ("LOG_PATH", os.path.join(self.tmp, "chat.log")),
                          ("LOCALDATA", self.tmp), ("INBOX", ""), ("GATEWAY_CFG", ""), ("JOBS_DIR", ""),
                          ("imap_connect", lambda cfg, pw: FakeIMAP(self.box)), ("password", lambda cfg: "pw")):
            self.addCleanup(setattr, chat, name, getattr(chat, name))
            setattr(chat, name, val)
        chat.write_json(chat.OWN_CFG, {"user": ME, "password_enc": "x", "imap_host": "imap.example.com"})
        self.r = runner.Runner(chat, root=os.path.join(self.tmp, "runner"))
        self.r.gateway_here = lambda: ""
        self.r.claude_cmd = lambda: [sys.executable, fake]
        self.addCleanup(setattr, chat, "RUNNER", chat.RUNNER)
        chat.RUNNER = self.r

    def turn_on(self, **extra):
        info = self.r.configure({"enabled": True, "workdir": self.work})
        self.assertTrue(info["enabled"])
        if extra:
            own = chat.read_json(chat.OWN_CFG)
            own.update(extra)
            chat.write_json(chat.OWN_CFG, own)
        time.sleep(0.01)

    def calls_made(self):
        try:
            with open(self.calls, encoding="utf-8") as f:
                return [json.loads(l) for l in f if l.strip()]
        except OSError:
            return []

    def replies(self, kind=None):
        out = [email.message_from_bytes(raw, policy=email.policy.default) for _f, raw in self.box["appended"]]
        return [m for m in out if kind is None or m["X-Dispatch-Kind"] == kind]

    def step(self):
        """메일함 한 바퀴 + 대기 작업 모두 실행(+회신)."""
        self.r.cycle()
        while self.r.run_next():
            pass

    # ---------- 받기 · 실행 · 회신

    def test_runs_own_instruction_and_replies_like_gateway(self):
        self.turn_on()
        raw, mid = mail("#c 로그 봐 줘 ASK", "자세히", headers={"X-Dispatch-Client": "chat"})
        add(self.box, raw)
        self.step()
        calls = self.calls_made()
        self.assertEqual(len(calls), 1)
        args = calls[0]["args"]
        self.assertEqual(os.path.normcase(calls[0]["cwd"]), os.path.normcase(self.work))
        self.assertEqual(calls[0]["prompt"], "로그 봐 줘 ASK\n\n자세히")
        self.assertIn("-p", args)
        self.assertEqual(args[args.index("--allowedTools") + 1:args.index("--allowedTools") + 4], ["Read", "Glob", "Grep"])
        self.assertNotIn("Edit", args)                                   # 읽기 지시는 읽기 도구만
        self.assertTrue(args[args.index("--append-system-prompt-file") + 1].endswith("chat-protocol.md"))
        self.assertEqual(self.replies("ack"), [])                         # 이 앱에서 보낸 지시엔 접수 신호가 없다
        rep = self.replies("reply")[0]
        self.assertEqual(rep["X-Dispatch"], "bot")
        self.assertEqual(rep["X-Dispatch-Thread"], "1")
        self.assertEqual(rep["In-Reply-To"], mid)
        self.assertTrue(str(rep["Subject"]).startswith("Re: #c [T1] 로그 봐 줘"))
        cfg, _ = chat.load_cfg()
        pm = chat.parse_message(rep.as_bytes(), cfg)                      # 기존 화면이 읽는 그대로
        self.assertEqual((pm["bot"], pm["thread"], pm["status"], pm["text"]), (True, 1, "done", "끝냈습니다"))
        self.assertEqual(pm["ask"]["options"], ["더 보기", "여기서 멈춤"])
        self.assertIn("이 PC 에서 실행", pm["foot"])
        # 두 번 실행하지 않는다 — 다시 돌아도, 메신저를 다시 켜도(새 Runner, 같은 상태 파일)
        self.step()
        r2 = runner.Runner(chat, root=self.r.root)
        r2.gateway_here, r2.claude_cmd = self.r.gateway_here, self.r.claude_cmd
        r2.cycle()
        self.assertFalse(r2.run_next())
        self.assertEqual(len(self.calls_made()), 1)

    def test_ignores_others_old_and_wrong_key(self):
        add(self.box, mail("#c 켜기 전에 온 지시")[0], at=time.time() - 60)
        self.turn_on(key_word="sesame")
        add(self.box, mail("#c 남이 보낸 지시 [k:sesame]", sender="evil@example.net")[0])
        add(self.box, mail("#c 단어 없음")[0])
        add(self.box, mail("#c 단어 틀림 [k:wrong]")[0])
        add(self.box, mail("#c 위조 [k:sesame]", headers={"Authentication-Results": "mx; dmarc=fail; spf=fail"})[0])
        add(self.box, mail("#c 일반 메일 아님", headers={"X-Dispatch-Mirror": "gmail"})[0])
        add(self.box, mail("회의 일정 [k:sesame]")[0])
        self.step()
        self.assertEqual(self.calls_made(), [])
        add(self.box, mail("#c 본문 단어 맞음", "할 일\n\n[k:sesame]")[0])
        self.step()
        calls = self.calls_made()
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0]["prompt"], "본문 단어 맞음\n\n할 일")         # 암호 단어 줄은 지시문에 안 들어간다

    def test_off_does_nothing(self):
        add(self.box, mail("#c 꺼져 있을 때")[0])
        self.step()
        self.assertEqual((self.calls_made(), self.box["appended"]), ([], []))

    # ---------- 이어서 · 선택지 · 쓰기 확인

    def test_resume_with_choice_answer(self):
        self.turn_on()
        add(self.box, mail("#c 조사 ASK")[0])
        self.step()
        rep = self.replies("reply")[0]
        add(self.box, mail("Re: #c [T1] 조사 ASK", "1\n\n2026. 10. 12. 오전 9:00, 나 <me@example.com> 작성:\n> 이전",
                           reply_to=rep["Message-ID"])[0])
        self.step()
        calls = self.calls_made()
        self.assertEqual(len(calls), 2)
        self.assertEqual(calls[1]["args"][calls[1]["args"].index("--resume") + 1], SESSION)
        self.assertEqual(calls[1]["prompt"], "사용자 답(번호 선택): ☑ 1. 더 보기")
        rep2 = self.replies("reply")[1]
        self.assertEqual(rep2["X-Dispatch-Thread"], "1")
        self.assertIn("이어서 실행", rep2.get_body(("plain",)).get_content())

    def test_write_asks_first(self):
        self.turn_on()
        add(self.box, mail("#cw 파일 고쳐 줘")[0])
        self.step()
        self.assertEqual(self.calls_made(), [])
        conf = self.replies("confirm")[0]
        self.assertEqual(conf["X-Dispatch-Thread"], "1")
        cfg, _ = chat.load_cfg()
        self.assertEqual(chat.parse_message(conf.as_bytes(), cfg)["ask"]["options"], ["실행", "취소"])
        add(self.box, mail("Re: #cw [T1] 파일 고쳐 줘", "1", reply_to=conf["Message-ID"])[0])     # 화면의 '실행' 고르기와 같은 답
        self.step()
        calls = self.calls_made()
        self.assertEqual(len(calls), 1)
        self.assertIn("Edit", calls[0]["args"])
        self.assertEqual(self.replies("reply")[0]["X-Dispatch-Thread"], "1")

    # ---------- 멈춤 · 접수 신호

    def test_stop_kills_tree_and_ack(self):
        self.turn_on()
        raw, mid = mail("#c 오래 걸리는 일 SLEEP")                      # 폰·메일 앱에서 온 지시(X-Dispatch-Client 없음)
        add(self.box, raw)
        self.r.cycle()
        acks = self.replies("ack")
        self.assertEqual(len(acks), 1)
        self.assertEqual(acks[0]["In-Reply-To"], mid)
        self.assertIn("Seen", self.box["appended"][0][0])
        worker = threading.Thread(target=self.r.run_next)
        worker.start()
        child_pid = os.environ["FAKE_CLAUDE_CHILD"]
        for _ in range(100):
            if os.path.isfile(child_pid) and os.path.getsize(child_pid):
                break
            time.sleep(0.1)
        with open(child_pid) as f:
            pid = int(f.read())
        self.assertTrue(alive(pid))
        add(self.box, mail("Re: #c 오래 걸리는 일 SLEEP", "멈춤", reply_to=mid)[0])
        t0 = time.time()
        self.r.cycle()
        worker.join(30)
        self.assertFalse(worker.is_alive())
        self.assertLess(time.time() - t0, 20)
        for _ in range(50):
            if not alive(pid):
                break
            time.sleep(0.1)
        self.assertFalse(alive(pid), "claude 의 자식 프로세스도 끝나야 한다")
        rep = self.replies("reply")[0]
        self.assertIn("멈췄습니다", rep.get_body(("plain",)).get_content())
        # 화면: 접수 신호는 말풍선이 아니고, 회신 전이면 '대기' 로 보인다
        cfg, _ = chat.load_cfg()
        msgs = [chat.parse_message(raw, cfg), chat.parse_message(acks[0].as_bytes(), cfg)]
        t = chat.build_threads(msgs)[0]
        self.assertEqual((len(t["msgs"]), t["status"]), (1, "queued"))

    def test_stop_before_instruction(self):
        self.turn_on()
        raw, mid = mail("#c 늦게 도착한 지시")
        add(self.box, mail("Re: #c 늦게 도착한 지시", "멈춤", reply_to=mid)[0])
        self.step()
        add(self.box, raw)
        self.step()
        self.assertEqual(self.calls_made(), [])
        self.assertIn("시작하기 전에", self.replies("reply")[0].get_body(("plain",)).get_content())

    # ---------- 막힘 · 겹침

    def test_blocked_on_gateway_pc(self):
        self.r.gateway_here = lambda: r"C:\gw"
        with self.assertRaises(ValueError):
            self.r.configure({"enabled": True, "workdir": self.work})
        own = chat.read_json(chat.OWN_CFG)
        own.update(run_here=True, run_since=time.time() - 5, run_workdir=self.work)      # 설정 파일을 손으로 켜 둬도
        chat.write_json(chat.OWN_CFG, own)
        add(self.box, mail("#c 게이트웨이 PC 에서")[0])
        self.step()
        self.assertEqual((self.calls_made(), self.box["appended"]), ([], []))
        self.assertIn("게이트웨이", self.r.summary()["error"])

    def test_gateway_account_and_no_claude(self):
        self.assertIn("게이트웨이", self.r.blocked({"user": ME, "password_enc": "x"}, "gateway"))
        self.r.claude_cmd = lambda: None
        with self.assertRaises(ValueError) as e:
            self.r.configure({"enabled": True, "workdir": self.work})
        self.assertIn("Claude Code", str(e.exception))
        self.assertFalse(self.r.info()["enabled"])

    def test_other_executor_turns_off(self):
        self.turn_on()
        raw, mid = mail("Re: #c [T9] 남의 회신", "게이트웨이가 답함", headers={"X-Dispatch": "bot", "X-Dispatch-Thread": "9"})
        add(self.box, raw)
        add(self.box, mail("#c 이건 실행되면 안 됨")[0])
        self.step()
        self.assertEqual(self.calls_made(), [])
        info = self.r.info()
        self.assertFalse(info["enabled"])
        self.assertIn("다른 PC", info["notice"])

    def test_parse_dirs(self):
        self.assertEqual(runner.parse_dirs("web = %s\n\n" % self.work), {"web": os.path.abspath(self.work)})
        with self.assertRaises(ValueError):
            runner.parse_dirs("그냥 폴더")
        with self.assertRaises(ValueError):
            runner.parse_dirs("x=%s" % os.path.join(self.tmp, "없음"))


if __name__ == "__main__":
    unittest.main()
