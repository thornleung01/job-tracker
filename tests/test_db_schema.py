"""The schema is the same whether a database is new or was made by an older version, and opening it is safe from many threads."""
import threading
from datetime import datetime, timezone

from jobtracker import db


def shape(conn):
    return {t: {(r["name"], r["type"], r["notnull"], r["dflt_value"]) for r in conn.execute(f"PRAGMA table_info({t})")}
            for t, in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")}


def test_a_database_from_an_older_version_is_brought_up_to_the_new_schema(tmp_path):
    fresh = db.connect(tmp_path / "fresh.db")
    old_path = tmp_path / "old.db"
    old = db.connect(old_path)
    for table, column, _ in db._ADDED_COLUMNS:          # what the first release did not have
        old.execute(f"ALTER TABLE {table} DROP COLUMN {column}")
    old.commit()
    assert shape(old) != shape(fresh)
    old.close()
    db._READY.discard(str(old_path))
    upgraded = db.connect(old_path)
    assert shape(upgraded) == shape(fresh)
    db._READY.discard(str(old_path))
    assert shape(db.connect(old_path)) == shape(fresh)     # and doing it again changes nothing


def test_a_new_database_already_has_every_added_column(tmp_path):
    conn = db.connect(tmp_path / "t.db")
    shape_of = shape(conn)
    for table, column, _ in db._ADDED_COLUMNS:
        assert any(name == column for name, *_ in shape_of[table]), (table, column)


def test_many_threads_opening_a_new_database_at_once_all_succeed(tmp_path):
    path = tmp_path / "race.db"
    errors = []

    def open_it():
        try:
            conn = db.connect(path)
            conn.execute("SELECT COUNT(*) FROM emails").fetchone()
        except Exception as exc:       # noqa: BLE001 - the test reports whatever went wrong
            errors.append(exc)

    threads = [threading.Thread(target=open_it) for _ in range(12)]
    [t.start() for t in threads]
    [t.join() for t in threads]
    assert errors == []


def test_the_review_queue_has_its_own_index_and_the_count_uses_it(tmp_path):
    conn = db.connect(tmp_path / "t.db")
    plan = " ".join(r[3] for r in conn.execute("EXPLAIN QUERY PLAN SELECT COUNT(*) FROM emails WHERE needs_review = 1"))
    assert "idx_email_review" in plan


def test_times_round_trip_through_iso_and_parse_iso():
    when = datetime(2026, 10, 5, 14, 30, 7, tzinfo=timezone.utc)
    assert db.parse_iso(db.iso(when)) == when and db.parse_iso(db.now_iso()).tzinfo is timezone.utc


def test_parse_iso_also_reads_other_iso_forms_as_utc():
    expected = datetime(2026, 10, 5, 14, 30, tzinfo=timezone.utc)
    assert db.parse_iso("2026-10-05T14:30:00+00:00") == expected
    assert db.parse_iso("2026-10-05T10:30:00-04:00") == expected
    assert db.parse_iso("2026-10-05T14:30:00") == expected
    assert db.parse_iso("2026-10-05T14:30:00.250Z").microsecond == 250000
