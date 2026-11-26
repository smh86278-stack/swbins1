# -*- coding: utf-8 -*-
"""11-26 둘째 묶음 — 끊긴 일 이어 하기(직접 실행) · 멈춘 일 감지 · 회신 꼬리.  python -m unittest test_resume_stall   (이 폴더에서)"""
import os
import shutil
import sys
import tempfile
import time
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import chat  # noqa: E402
import chat_runner as runner  # noqa: E402

SID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"


class ResumeStallTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.jobs = os.path.join(self.tmp, "jobs")
        os.makedirs(self.jobs)
        self.tr = os.path.join(self.tmp, SID + ".jsonl")
        open(self.tr, "w").close()
        for name, val in (("OWN_CFG", os.path.join(self.tmp, "config.json")), ("LOG_PATH", os.path.join(self.tmp, "chat.log")),
                          ("LOCALDATA", self.tmp), ("INBOX", ""), ("GATEWAY_CFG", ""), ("JOBS_DIR", ""),
                          ("find_transcript", lambda job, since: self.tr), ("jobs_dir", lambda: self.jobs)):
            if not hasattr(chat, name):                 # 키트판엔 없는 이름도 있다(게이트웨이 설정을 따로 읽는다)
                continue
            self.addCleanup(setattr, chat, name, getattr(chat, name))
            setattr(chat, name, val)
        chat.write_json(chat.OWN_CFG, {"user": "me@example.com"})
        self.r = runner.Runner(chat, root=os.path.join(self.tmp, "runner"))

    def running(self, jid, **kw):
        j = dict(id=jid, status="running", created_at=runner.now_text(), started_at=runner.now_text(),
                 prompt="고쳐 줘", workdir=self.tmp, mode="write")
        j.update(kw)
        self.r.write_job(j)

    def test_orphan_resumes_once(self):
        self.running("20261126-1")
        self.r.clean_orphans()
        j = self.r.read_job("20261126-1")
        self.assertEqual(j["status"], "queued")
        self.assertEqual(j["resume_id"], SID)
        self.assertTrue(j["auto_resumed"])
        self.assertEqual(j["orig_prompt"], "고쳐 줘")
        self.assertEqual(j["prompt"], runner.RESUME_PROMPT)
        # 이어 한 작업이 또 끊기면 이번엔 실패로(한 번만)
        self.r.update_job("20261126-1", status="running")
        self.r.clean_orphans()
        self.assertEqual(self.r.read_job("20261126-1")["status"], "error")

    def test_orphan_without_session_fails(self):
        chat.find_transcript = lambda job, since: ""
        self.running("20261126-2")
        self.r.clean_orphans()
        self.assertEqual(self.r.read_job("20261126-2")["status"], "error")

    def test_switch_off(self):
        chat.write_json(chat.OWN_CFG, {"user": "me@example.com", "auto_resume": False})
        self.running("20261126-3")
        self.r.clean_orphans()
        self.assertEqual(self.r.read_job("20261126-3")["status"], "error")

    def test_footer_mark(self):
        f = runner.reply_footer({"workdir": self.tmp, "auto_resumed": True, "resume_id": SID})
        self.assertIn("↻ 끊겨서 이어서 진행했습니다", f)
        self.assertNotIn("↻", runner.reply_footer({"workdir": self.tmp}))

    def test_stall_minutes(self):
        chat.write_json(os.path.join(self.jobs, "j1.json"), {"id": "j1", "status": "running", "started_at": runner.now_text(), "workdir": self.tmp})
        t = {"status": "running", "job": "j1"}
        self.assertEqual(chat.stall_minutes(t), 0)                       # 방금 바뀜
        old = time.time() - 25 * 60
        os.utime(self.tr, (old, old))
        chat.write_json(os.path.join(self.jobs, "j1.json"), {"id": "j1", "status": "running",
                        "started_at": time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(old - 60)), "workdir": self.tmp})
        self.assertGreaterEqual(chat.stall_minutes(t), 24)
        chat.write_json(chat.OWN_CFG, {"user": "me@example.com", "stall_minutes": 30})
        self.assertEqual(chat.stall_minutes(t), 0)                       # 설정 30분이면 아직
        self.assertEqual(chat.stall_minutes({"status": "done", "job": "j1"}), 0)

    def test_thread_commits(self):
        import subprocess
        repo = os.path.join(self.tmp, "repo")
        os.makedirs(repo)
        g = lambda *a: subprocess.run(["git", "-C", repo] + list(a), capture_output=True, check=True)
        g("init", "-q"); g("config", "user.email", "t@t"); g("config", "user.name", "t")
        for i, msg in enumerate(["고침\n\nD&C: T7", "다른 일\n\nD&C: T70", "그냥"]):
            open(os.path.join(repo, "f%d" % i), "w").close()
            g("add", "."); g("commit", "-q", "-m", msg)
        chat.write_json(os.path.join(self.jobs, "j7.json"), {"id": "j7", "status": "done", "workdir": repo})
        box = mock_box([{"key": "k7", "no": 7, "job": "j7"}])
        self.addCleanup(setattr, chat, "BOX", chat.BOX)
        chat.BOX = box
        r = chat.thread_commits("k7")["commits"]
        self.assertEqual([x["subject"] for x in r], ["고침"])
        self.assertEqual(chat.thread_commits("없음")["commits"], [])


def mock_box(threads):
    class B:
        def threads(self):
            return threads
    return B()


if __name__ == "__main__":
    unittest.main()
