# -*- coding: utf-8 -*-
"""D&C 메신저(chat.py) 시험 — 메일 서버·게이트웨이 없이 돈다.  python -m unittest test_chat   (이 폴더에서)

진행 상황 카드: 워커가 돌리는 작업의 Claude 세션 기록(~/.claude/projects/<작업 폴더>/<세션>.jsonl)을 찾아 단계로 푸는지 본다.
"""
import json
import os
import shutil
import sys
import tempfile
import time
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import chat  # noqa: E402


def ev(typ, content, ts="2026-10-12T01:00:10.000Z", **kw):
    return json.dumps(dict({"type": typ, "isSidechain": False, "timestamp": ts, "message": {"content": content}}, **kw),
                      ensure_ascii=False)


SINCE = chat._ts("2026-10-12T01:00:00.000Z")
LINES = [
    ev("user", "지난번 지시", ts="2026-10-11T09:00:00.000Z"),                       # 이어받은 세션의 지난 대화 — 빼야 한다
    ev("assistant", [{"type": "tool_use", "id": "old", "name": "Bash", "input": {"command": "ls"}}], ts="2026-10-11T09:00:01.000Z"),
    ev("user", "로그인 오류 고쳐 줘\n"),
    ev("assistant", [{"type": "text", "text": "살펴보겠습니다"},
                     {"type": "tool_use", "id": "t1", "name": "Bash", "input": {"command": "git status", "description": "작업 트리 보기"}}]),
    ev("assistant", [{"type": "tool_use", "id": "t2", "name": "Read", "input": {}}], isSidechain=True),   # 하위 에이전트 안쪽
    ev("user", [{"type": "tool_result", "tool_use_id": "t1", "content": "ok"}]),
    ev("assistant", [{"type": "tool_use", "id": "t3", "name": "Edit", "input": {"file_path": "C:/a.py"}}]),
    ev("user", [{"type": "tool_result", "tool_use_id": "t3", "is_error": True, "content": "x"}]),
    ev("assistant", [{"type": "tool_use", "id": "t4", "name": "TodoWrite", "input": {"todos": [
        {"content": "a", "status": "completed"}, {"content": "b", "activeForm": "b 하는 중", "status": "in_progress"}]}}]),
    '{"type":"assis',                                                                  # 아직 다 안 쓰인 줄
]


