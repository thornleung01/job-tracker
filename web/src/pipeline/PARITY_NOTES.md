# Pipeline parity notes

The TypeScript pipeline in this folder is a port of `jobtracker/{classify,extract,mailtext,links,match}.py` and
`jobtracker/rules.yaml`. The Python is the source of truth. `web/tests/fixtures/pipeline-golden.json` holds the output of
the real Python functions over a deterministic corpus, and `web/tests/pipeline/parity.test.ts` asserts the TS port returns
exactly the same.

Regenerate after changing Python behaviour or rules:

    python scripts/build_rules_json.py     # rules.yaml -> rules.json, unicodeTables.ts
    python scripts/export_fixtures.py      # (--check fails when the committed fixtures are stale)

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
     (the `Learned` interface); `makeLearned({...})` builds one from lists.
   - `find_application(conn, account_id, ...)` is split into the pure `matchApplication(threadApplicationId, applications, ...)`
     and `findApplication(store, threadId, ...)`, where `store` supplies `threadApplication` and `applicationsFor`
     (sync or async). Applications must be passed oldest first, as `ORDER BY id` does in Python.
   - `mailtext.render` returns a plain string of safe HTML instead of `Markup`.
   - `cleanMailText(body)` is new (not in Python): the message blocks without thread or footer, joined by blank lines.
