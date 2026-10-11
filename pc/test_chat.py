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
        self.assertEqual(os.path.basename(chat.find_transcript(job, time.time() - 60)), "mine.jsonl")


if __name__ == "__main__":
    unittest.main()
