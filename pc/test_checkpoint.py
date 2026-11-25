"""checkpoint.py — 임시 git 저장소로 before/after/되돌리기·건너뛰기·작업 트리 그대로인지."""
import os
import shutil
import subprocess
import tempfile
import unittest

import checkpoint as cp


def git(d, *a):
    return subprocess.run(["git", "-C", d] + list(a), capture_output=True, text=True, check=True).stdout.strip()


def write(d, name, s):
    p = os.path.join(d, name)
    os.makedirs(os.path.dirname(p), exist_ok=True)
    with open(p, "w", encoding="utf-8", newline="\n") as f:
        f.write(s)


def read(d, name):
    with open(os.path.join(d, name), encoding="utf-8") as f:
        return f.read()


@unittest.skipUnless(shutil.which("git"), "git 없음")
class CheckpointTest(unittest.TestCase):
    def setUp(self):
        self.d = tempfile.mkdtemp()
        git(self.d, "init", "-q")
        git(self.d, "config", "user.email", "t@t")
        git(self.d, "config", "user.name", "t")
        git(self.d, "config", "core.autocrlf", "false")
        write(self.d, "a.txt", "A1\n")
        write(self.d, "gone.txt", "G\n")
        write(self.d, ".gitignore", "secret.txt\n")
        git(self.d, "add", "-A")
        git(self.d, "commit", "-q", "-m", "init")
        write(self.d, "dirty.txt", "아직 안 담은 파일\n")       # 작업 전부터 있던 untracked
        write(self.d, "a.txt", "A2 (작업 전 고친 것)\n")       # 작업 전부터 있던 수정

    def tearDown(self):
        shutil.rmtree(self.d, ignore_errors=True)

    def test_not_repo(self):
        d = tempfile.mkdtemp()
        try:
            self.assertIsNone(cp.snap(d, "j1", "before"))
            self.assertFalse(cp.info(d, "j1")["repo"])
            with self.assertRaises(ValueError):
                cp.restore(d, "j1")
        finally:
            shutil.rmtree(d)

    def test_bad_id(self):
        self.assertIsNone(cp.snap(self.d, "../x", "before"))
        self.assertFalse(cp.info(self.d, "a b")["before"])

    def test_snap_restore(self):
        status0, head0 = git(self.d, "status", "--porcelain"), git(self.d, "rev-parse", "HEAD")
        self.assertTrue(cp.snap(self.d, "job-1", "before"))
        self.assertEqual(git(self.d, "status", "--porcelain"), status0)   # 인덱스·작업 트리 그대로
        # 작업: a 고침, b 새로, gone 지움, sub/c 새로, secret(무시 파일)
        write(self.d, "a.txt", "A3 작업\n")
        write(self.d, "b.txt", "B\n")
        write(self.d, "sub/c.txt", "C\n")
        write(self.d, "secret.txt", "S\n")
        os.remove(os.path.join(self.d, "gone.txt"))
        self.assertTrue(cp.snap(self.d, "job-1", "after"))
        self.assertEqual(git(self.d, "rev-parse", "HEAD"), head0)           # 브랜치 그대로
        inf = cp.info(self.d, "job-1")
        self.assertEqual((inf["repo"], inf["before"], inf["after"], inf["n"]), (True, True, True, 4))
        status1 = git(self.d, "status", "--porcelain")
        r = cp.restore(self.d, "job-1")
        self.assertEqual(sorted(r["reverted"]), ["a.txt", "gone.txt"])
        self.assertEqual(sorted(r["removed"]), ["b.txt", "sub/c.txt"])
        self.assertEqual(r["skipped"], [])
        self.assertEqual(read(self.d, "a.txt"), "A2 (작업 전 고친 것)\n")    # 작업 전 상태(커밋 전 수정까지)
        self.assertEqual(read(self.d, "gone.txt"), "G\n")
        self.assertFalse(os.path.exists(os.path.join(self.d, "b.txt")))
        self.assertEqual(read(self.d, "dirty.txt"), "아직 안 담은 파일\n")
        self.assertEqual(read(self.d, "secret.txt"), "S\n")                 # 무시 파일은 안 건드림
        self.assertEqual(git(self.d, "status", "--porcelain"), status0)
        self.assertNotEqual(status1, status0)

    def test_skip_changed_after(self):
        cp.snap(self.d, "j2", "before")
        write(self.d, "a.txt", "작업\n")
        write(self.d, "b.txt", "B\n")
        cp.snap(self.d, "j2", "after")
        write(self.d, "a.txt", "사람이 또 고침\n")                         # 작업 뒤 사람이 고친 파일
        r = cp.restore(self.d, "j2")
        self.assertEqual(r["removed"], ["b.txt"])
        self.assertEqual([x["path"] for x in r["skipped"]], ["a.txt"])
        self.assertEqual(read(self.d, "a.txt"), "사람이 또 고침\n")

    def test_no_checkpoint(self):
        with self.assertRaises(ValueError):
            cp.restore(self.d, "nothing")

    def test_prune(self):
        for i in range(5):
            cp.snap(self.d, "p%d" % i, "before")
            cp.snap(self.d, "p%d" % i, "after")
        cp.prune(self.d, keep=2)
        refs = git(self.d, "for-each-ref", "--format=%(refname)", "refs/dnc/").splitlines()
        self.assertEqual(len(refs), 4)

    def test_writes(self):
        self.assertTrue(cp.writes(["Read", "Edit"]))
        self.assertTrue(cp.writes(["Bash(git log:*)"]))
        self.assertFalse(cp.writes(["Read", "Grep", "Glob"]))


if __name__ == "__main__":
    unittest.main()
