# Pipeline parity notes

The TypeScript pipeline in this folder is a port of `jobtracker/{classify,extract,mailtext,links,match}.py` and
`jobtracker/rules.yaml`. The Python is the source of truth. `web/tests/fixtures/pipeline-golden.json` holds the output of
the real Python functions over a deterministic corpus, and `web/tests/pipeline/parity.test.ts` asserts the TS port returns
exactly the same.

Regenerate after changing Python behaviour or rules (from the repository root):

    python scripts/build_rules_json.py     # rules.yaml -> rules.json, unicodeTables.ts
    python scripts/export_fixtures.py      # rewrites web/tests/fixtures/pipeline-golden.json
    cd web && npm test

Both scripts take `--check`, which writes nothing and exits 1 when the committed files are out of date.

The fixture file records the Python and Unicode versions that made it (`meta.python` and `meta.unicode` in
`pipeline-golden.json`, currently 3.14.4 and 16.0.0), and `unicodeTables.ts` names its Unicode version on its second line.
`export_fixtures.py --check` ignores only the Python patch number: running it on 3.14.5 still passes when nothing else
differs. The minor version (3.15) and the Unicode version still matter, because they can change what the Python functions
return, so run both scripts with the same Python minor version the committed files name. Commit `rules.json`,
`unicodeTables.ts` and `pipeline-golden.json` together.

## Rules for keeping the two in step

- Python is the source of truth. Change the behaviour in `jobtracker/` first, then make the TypeScript return the same answers.
  The golden fixtures decide who is right, so never edit `pipeline-golden.json` by hand.
- A change to either side is not finished until `build_rules_json.py`, `export_fixtures.py` and `npm test` have all run
  and their outputs are committed. The web suite fails when `rules.json` drifts from `rules.yaml` (`rules-sync.test.ts`) or
  when any golden case differs (`parity.test.ts`).
- Keep each function's matching in one place. `pipeline/match.ts` is the single matching implementation, used by the app
  and by the fixtures. `sync/match.ts` is only a Dexie adapter that reads the database for it.
- Match the Python output exactly, including its quirks (see the known deviations below for the few that remain).

## Adding a case to the golden fixtures

The cases are built by `scripts/export_fixtures.py`, not written in the JSON. To cover a new input:

1. Add it to the Python script. For an email, add a sender to `SENDERS`, a subject to `SUBJECTS`, a sentence to `SENTENCES`
   or `PHRASES`, or a hand-written message in `corpus_messages()`; for a regular expression, add to `REGEX_CASES` (and the
   neighbouring `REGEX_*` lists); for a function with its own builder (`build_urls`, `build_match`, `build_links`,
   `build_pystr`), add the input there. Each builder calls `add(function, input, expected)` with what the real Python function
   returns. The corpus also reads the parameters of some `pytest.mark.parametrize` tests in `tests/` (see `params()`), so
   a new parameter in one of those tests becomes a golden case too.
2. Run `python scripts/export_fixtures.py`. If it warns that no sample sentence triggers a rule pattern, add a sentence for it.
3. Run `cd web && npm test`. A failure in `parity.test.ts` means the TypeScript differs from Python: fix the port, not the fixture.
4. Commit the script and `pipeline-golden.json` together.

## How Python semantics are kept

- Patterns stay in Python syntax. `pyre.ts` translates them: Unicode `\w \d \s \b`, `.` excluding only `\n`, `$` matching
  before a final newline, `\Z`, `(?P<n>)`, `{,n}`, literal `{ } ]`, and `re.I` also equating `i`/`I` with U+0130/U+0131 as
  Python does. Constructs with no JS equivalent (possessive quantifiers, atomic groups, other inline flags) throw.
- Strings are walked by code point (`len`, slicing, `[0]`), and `str` methods that differ from JS (`casefold`, `capitalize`,
  `strip`, `split()`, `isspace`, `unicodedata.combining`, `urllib.parse.quote`, `urlparse().hostname` with its `ValueError`
  cases, `markupsafe.escape`) are reimplemented in `pystr.ts` / `url.ts`. Tables for casefold, titlecase and combining classes
  are generated from Python into `unicodeTables.ts`.
- `reason` strings quote the original Python pattern text (`pyre.pattern`), so learned "distrust" values stay valid between
  the local and hosted editions.

## Known deviations (none affect any golden case)

1. **Unicode version.** Python 3.14 ships Unicode 16; browsers and Node ship a newer one. `\w`, `isalnum`, `NFKD` and
   `toLowerCase` can disagree for characters assigned after Unicode 16 (for example new scripts). One known case is
   U+0295, which Python treats as lowercase and newer Unicode does not (only `isLower`, used after a `:` line end).
2. **Empty iterations in nested quantifiers.** `re.search("(a*)*", "b")` gives group 1 = `""` in Python and `undefined` in
   ECMAScript. No pipeline pattern depends on this.
3. **`re.I` inside a character class** only gets the Python "i" equivalences for a literal `i`/`I`, not for ranges that merely
   contain it (`[a-z]` does not match U+0131). No pipeline pattern uses this.
4. **Python comment vs behaviour in `_fold`.** The comment says it "keeps kana/Hangul marks", but the combining marks are
   not letters or digits, so they are dropped (`ガ` and `カ` fold to the same key). The port reproduces the behaviour, not
   the comment, so keys match the Python database.
5. **Interface changes (not behaviour):**
   - `Message.sender_domain` is the function `senderDomain(msg)`.
   - `classify(msg, learned)` takes any object with `blocks(sender, domain)`, `allowSenders` and `distrust`
     (the `Learned` interface); `makeLearned({...})` builds one from lists. The blocking rule itself is `isBlocked`, which
     `makeLearned` and the app's own `Learned` class (sync/learn.ts) both call.
   - `find_application(conn, account_id, ...)` is split into the pure `matchApplication(threadApplicationId, applications, ...)`
     and `findApplication(store, threadId, ...)`, where `store` supplies `threadApplication` and `applicationsFor`
     (sync or async). Applications must be passed oldest first, as `ORDER BY id` does in Python. The app calls
     `findApplication` itself: `sync/match.ts` is only a Dexie adapter that reads the database for it, so the golden cases
     test the code that runs.
   - `mailtext.render` returns a plain string of safe HTML instead of `Markup`.
   - `render` is used by the parity tests only: the app reads `parts` and `blocksToHtml` through components/EmailText.tsx.
