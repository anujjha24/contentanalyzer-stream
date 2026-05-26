"""
MongoDB connection management and index setup.
"""

import os
import logging
from functools import lru_cache

from pymongo import ASCENDING, MongoClient
from pymongo.errors import InvalidURI

logger = logging.getLogger(__name__)

_mongo_client = None
_mongo_db = None
_indexes_ready = False


def get_mongo_client() -> MongoClient:
    global _mongo_client
    if _mongo_client is None:
        uri = os.getenv("MONGO_URI")
        if not uri:
            raise RuntimeError("MONGO_URI environment variable is required")
        try:
            _mongo_client = MongoClient(
                uri,
                appname="content-analyzer-streamlit",
                maxPoolSize=int(os.getenv("MONGO_MAX_POOL_SIZE", "20")),
                minPoolSize=int(os.getenv("MONGO_MIN_POOL_SIZE", "0")),
                serverSelectionTimeoutMS=int(os.getenv("MONGO_SERVER_SELECTION_TIMEOUT_MS", "5000")),
                connectTimeoutMS=int(os.getenv("MONGO_CONNECT_TIMEOUT_MS", "10000")),
                socketTimeoutMS=int(os.getenv("MONGO_SOCKET_TIMEOUT_MS", "20000")),
                retryWrites=True,
            )
        except InvalidURI as exc:
            raise RuntimeError(
                "Invalid MONGO_URI. URL-encode the username/password "
                "(@ as %40, # as %23, / as %2F)."
            ) from exc
    return _mongo_client


def get_database():
    global _mongo_db
    if _mongo_db is None:
        db_name = os.getenv("DB_NAME") or os.getenv("MONGO_DB_NAME", "content_analyzer")
        _mongo_db = get_mongo_client()[db_name]
    return _mongo_db


def ensure_indexes() -> None:
    global _indexes_ready
    if _indexes_ready:
        return

    db = get_database()
    db.processed_files.create_index(
        [("channel_name", ASCENDING), ("date", ASCENDING)],
        name="idx_pf_lookup", unique=True,
    )
    db.processed_files.create_index(
        [("file_id", ASCENDING)], name="idx_pf_file_id", unique=True,
    )
    db.sheets.create_index(
        [("channel_name", ASCENDING), ("date", ASCENDING), ("sheet_name", ASCENDING)],
        name="idx_sheets_lookup", unique=True,
    )
    db.sheets.create_index([("file_id", ASCENDING)], name="idx_sheets_file_id")
    db.brand_modifications.create_index(
        [("channel_name", ASCENDING), ("date", ASCENDING), ("timestamp", ASCENDING)],
        name="idx_bm_lookup",
    )
    _indexes_ready = True
    logger.info("MongoDB indexes ready")


def get_collections():
    ensure_indexes()
    db = get_database()
    return db.processed_files, db.sheets, db.brand_modifications