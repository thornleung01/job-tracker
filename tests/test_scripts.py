"""The maintenance scripts: --help and --check never write, the fixture check ignores a Python patch number, exports stay private."""
import importlib.util
import json
import sqlite3
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent


def load(name):
    spec = importlib.util.spec_from_file_location(f"scripts_{name}", ROOT / "scripts" / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


GENERATED = [ROOT / "web" / "src" / "pipeline" / "rules.json", ROOT / "web" / "src" / "pipeline" / "unicodeTables.ts"]


def test_build_rules_help_prints_usage_and_writes_nothing(capsys):
    before = [(p.read_bytes(), p.stat().st_mtime_ns) for p in GENERATED]
    with pytest.raises(SystemExit) as stop:
        load("build_rules_json").main(["--help"])
    assert stop.value.code == 0 and "--check" in capsys.readouterr().out
    assert [(p.read_bytes(), p.stat().st_mtime_ns) for p in GENERATED] == before


def test_build_rules_check_passes_on_a_clean_tree_and_fails_when_a_file_drifts(monkeypatch, tmp_path, capsys):
    script = load("build_rules_json")
    assert script.main(["--check"]) == 0
    monkeypatch.setattr(script, "OUT_DIR", tmp_path)               # nothing generated there yet
    assert script.main(["--check"]) == 1 and "out of date" in capsys.readouterr().out
    assert list(tmp_path.iterdir()) == []                          # and --check wrote nothing


def test_an_unknown_argument_is_an_error_not_a_rewrite():
    with pytest.raises(SystemExit) as stop:
        load("build_rules_json").main(["--bogus"])
    assert stop.value.code == 2


def test_the_fixture_check_ignores_the_python_patch_number_only():
    fixtures = load("export_fixtures")
    base = '{\n"meta": {"counts": {"a": 1}, "generator": "g", "python": "3.14.4", "unicode": "16.0.0"},\n"cases": {}\n}\n'
    assert fixtures.same_apart_from_python_patch(base, base.replace("3.14.4", "3.14.5"))
    assert not fixtures.same_apart_from_python_patch(base, base.replace("3.14.4", "3.13.4"))
    assert not fixtures.same_apart_from_python_patch(base, base.replace("16.0.0", "17.0.0"))
    assert not fixtures.same_apart_from_python_patch(base, base.replace('"a": 1', '"a": 2'))


def test_export_reads_paths_with_odd_characters_and_help_does_not_run_it(tmp_path):
    export = load("export_json")
    path = tmp_path / "odd #1 ?x%.db"
    conn = sqlite3.connect(path)
    conn.execute("CREATE TABLE accounts (id INTEGER PRIMARY KEY, provider TEXT)")
    conn.execute("INSERT INTO accounts (provider) VALUES ('gmail')")
    conn.commit()
    conn.close()
    target = tmp_path / "out" / "export.json"
    assert export.main([str(path), str(target)]) == 0
    assert json.loads(target.read_text())["tables"]["accounts"] == [{"id": 1, "provider": "gmail"}]
    with pytest.raises(SystemExit) as stop:
        export.main(["--help"])
    assert stop.value.code == 0


def test_the_demo_seed_refuses_to_replace_the_real_database(capsys):
    seed = load("seed_demo")
    assert seed.main([str(ROOT / "data" / "tracker.db")]) == 1 and "real database" in capsys.readouterr().err


def test_the_demo_seed_builds_a_database_anywhere(tmp_path):
    seed = load("seed_demo")
    assert seed.main([str(tmp_path / "demo.db")]) == 0
    conn = sqlite3.connect(tmp_path / "demo.db")
    assert conn.execute("SELECT COUNT(*) FROM applications").fetchone()[0] > 20


def test_collapse_spaces_makes_one_trimmed_line_and_cuts_to_the_limit():
    from jobtracker.textutil import collapse_spaces
    assert collapse_spaces("  Hiring \n\t Manager  ") == "Hiring Manager"
    assert collapse_spaces(None) == "" and collapse_spaces(12) == "12"
    assert collapse_spaces("a b c d", 3) == "a b" and collapse_spaces("x" * 200, 80) == "x" * 80


def test_the_snapshot_golden_is_what_the_python_code_computes_from_the_snapshot_export():
    """The hosted tests compare the TypeScript Flow numbers with python-export.golden.json; this is the check that the file still equals Python's own answer."""
    fixtures = load("export_fixtures")
    committed = json.loads(fixtures.PY_EXPORT_GOLDEN.read_text(encoding="utf-8"))
    assert fixtures.python_export_golden(committed["now"]) == committed
    assert committed["sankey"]["0:0"]["total"] == committed["counts"]["applications"]


def test_the_snapshot_golden_follows_the_python_code_not_the_clock():
    fixtures = load("export_fixtures")
    committed = json.loads(fixtures.PY_EXPORT_GOLDEN.read_text(encoding="utf-8"))
    later = fixtures.python_export_golden("2027-06-01T00:00:00Z")
    assert later["sankey"]["0:0"] == committed["sankey"]["0:0"]            # all time does not move with the date
    assert later["sankey"]["0:30"]["total"] < committed["sankey"]["0:30"]["total"]    # a 30-day window does


def test_the_fixture_check_fails_when_the_snapshot_golden_drifts(monkeypatch, tmp_path, capsys):
    fixtures = load("export_fixtures")
    drifted = json.loads(fixtures.PY_EXPORT_GOLDEN.read_text(encoding="utf-8"))
    drifted["sankey"]["0:0"]["total"] += 1
    stale = tmp_path / "python-export.golden.json"
    stale.write_text(json.dumps(drifted), encoding="utf-8")
    monkeypatch.setattr(fixtures, "PY_EXPORT_GOLDEN", stale)
    monkeypatch.setattr("sys.argv", ["export_fixtures.py", "--check"])
    assert fixtures.main() == 1
    assert "python-export.golden.json is out of date" in capsys.readouterr().out
    assert json.loads(stale.read_text(encoding="utf-8")) == drifted        # --check wrote nothing


def test_the_golden_matching_cases_cover_re_applying_after_an_offer_and_several_applications_for_one_role():
    """Two mutations of web/src/pipeline/match.ts used to survive the golden fixtures: these cases are what catches them."""
    cases = json.loads((ROOT / "web" / "tests" / "fixtures" / "pipeline-golden.json").read_text(encoding="utf-8"))["cases"]["findApplication"]

    def answer(stages, event, role="Data Analyst", apps_role="Data Analyst"):
        for c in cases:
            i = c["input"]
            if i["event"] == event and i["role"] == role and not i["threadId"] and [(a["role"], a["stage"]) for a in i["applications"]] == [(apps_role, s) for s in stages]:
                return c["expected"]
        raise AssertionError(f"no golden case for {stages} {event}")

    assert answer(["Offer"], "applied")["kind"] == "new"                       # an Offer counts as closed for a fresh "applied" mail
    assert answer(["Offer"], "interview") == {"kind": "matched", "applicationId": 10}
    assert answer(["Applied", "Rejected"], "applied") == {"kind": "matched", "applicationId": 10}
    assert answer(["Applied", "Applied"], "interview") == {"kind": "matched", "applicationId": 11}      # the newest of several wins
    assert answer(["Rejected", "Offer"], "applied")["kind"] == "new"
