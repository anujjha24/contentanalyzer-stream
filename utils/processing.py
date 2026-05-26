"""
File processing: run comparison, parse sheets, upload to MongoDB.
All previously subprocess-based logic is now direct Python function calls.
"""

import io
import uuid
import logging
from pathlib import Path

import pandas as pd
from bson.binary import Binary

from utils.db import get_collections
from utils.helpers import build_filename, utc_now_iso, clean_num, parse_count_cell, workbook_bytes_from_document

logger = logging.getLogger(__name__)


def run_comparison(file_bytes: bytes, original_name: str) -> tuple:
    """
    Run barc_nct_comparison logic directly (no subprocess).
    Returns (xlsx_bytes, output_filename, stats).
    """
    import barc_nct_comparison as bnc

    stats = {}

    # Extract channel/date metadata from the uploaded file
    try:
        df = pd.read_excel(io.BytesIO(file_bytes), dtype=str)
        source_series = df.get("source", pd.Series([""] * len(df)))
        normalized = source_series.fillna("").astype(str).str.upper().str.strip()
        df_barc = df[normalized == "BARC XML"]

        if len(df_barc):
            channel = str(df_barc["channel name"].iloc[0])
            date_val = str(df_barc["TelecastDate"].iloc[0])
            stats["channel"] = channel
            stats["date"] = date_val
            stats["barc_rows"] = int(len(df_barc))
            stats["nct_rows"] = int((normalized == "NCT").sum())
    except Exception as exc:
        stats["metadata_error"] = str(exc)

    output_filename = build_filename(
        stats.get("channel", "UNKNOWN"),
        stats.get("date", "00/00/0000")
    ) + ".xlsx"

    # Run the comparison as a library function
    try:
        xlsx_bytes = bnc.run_comparison_from_bytes(file_bytes)
    except Exception as exc:
        raise RuntimeError(f"Comparison failed: {exc}") from exc

    return xlsx_bytes, output_filename, stats


def parse_workbook_sheets(xlsx_bytes: bytes, file_id: str, channel_name: str, date_str: str) -> list:
    """Parse all Excel sheets into a list of MongoDB-ready documents."""
    uploaded_at = utc_now_iso()
    sheet_documents = []
    xls = pd.ExcelFile(io.BytesIO(xlsx_bytes))

    for sheet_name in xls.sheet_names:
        df = pd.read_excel(xls, sheet_name=sheet_name, dtype=str, header=None)
        rows_data = []
        for _, row in df.iterrows():
            rows_data.append([str(v) if pd.notna(v) else "" for v in row])

        headers = rows_data[0] if rows_data else []
        sheet_documents.append({
            "file_id": file_id,
            "channel_name": channel_name,
            "date": date_str,
            "sheet_name": sheet_name,
            "headers": headers,
            "rows": rows_data,
            "row_count": len(rows_data),
            "col_count": len(headers),
            "uploaded_at": uploaded_at,
        })

    return sheet_documents


def upload_to_db(xlsx_bytes: bytes, channel_name: str, date_str: str, original_filename: str) -> str:
    """Store processed Excel workbook and parsed sheets in MongoDB."""
    processed_files, sheets, _ = get_collections()
    file_id = str(uuid.uuid4())
    uploaded_at = utc_now_iso()
    sheet_documents = parse_workbook_sheets(xlsx_bytes, file_id, channel_name, date_str)

    file_document = {
        "file_id": file_id,
        "channel_name": channel_name,
        "date": date_str,
        "original_filename": original_filename,
        "xlsx_data": Binary(xlsx_bytes),
        "uploaded_at": uploaded_at,
    }

    lookup = {"channel_name": channel_name, "date": date_str}
    sheets.delete_many(lookup)
    processed_files.replace_one(lookup, file_document, upsert=True)
    if sheet_documents:
        sheets.insert_many(sheet_documents)

    logger.info("Stored %d sheets for %s / %s", len(sheet_documents), channel_name, date_str)
    return file_id


# ── Dashboard data extraction ─────────────────────────────────────────────────

