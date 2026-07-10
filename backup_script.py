"""
Weekly backup script for the PayLink app (paylink.sramesh.in).

Fetches the entire `paymentLinks` node from the kmbsc-chit Firebase
Realtime Database (publicly readable, no auth needed) and saves it
as a timestamped JSON file under backups/. Also prunes old backups,
keeping only the most recent 12 (~3 months of weekly runs).
"""

import json
import os
import glob
import datetime
import requests

DB_URL = "https://kmbsc-chit-default-rtdb.asia-southeast1.firebasedatabase.app"
ROOT = "paymentLinks"
KEEP_LAST_N = 12


def fetch_data():
    url = f"{DB_URL}/{ROOT}.json"
    resp = requests.get(url, timeout=60)
    resp.raise_for_status()
    return resp.json()


def save_backup(data):
    os.makedirs("backups", exist_ok=True)
    today = datetime.date.today().isoformat()
    path = f"backups/paylink-backup-{today}.json"
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    print(f"Backup saved: {path}")


def prune_old_backups():
    files = sorted(glob.glob("backups/paylink-backup-*.json"))
    if len(files) > KEEP_LAST_N:
        for old_file in files[: len(files) - KEEP_LAST_N]:
            os.remove(old_file)
            print(f"Removed old backup: {old_file}")


def main():
    data = fetch_data()
    save_backup(data)
    prune_old_backups()


if __name__ == "__main__":
    main()
