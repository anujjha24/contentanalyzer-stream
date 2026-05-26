"""
Shared serialization helpers, JSON utilities, and small value converters.
"""

import re
import json
from datetime import datetime
from pathlib import Path

from bson.binary import Binary
from bson.decimal128 import Decimal128
from bson.objectid import ObjectId

import pandas as pd


def to_json_safe(value):
    """Recursively convert MongoDB/BSON and pandas values into JSON-safe data."""
    if isinstance(value, ObjectId):
        return str(value)
    if isinstance(value, Decimal128):
        return str(value)
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, Binary):
        return f"<binary {len(value)} bytes>"
    if isinstance(value, (bytes, bytearray, memoryview)):
        return f"<binary {len(value)} bytes>"
    if isinstance(value, Path):
        return str(value)
    if isinstance(value, dict):
        return {str(to_json_safe(k)): to_json_safe(v) for k, v in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [to_json_safe(item) for item in value]

    try:
        if pd.isna(value):
            return None
    except (TypeError, ValueError):
        pass

    if hasattr(value, "item"):
        try:
            return value.item()
        except (TypeError, ValueError):
            pass

    return value


def utc_now_iso() -> str:
    return datetime.utcnow().isoformat()


def clean_num(val):
    if not val or val in ("None", "nan"):
        return 0
    text = str(val).replace(",", "").strip()
    try:
        return int(float(text))
    except (ValueError, TypeError):
        return 0


def parse_count_cell(value) -> int:
    text = str(value or "").strip()
    if text in {"", "-", "\u2013", "\u2014"}:
        return 0
    match = re.search(r"-?\d+(?:\.\d+)?", text.replace(",", ""))
    if not match:
        return 0
    try:
        return int(float(match.group(0)))
    except (TypeError, ValueError):
        return 0


def build_filename(channel: str, date_str: str) -> str:
    channel_clean = re.sub(r"[^A-Z0-9]", "", str(channel).upper().strip()) or "UNKNOWN"
    match = re.match(r"^(\d{2})/(\d{2})/(\d{4})$", str(date_str).strip())
    if match:
        date_clean = f"{match.group(1)}{match.group(2)}{match.group(3)}"
    else:
        iso_match = re.match(r"^(\d{4})-(\d{2})-(\d{2})", str(date_str).strip())
        date_clean = (
            f"{iso_match.group(3)}{iso_match.group(2)}{iso_match.group(1)}"
            if iso_match else "00000000"
        )
    return f"{channel_clean}({date_clean}) barc_nct_comparison"


def workbook_bytes_from_document(document) -> bytes:
    return bytes(document.get("xlsx_data") or b"")