def get_dashboard_data(channel: str, date: str, source: str, data_type: str) -> dict:
    _, sheets, _ = get_collections()
    row = sheets.find_one(
        {"channel_name": channel, "date": date, "sheet_name": "TABSONS SUMMARY"},
        {"_id": 0, "headers": 1, "rows": 1},
    )
    if not row:
        raise ValueError("No data found for this channel/date")

    all_rows = row.get("rows") or []
    headers  = all_rows[1] if len(all_rows) > 1 else row.get("headers", [])
    data_row = all_rows[2] if len(all_rows) > 2 else []

    def get_val(keyword, r=data_row, hdrs=headers):
        for i, h in enumerate(hdrs):
            if keyword.upper() in str(h).upper() and i < len(r):
                return r[i]
        return "0"

    result = {"source": source, "data_type": data_type}

    if source == "TABSONS":
        if data_type == "COUNT":
            result.update({
                "total_line_item": clean_num(get_val("TABSONS LINE ITEM")),
                "commercial": clean_num(get_val("TABSONS COMMERCIAL COUNT")),
                "promo": clean_num(get_val("TABSONS PROMO COUNT")),
                "promo_sponsor": clean_num(get_val("TABSONS PROMO SPONSOR COUNT")),
                "program": clean_num(get_val("TABSONS PROGRAM COUNT")),
            })
        else:
            result.update({
                "total_line_item": get_val("TABSONS DURATION"),
                "commercial": get_val("TABSONS COMMERCIAL DURATION"),
                "promo": get_val("TABSONS PROMO DURATION"),
                "promo_sponsor": get_val("TABSONS PROMO SPONSOR COUNT DURATIO"),
                "program": get_val("TABSONS PROGRAM DURATION"),
            })

    elif source == "BARC XML":
        if data_type == "COUNT":
            result.update({
                "total_line_item": clean_num(get_val("BARC LINE ITEM")),
                "commercial": clean_num(get_val("BARC COMMERCIAL COUNT")),
                "promo": clean_num(get_val("BARC PROMO COUNT")),
                "promo_sponsor": clean_num(get_val("BARC PROMO SPONSOR COUNT")),
                "program": clean_num(get_val("BARC PROGRAM COUNT")),
            })
        else:
            result.update({
                "total_line_item": get_val("BARC DURATION"),
                "commercial": get_val("BARC COMMERCIAL DURATION"),
                "promo": get_val("BARC PROMO DURATION"),
                "promo_sponsor": get_val("BARC PROMO SPONSOR COUNT DURATION"),
                "program": get_val("BARC PROGRAM DURATION"),
            })

    else:  # TABSONS-BARC
        if data_type == "COUNT":
            result.update({
                "tabsons_total": clean_num(get_val("TABSONS LINE ITEM")),
                "tabsons_commercial": clean_num(get_val("TABSONS COMMERCIAL COUNT")),
                "tabsons_promo": clean_num(get_val("TABSONS PROMO COUNT")),
                "tabsons_promo_sponsor": clean_num(get_val("TABSONS PROMO SPONSOR COUNT")),
                "tabsons_program": clean_num(get_val("TABSONS PROGRAM COUNT")),
                "barc_total": clean_num(get_val("BARC LINE ITEM")),
                "barc_commercial": clean_num(get_val("BARC COMMERCIAL COUNT")),
                "barc_promo": clean_num(get_val("BARC PROMO COUNT")),
                "barc_promo_sponsor": clean_num(get_val("BARC PROMO SPONSOR COUNT")),
                "barc_program": clean_num(get_val("BARC PROGRAM COUNT")),
            })
        else:
            result.update({
                "tabsons_total": get_val("TABSONS DURATION"),
                "tabsons_commercial": get_val("TABSONS COMMERCIAL DURATION"),
                "tabsons_promo": get_val("TABSONS PROMO DURATION"),
                "tabsons_promo_sponsor": get_val("TABSONS PROMO SPONSOR COUNT DURATIO"),
                "tabsons_program": get_val("TABSONS PROGRAM DURATION"),
                "barc_total": get_val("BARC DURATION"),
                "barc_commercial": get_val("BARC COMMERCIAL DURATION"),
                "barc_promo": get_val("BARC PROMO DURATION"),
                "barc_promo_sponsor": get_val("BARC PROMO SPONSOR COUNT DURATION"),
                "barc_program": get_val("BARC PROGRAM DURATION"),
            })

    return result