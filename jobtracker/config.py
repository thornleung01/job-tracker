from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SECRETS_DIR = ROOT / "secrets"  # gitignored; holds OAuth client files and encrypted tokens
OVERLAP_DAYS = 1

GMAIL_SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"]
OUTLOOK_SCOPES = ["Mail.Read"]
# Asked for only when you turn on replying for an account (Settings). Syncing never uses them.
GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send"
OUTLOOK_SEND_SCOPE = "Mail.Send"
OUTLOOK_AUTHORITY = "https://login.microsoftonline.com/common"
