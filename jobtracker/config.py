"""Fixed settings and locations: the secrets folder, mail permissions, sign-in time limits."""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SECRETS_DIR = ROOT / "secrets"  # gitignored; holds OAuth client files and saved sign-ins
DEFAULT_PROFILE = "default"     # the first profile, which keeps the original database and sign-in locations
OVERLAP_DAYS = 1
SIGN_IN_TIMEOUT = 300    # seconds to finish signing in before the providers give up
SIGN_IN_WAIT = SIGN_IN_TIMEOUT + 30     # how long the app keeps showing "waiting", a little past the providers' own limit

GMAIL_SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"]
OUTLOOK_SCOPES = ["Mail.Read"]
# Asked for only when you turn on replying for an account (Settings). Syncing never uses them.
GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send"
OUTLOOK_SEND_SCOPE = "Mail.Send"
OUTLOOK_AUTHORITY = "https://login.microsoftonline.com/common"


def token_dir(profile: str = DEFAULT_PROFILE, root: Path | None = None) -> Path:
    """Where a profile's sign-ins live. The first profile keeps the original location; every other one gets a folder of its own."""
    root = Path(root or SECRETS_DIR)
    return root if profile == DEFAULT_PROFILE else root / "profiles" / profile


# Length limits the pages and the code must agree on: the form field's maxlength and the clamp that backs it up.
NAME_MAX = 80       # a company or a person's name
TITLE_MAX = 100     # a role or a person's job title
