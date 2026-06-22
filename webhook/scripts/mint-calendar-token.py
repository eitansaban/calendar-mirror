#!/usr/bin/env python3
"""
One-time helper: mint a CALENDAR-ONLY OAuth refresh token for the webhook.

Requests only the calendar scope, so the credential that ends up living in the
cloud has the smallest possible blast radius.

Usage:
    python scripts/mint-calendar-token.py [path/to/client_secret.json]

Defaults to ./client_secret.json if no path is given. Opens a browser for
consent once, then prints the three env vars to set in your host (e.g. Vercel).
Nothing is written to disk.

Requires: pip install google-auth-oauthlib
"""

import sys
import os
from google_auth_oauthlib.flow import InstalledAppFlow

SCOPES = ["https://www.googleapis.com/auth/calendar"]

DEFAULT_SECRET = os.path.join(os.getcwd(), "client_secret.json")


def main() -> None:
    secret_path = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_SECRET
    if not os.path.exists(secret_path):
        sys.exit(
            f"client_secret.json not found at: {secret_path}\n"
            "Pass the path explicitly: python scripts/mint-calendar-token.py /path/to/client_secret.json"
        )

    flow = InstalledAppFlow.from_client_secrets_file(secret_path, SCOPES)
    # access_type=offline + prompt=consent guarantees a refresh_token is returned.
    creds = flow.run_local_server(port=0, access_type="offline", prompt="consent")

    if not creds.refresh_token:
        sys.exit("No refresh_token returned. Re-run; ensure you grant consent fresh.")

    print("\n" + "=" * 64)
    print("Paste these into the Vercel project's Environment Variables:")
    print("=" * 64)
    print(f"GOOGLE_CLIENT_ID={creds.client_id}")
    print(f"GOOGLE_CLIENT_SECRET={creds.client_secret}")
    print(f"GOOGLE_REFRESH_TOKEN={creds.refresh_token}")
    print("=" * 64)
    print("Scope granted:", " ".join(SCOPES))


if __name__ == "__main__":
    main()
