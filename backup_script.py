"""
Weekly backup script for PayLink (paylink.sramesh.in).

Two things this script has to get right, both learned the hard way.

First, it has to sign in. It used to fetch `paymentLinks` with no auth at all,
on the assumption that the node was publicly readable. When the paylink rules
were tightened that assumption stopped holding, the fetch started coming back
refused, and the weekly backup failed every Sunday from 8 August onward without
anyone noticing. It now signs in as a backup bot with an account of its own, the
same way the reports backup does, so no person's password change can break it.

Second, it has to watch what it writes. This repository is public. An earlier
version copied the `paymentLinks` node out verbatim, which put the master PIN
hash and customers' UPI IDs into a public file. A four digit PIN hashed without
a salt is not protected by being hashed — the whole search space is ten thousand
guesses. So the rule here is an allow-list, not a block-list: only fields named
below are written out. A block-list would quietly leak the next new field that
somebody adds to an entry, and nobody would find out until it was already
public.
"""

import json
import os
import glob
import datetime
import requests

FIREBASE_API_KEY = "AIzaSyBVGVu59jDZybPFAX_pRisSrQRoXHQ0EWY"
DB_URL = "https://kmbsc-chit-default-rtdb.asia-southeast1.firebasedatabase.app"
ROOT = "paymentLinks"
KEEP_LAST_N = 12

def _required_secret(name):
    value = os.environ.get(name)
    if not value:
        raise SystemExit(
            f"The {name} secret is not set on this repository. "
            "Add BACKUP_EMAIL and BACKUP_PASSWORD under "
            "Settings -> Secrets and variables -> Actions, then run this again."
        )
    return value


BACKUP_EMAIL = _required_secret("BACKUP_EMAIL")
BACKUP_PASSWORD = _required_secret("BACKUP_PASSWORD")

# Only these fields of an entry are written to the public backup file. Anything
# not listed is dropped, including anything added to the app in future.
ENTRY_FIELDS_ALLOWED = (
    "amount",
    "openAmount",
    "purpose",
    "refId",
    "status",
    "createdAt",
    "paidAt",
    "expiryDate",
    "neverExpire",
    "views",
)

# Named here only so the log can say plainly what was held back.
ENTRY_FIELDS_WITHHELD = ("name", "upi", "phone", "mobile", "note", "confirms")


def _auth_call(endpoint):
    url = (
        f"https://identitytoolkit.googleapis.com/v1/accounts:{endpoint}"
        f"?key={FIREBASE_API_KEY}"
    )
    return requests.post(
        url,
        json={
            "email": BACKUP_EMAIL,
            "password": BACKUP_PASSWORD,
            "returnSecureToken": True,
        },
        timeout=30,
    )


def _reason(resp):
    try:
        return resp.json().get("error", {}).get("message", "unknown")
    except ValueError:
        return "unknown"


def sign_in():
    """Sign the backup bot in, creating its account on the very first run."""
    resp = _auth_call("signInWithPassword")
    if resp.status_code == 200:
        return resp.json()["idToken"]

    print(f"Sign-in did not succeed ({_reason(resp)}). Trying to create the backup account.")
    resp = _auth_call("signUp")
    if resp.status_code == 200:
        print("Backup account created.")
        return resp.json()["idToken"]

    reason = _reason(resp)
    if reason == "EMAIL_EXISTS":
        raise SystemExit(
            "The backup account exists but the password does not match. "
            "Update the BACKUP_PASSWORD secret, or delete the account in "
            "Firebase Authentication and run this again to recreate it."
        )
    print("Firebase auth failed. Response body:")
    print(resp.text)
    raise SystemExit(f"Could not sign in or sign up: {reason}")


def fetch_data(id_token):
    url = f"{DB_URL}/{ROOT}.json?auth={id_token}"
    resp = requests.get(url, timeout=60)
    if resp.status_code == 401:
        raise SystemExit(
            "The database refused the read. The backup bot needs read access to "
            f"/{ROOT} in the Firebase rules."
        )
    resp.raise_for_status()
    return resp.json()


def redact(data):
    """Keep only allow-listed fields. Returns the safe copy and what was held back."""
    if not isinstance(data, dict):
        return {}, []

    entries = data.get("entries")
    if not isinstance(entries, dict):
        return {}, []

    withheld = set()
    for key in data:
        if key != "entries":
            withheld.add(key)

    safe_entries = {}
    for entry_id, entry in entries.items():
        if not isinstance(entry, dict):
            continue
        safe = {}
        for field, value in entry.items():
            if field in ENTRY_FIELDS_ALLOWED:
                safe[field] = value
            else:
                withheld.add(field)
        safe_entries[entry_id] = safe

    return {"entries": safe_entries}, sorted(withheld)


def save_backup(data):
    os.makedirs("backups", exist_ok=True)
    today = datetime.date.today().isoformat()
    path = f"backups/paylink-backup-{today}.json"

    data, withheld = redact(data)
    if not data.get("entries"):
        raise SystemExit("Nothing left to back up, refusing to write an empty file.")

    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    print(f"Backup saved: {path}")
    print(f"Entries backed up: {len(data['entries'])}")
    if withheld:
        print("Held back from this public file:", ", ".join(withheld))


def prune_old_backups():
    files = sorted(glob.glob("backups/paylink-backup-*.json"))
    if len(files) > KEEP_LAST_N:
        for old_file in files[: len(files) - KEEP_LAST_N]:
            os.remove(old_file)
            print(f"Removed old backup: {old_file}")


def main():
    id_token = sign_in()
    data = fetch_data(id_token)
    save_backup(data)
    prune_old_backups()


if __name__ == "__main__":
    main()