class Progress(unittest.TestCase):
    def test_steps(self):
        steps = chat.parse_progress(LINES, SINCE)
        self.assertEqual([(x["kind"], x.get("name"), x["text"], x.get("state")) for x in steps], [
            ("text", None, "살펴보겠습니다", None),
            ("tool", "Bash", "작업 트리 보기", "ok"),
            ("tool", "Edit", "C:/a.py", "err"),
            ("tool", "TodoWrite", "할 일 1/2 — b 하는 중", "run"),
        ])
        self.assertEqual(steps[1]["detail"], "command: git status\ndescription: 작업 트리 보기")   # 자세히: 넘긴 입력 전부
        self.assertEqual(steps[1]["result"], "ok")
        self.assertEqual(steps[2]["result"], "x")
        self.assertEqual(steps[3]["detail"], "✓ a\n▶ b")

    def test_detail_edit_and_clip(self):
        self.assertEqual(chat.tool_detail("Edit", {"file_path": "a.py", "old_string": "x = 1", "new_string": "x = 2\ny = 3"}),
                         "a.py\n- x = 1\n+ x = 2\n+ y = 3")
        self.assertEqual(chat.tool_detail("Bash", {"command": "ls"}), "ls")
        long = "가" * 2500
        self.assertTrue(chat.result_text([{"type": "text", "text": long}]).endswith("… (500자 더)"))

    def test_first_instruction_follows_its_job(self):
        """게이트웨이는 번호를 회신할 때 붙인다 — 번호가 없는 동안에도 접수된 작업(mail_msgid)으로 '작업 중' 과 작업 id 가 붙어야 진행 카드가 뜬다."""
        m = {"id": "<m1@x>", "thread": None, "ts": 1.0, "bot": False, "mode": "read", "tag": "#c", "text": "일 해 줘", "rest": "", "refs": []}
        t = chat.build_threads([dict(m)])[0]
        self.assertEqual((t["key"], t["status"], t["job"]), ("m:<m1@x>", "sent", ""))
        t = chat.build_threads([dict(m)], {}, {"<m1@x>": {"id": "j1", "status": "running", "thread": None}})[0]
        self.assertEqual((t["key"], t["no"], t["status"], t["job"]), ("m:<m1@x>", None, "running", "j1"))
        t = chat.build_threads([dict(m)], {25: {"id": "j1", "status": "done", "thread": 25}}, {"<m1@x>": {"id": "j1", "status": "done", "thread": 25}})[0]
        self.assertEqual((t["key"], t["no"], t["status"], t["job"]), ("T25", 25, "sent", "j1"))   # 번호를 받았고, 회신 전이라 '보냄'

    def test_progress_mail_is_not_an_answer(self):
        """진행 메일(X-Dispatch-Kind: progress)은 말풍선·답이 아니다 — 완료·번호·안 읽음에 안 세고, 회색 한 줄(progress)로만. 최종 답이 오면 사라진다."""
        me = {"id": "<m1@x>", "thread": None, "ts": 1.0, "bot": False, "mode": "read", "tag": "#c", "text": "일 해 줘", "rest": "", "refs": []}
        pr = {"id": "<p1@x>", "thread": None, "ts": 200.0, "bot": True, "kind": "progress", "status": "running", "mode": "read", "tag": "#c",
              "text": "진행 중 · 3분째 — 테스트 돌리기", "foot": "", "rest": "", "refs": ["<m1@x>"], "ask": None}
        t = chat.build_threads([dict(me), dict(pr)])[0]
        self.assertEqual((t["key"], len(t["msgs"]), t["status"], t["last_bot"], t["ts"]), ("m:<m1@x>", 1, "running", False, 1.0))
        self.assertEqual(t["progress"], "진행 중 · 3분째 — 테스트 돌리기")
        rep = dict(pr, id="<r1@x>", ts=300.0, kind="reply", status="done", thread=4, text="끝")
        t = chat.build_threads([dict(me), dict(pr), rep])[0]
        self.assertEqual((t["key"], len(t["msgs"]), t["status"], t["progress"]), ("T4", 2, "done", ""))
        pr2 = dict(pr, thread=4)                                  # 이어 말한 일의 진행 메일엔 번호가 붙어 온다 — 그래도 답이 아니다
        t = chat.build_threads([dict(me), rep, dict(pr2, ts=400.0, refs=["<m2@x>"]),
                                dict(me, id="<m2@x>", ts=350.0, thread=4, text="더 해 줘")])[0]
        self.assertEqual((len(t["msgs"]), t["status"], t["progress"], t["last_bot"]), (3, "running", pr["text"], False))

    def test_find_transcript_by_prompt(self):
        tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, tmp, True)
        d = os.path.join(tmp, "C--work-dir")
        os.makedirs(d)
        with open(os.path.join(d, "other.jsonl"), "w", encoding="utf-8") as f:     # 같은 폴더의 다른 세션(사람이 직접 쓰던 것)
            f.write(ev("user", "딴 일") + "\n")
        with open(os.path.join(d, "mine.jsonl"), "w", encoding="utf-8") as f:
            f.write("\n".join(LINES) + "\n")
        old = chat.CLAUDE_PROJECTS
        chat.CLAUDE_PROJECTS = tmp
        self.addCleanup(setattr, chat, "CLAUDE_PROJECTS", old)
        job = {"id": "j1", "workdir": "C:\\work-dir", "prompt": "로그인 오류 고쳐 줘\n"}
        # 기준 시각은 기록 안의 시각(SINCE)으로 — 지금 시각으로 두면 기록이 쓰인 날이 지나면 못 찾는다
        self.assertEqual(os.path.basename(chat.find_transcript(job, SINCE)), "mine.jsonl")


if __name__ == "__main__":
    unittest.main()


class LocalMarks(unittest.TestCase):
    """🔥 급건 · 📝 저장해 두는 답 — 이 PC 의 LOCALDATA 에만 남는다."""

    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp, True)
        for name in ("LOCALDATA", "URGENT_PATH", "SNIPPETS_PATH"):
            self.addCleanup(setattr, chat, name, getattr(chat, name))
        chat.LOCALDATA = self.tmp
        chat.URGENT_PATH = os.path.join(self.tmp, "urgent.json")
        chat.SNIPPETS_PATH = os.path.join(self.tmp, "snippets.json")

    def test_urgent(self):
        self.assertEqual(chat.load_urgent(), set())
        chat.set_urgent("T3", True)
        chat.set_urgent("T5", True)
        chat.set_urgent("T3", False)
        self.assertEqual(chat.load_urgent(), {"T5"})
        with self.assertRaises(ValueError):
            chat.set_urgent("", True)

    def test_snippets(self):
        self.assertEqual(chat.load_snippets(), chat.DEFAULT_SNIPPETS)          # 처음엔 기본 몇 개
        got = chat.edit_snippets({"add": "로그 먼저 보여 줘"})["snippets"]
        self.assertEqual(got[0], "로그 먼저 보여 줘")
        got = chat.edit_snippets({"add": chat.DEFAULT_SNIPPETS[1]})["snippets"]  # 같은 글은 맨 앞으로 하나만
        self.assertEqual(got[0], chat.DEFAULT_SNIPPETS[1])
        self.assertEqual(got.count(chat.DEFAULT_SNIPPETS[1]), 1)
        got = chat.edit_snippets({"remove": "로그 먼저 보여 줘"})["snippets"]
        self.assertNotIn("로그 먼저 보여 줘", got)
        self.assertEqual(chat.load_snippets(), got)
        with self.assertRaises(ValueError):
            chat.edit_snippets({"add": "x" * 2001})
