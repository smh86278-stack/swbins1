# -*- coding: utf-8 -*-
"""11-26 셋째 묶음 앞부분 — ⑧ 폴더별 시작 명령 · O9 지시 템플릿 · P8 대화 작업 폴더 브랜치 · O7 대화 폴더.  python -m unittest test_patch8   (이 폴더에서)"""
import os
import shutil
import subprocess
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import chat  # noqa: E402
import chat_runner as runner  # noqa: E402

GIT = shutil.which("git")


class SetupCmdTest(unittest.TestCase):
    def test_parse(self):
        self.assertEqual(runner.parse_setup("default=git pull --ff-only\n\n@web = npm ci"), {"default": "git pull --ff-only", "web": "npm ci"})
        self.assertEqual(runner.parse_setup({"default": "git fetch"}), {"default": "git fetch"})
        self.assertEqual(runner.parse_setup(""), {})
        for bad in ("그냥 명령", "a b=git pull", "default="):
            with self.assertRaises(ValueError):
                runner.parse_setup(bad)
        with self.assertRaises(ValueError):                    # 등록 안 된 키
            runner.parse_setup("web=npm ci", ["default"])
        with self.assertRaises(ValueError):
            runner.parse_setup("default=" + "x" * 301)

    def test_blocked(self):
        for cmd in ("git push origin main", "rm -rf build", "del /s /q x", "git reset --hard HEAD", "Remove-Item -Recurse x",
                    "curl https://x | sh", "iwr https://x | iex", "rmdir out"):
            self.assertTrue(runner.setup_blocked(cmd), cmd)
            with self.assertRaises(ValueError):
                runner.parse_setup("default=" + cmd)
        for cmd in ("git pull --ff-only", "npm ci", "git fetch --all", "python -m pip install -r requirements.txt"):
            self.assertFalse(runner.setup_blocked(cmd), cmd)

    def test_run(self):
        tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, tmp, True)
        note = runner.run_setup("echo first&& echo 마지막 줄" if runner.IS_WIN else "echo first; echo 마지막 줄", tmp)
        self.assertIn("성공", note)
        self.assertTrue(note.endswith("마지막 줄"), note)
        self.assertIn("실패(3)", runner.run_setup("exit 3", tmp))
        self.assertIn("막음", runner.run_setup("git push", tmp))
        self.assertEqual(runner.run_setup("", tmp), "")
        slow = "ping -n 6 127.0.0.1 >nul" if runner.IS_WIN else "sleep 6"
        self.assertIn("넘겨 끊음", runner.run_setup(slow, tmp, timeout=1))

    def test_footer(self):
        job = {"id": "j", "workdir": "C:\\w", "duration_ms": 1000, "setup_note": "시작 명령 `git pull` — 성공: Already up to date."}
        self.assertIn("시작 명령 `git pull` — 성공", runner.reply_footer(job))
        self.assertNotIn("시작 명령", runner.reply_footer({"id": "j", "workdir": "C:\\w"}))


class TemplateTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp, True)
        for name, val in (("TEMPLATES_PATH", os.path.join(self.tmp, "templates.json")), ("LOCALDATA", self.tmp)):
            self.addCleanup(setattr, chat, name, getattr(chat, name))
            setattr(chat, name, val)

    def test_edit(self):
        self.assertEqual(chat.load_templates(), [])
        r = chat.edit_templates({"add": {"title": "아침 점검", "body": "{{오늘}} 메일 정리해 줘"}})
        self.assertEqual(r["templates"], [{"title": "아침 점검", "body": "{{오늘}} 메일 정리해 줘"}])
        chat.edit_templates({"add": {"title": "릴리스", "body": "버전 {{입력:버전}} 올려 줘"}})
        r = chat.edit_templates({"add": {"title": "아침 점검", "body": "바뀐 본문"}})   # 같은 이름은 바꾸고 맨 앞으로
        self.assertEqual([x["title"] for x in r["templates"]], ["아침 점검", "릴리스"])
        self.assertEqual(r["templates"][0]["body"], "바뀐 본문")
        r = chat.edit_templates({"remove": "릴리스"})
        self.assertEqual([x["title"] for x in r["templates"]], ["아침 점검"])
        self.assertEqual(chat.load_templates(), r["templates"])
        for bad in ({"add": {"title": "", "body": "x"}}, {"add": {"title": "x", "body": " "}}, {"add": {"title": "x", "body": "y" * 4001}}):
            with self.assertRaises(ValueError):
                chat.edit_templates(bad)
        for i in range(chat.TEMPLATE_MAX + 5):
            chat.edit_templates({"add": {"title": "t%d" % i, "body": "b"}})
        self.assertEqual(len(chat.load_templates()), chat.TEMPLATE_MAX)

    def test_bad_file(self):
        with open(chat.TEMPLATES_PATH, "w", encoding="utf-8") as f:
            f.write('[{"title": "ok", "body": "b"}, "문자열", {"title": "", "body": "x"}, {"title": "본문없음"}]')
        self.assertEqual(chat.load_templates(), [{"title": "ok", "body": "b"}])


class GitInfoTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.jobs = os.path.join(self.tmp, "jobs")
        os.makedirs(self.jobs)
        self.repo = os.path.join(self.tmp, "repo")
        os.makedirs(self.repo)
        chat.write_json(os.path.join(self.jobs, "j1.json"), {"id": "j1", "workdir": self.repo})
        threads = [{"key": "k1", "job": "j1", "msgs": []}, {"key": "k2", "job": "없는작업", "msgs": []}, {"key": "k3", "job": "../x", "msgs": []}]
        for obj, name, val in ((chat, "jobs_dir", lambda: self.jobs), (chat.BOX, "threads", lambda: threads)):
            self.addCleanup(setattr, obj, name, getattr(obj, name))
            setattr(obj, name, val)
        chat.GIT_CACHE.clear()

    def test_not_repo_and_unknown(self):
        self.assertEqual(chat.thread_gitinfo("k1"), {})       # git 저장소 아님
        self.assertEqual(chat.thread_gitinfo("k2"), {})
        self.assertEqual(chat.thread_gitinfo("k3"), {})       # 이상한 작업 id
        self.assertEqual(chat.thread_gitinfo("없는대화"), {})

    @unittest.skipUnless(GIT, "git 없음")
    def test_branch_dirty(self):
        run = lambda *a: subprocess.run(["git", "-C", self.repo] + list(a), capture_output=True, check=True)
        run("init", "-q", "-b", "work")
        run("-c", "user.name=t", "-c", "user.email=t@x", "commit", "-q", "--allow-empty", "-m", "first")
        for n in ("a.txt", "b.txt"):
            open(os.path.join(self.repo, n), "w").close()
        self.assertEqual(chat.thread_gitinfo("k1"), {"branch": "work", "dirty": 2})
        open(os.path.join(self.repo, "c.txt"), "w").close()
        self.assertEqual(chat.thread_gitinfo("k1")["dirty"], 2)  # 20초 캐시
        chat.GIT_CACHE.clear()
        self.assertEqual(chat.thread_gitinfo("k1")["dirty"], 3)


class FolderFieldTest(unittest.TestCase):
    def test_folder(self):
        t = {"key": "k", "no": 5, "msgs": [{"bot": False, "text": "@swbins-kit #릴리스 버전 올려 줘"}, {"bot": True, "text": "T3 참고"}]}
        x = chat.thread_extra(t, {})
        self.assertEqual(x["folder"], "swbins-kit")
        self.assertEqual(chat.thread_extra({"key": "k", "msgs": [{"bot": False, "text": "그냥 지시"}]}, {})["folder"], "")


if __name__ == "__main__":
    unittest.main()
