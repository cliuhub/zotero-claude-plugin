#!/usr/bin/env python3

import argparse
import html
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path


DEFAULT_BASE_URL = "http://127.0.0.1:23119"
DEFAULT_READ_API_ROOT = f"{DEFAULT_BASE_URL}/api/users/0"
DEFAULT_COMMAND_URL = f"{DEFAULT_BASE_URL}/agent/command"
DOI_LOOKUP_BASE_ENV = "ZOTERO_DOI_LOOKUP_BASE_URL"
DOI_CSL_CONTENT_TYPE = "application/vnd.citationstyles.csl+json"
PDF_EXTRACTOR_OVERRIDE_ENV = "ZOTERO_PDF_TEXT_HELPER"
PDF_OCR_HELPER_OVERRIDE_ENV = "ZOTERO_PDF_OCR_HELPER"
PDF_EXTRACTOR_SCALE_ENV = "ZOTERO_PDF_OCR_SCALE"
OCR_MYPDF_BIN_ENV = "ZOTERO_OCRMYPDF_BIN"
OCR_MYPDF_LANG_ENV = "ZOTERO_OCRMYPDF_LANGUAGE"
EXTRACTOR_ALIASES = {
    "auto": "auto",
    "pdf": "pdf",
    "local-pdf": "pdf",
    "pypdf": "pypdf",
    "local-pypdf": "pypdf",
    "ocr": "ocr",
    "local-ocr": "ocr",
    "ocrmypdf": "ocrmypdf-redo",
    "local-ocrmypdf": "ocrmypdf-redo",
    "ocrmypdf-redo": "ocrmypdf-redo",
    "local-ocrmypdf-redo": "ocrmypdf-redo",
    "ocrmypdf-force": "ocrmypdf-force",
    "local-ocrmypdf-force": "ocrmypdf-force",
    "zotero": "zotero",
}
CANONICAL_EXTRACTOR_NAMES = [
    "auto",
    "pdf",
    "pypdf",
    "ocr",
    "ocrmypdf-redo",
    "ocrmypdf-force",
    "zotero",
]
ATTACHMENT_LINK_MODE_PRIORITY = {
    "imported_file": 4,
    "linked_file": 3,
    "imported_url": 2,
    "linked_url": 1,
}


def print_json(value):
    print(json.dumps(value, indent=2, sort_keys=True))


def success_payload(command, data):
    return {
        "ok": True,
        "command": command,
        "data": data,
    }


def error_payload(command, code, message, details=None):
    return {
        "ok": False,
        "command": command,
        "error": {
            "code": code,
            "message": message,
            "details": details or {},
        },
    }


def normalize_extractor_name(value):
    lowered = (value or "").strip().lower()
    if lowered in EXTRACTOR_ALIASES:
        return EXTRACTOR_ALIASES[lowered]
    raise argparse.ArgumentTypeError(
        "extractor must be one of: " + ", ".join(CANONICAL_EXTRACTOR_NAMES)
    )


def extract_entry_data(entry):
    if isinstance(entry, dict) and isinstance(entry.get("data"), dict):
        return entry["data"]
    if isinstance(entry, dict):
        return entry
    return {}


def extract_entry_links(entry):
    if isinstance(entry, dict) and isinstance(entry.get("links"), dict):
        return entry["links"]
    return {}


def extract_entry_meta(entry):
    if isinstance(entry, dict) and isinstance(entry.get("meta"), dict):
        return entry["meta"]
    return {}


def extract_entry_library(entry):
    if isinstance(entry, dict) and isinstance(entry.get("library"), dict):
        return entry["library"]
    return {}


def extract_key_from_href(value):
    if not isinstance(value, str) or not value:
        return None
    parsed = urllib.parse.urlparse(value)
    path = parsed.path.rstrip("/")
    if not path:
        return None
    return path.rsplit("/", 1)[-1] or None


def file_uri_to_path(value):
    if not isinstance(value, str) or not value.startswith("file://"):
        return None
    parsed = urllib.parse.urlparse(value)
    return urllib.parse.unquote(parsed.path) if parsed.path else None


def strip_html(value):
    if value is None:
        return ""
    text = re.sub(r"<br\s*/?>", "\n", str(value), flags=re.IGNORECASE)
    text = re.sub(r"</p\s*>", "\n\n", text, flags=re.IGNORECASE)
    text = re.sub(r"<[^>]+>", "", text)
    text = html.unescape(text)
    text = text.replace("\xa0", " ")
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def summarize_text(value, limit=160):
    text = re.sub(r"\s+", " ", (value or "")).strip()
    if len(text) <= limit:
        return text
    return text[: limit - 1].rstrip() + "…"


def normalize_tags(tags):
    if not isinstance(tags, list):
        return []
    normalized = []
    for entry in tags:
        if isinstance(entry, dict):
            tag = entry.get("tag")
        else:
            tag = entry
        if isinstance(tag, str) and tag.strip():
            normalized.append(tag.strip())
    return normalized


def normalize_creators(creators):
    if not isinstance(creators, list):
        return []
    normalized = []
    for creator in creators:
        if isinstance(creator, dict):
            normalized.append(creator)
    return normalized


def version_from_entry(entry, fields):
    if isinstance(entry, dict) and entry.get("version") is not None:
        return entry.get("version")
    return fields.get("version")


def normalize_collection_entry(entry):
    fields = extract_entry_data(entry)
    meta = extract_entry_meta(entry)
    library = extract_entry_library(entry)
    parent_collection_key = fields.get("parentCollection")
    if parent_collection_key is False:
        parent_collection_key = None
    return {
        "collectionKey": fields.get("key") or entry.get("key"),
        "name": fields.get("name"),
        "parentCollectionKey": parent_collection_key,
        "itemCount": meta.get("numItems"),
        "childCollectionCount": meta.get("numCollections"),
        "version": version_from_entry(entry, fields),
        "libraryID": library.get("id"),
        "libraryName": library.get("name"),
        "fields": fields,
    }


def normalize_item_entry(entry):
    fields = extract_entry_data(entry)
    meta = extract_entry_meta(entry)
    library = extract_entry_library(entry)
    links = extract_entry_links(entry)
    attachment_link = links.get("attachment") if isinstance(links.get("attachment"), dict) else None
    best_attachment = None
    if attachment_link:
        best_attachment = {
            "attachmentKey": extract_key_from_href(attachment_link.get("href")),
            "contentType": attachment_link.get("attachmentType"),
            "size": attachment_link.get("attachmentSize"),
        }
    return {
        "itemKey": fields.get("key") or entry.get("key"),
        "itemType": fields.get("itemType"),
        "title": fields.get("title"),
        "parentItemKey": fields.get("parentItem"),
        "collectionKeys": fields.get("collections") if isinstance(fields.get("collections"), list) else [],
        "tags": normalize_tags(fields.get("tags")),
        "creators": normalize_creators(fields.get("creators")),
        "date": fields.get("date"),
        "dateAdded": fields.get("dateAdded"),
        "dateModified": fields.get("dateModified"),
        "doi": fields.get("DOI"),
        "url": fields.get("url"),
        "publicationTitle": fields.get("publicationTitle"),
        "abstractNote": fields.get("abstractNote"),
        "creatorSummary": meta.get("creatorSummary"),
        "childCount": meta.get("numChildren"),
        "parsedDate": meta.get("parsedDate"),
        "bestAttachment": best_attachment,
        "version": version_from_entry(entry, fields),
        "libraryID": library.get("id"),
        "libraryName": library.get("name"),
        "fields": fields,
    }


def normalize_attachment_entry(entry):
    fields = extract_entry_data(entry)
    links = extract_entry_links(entry)
    enclosure = links.get("enclosure") if isinstance(links.get("enclosure"), dict) else {}
    local_path = file_uri_to_path(enclosure.get("href"))
    return {
        "attachmentKey": fields.get("key") or entry.get("key"),
        "parentItemKey": fields.get("parentItem"),
        "title": fields.get("title"),
        "filename": fields.get("filename"),
        "contentType": fields.get("contentType"),
        "linkMode": fields.get("linkMode"),
        "dateAdded": fields.get("dateAdded"),
        "dateModified": fields.get("dateModified"),
        "size": enclosure.get("length"),
        "fileURL": enclosure.get("href"),
        "localPath": local_path,
        "version": version_from_entry(entry, fields),
        "fields": fields,
    }


def normalize_note_entry(entry, include_content=True):
    fields = extract_entry_data(entry)
    note_html = fields.get("note") or ""
    note_text = strip_html(note_html)
    payload = {
        "noteKey": fields.get("key") or entry.get("key"),
        "parentItemKey": fields.get("parentItem"),
        "title": summarize_text(note_text, limit=80) or "(empty note)",
        "preview": summarize_text(note_text, limit=200),
        "dateAdded": fields.get("dateAdded"),
        "dateModified": fields.get("dateModified"),
        "version": version_from_entry(entry, fields),
        "fields": fields,
    }
    if include_content:
        payload["noteHtml"] = note_html
        payload["noteText"] = note_text
    return payload


def normalize_payload(data, normalizer):
    if isinstance(data, list):
        return [normalizer(entry) for entry in data]
    if isinstance(data, dict):
        return normalizer(data)
    return data


def normalize_api_root(args):
    if args.api_root:
        return args.api_root.rstrip("/")
    return f"{args.base_url.rstrip('/')}/api/users/0"


def normalize_command_url(args):
    if args.command_url:
        return args.command_url.rstrip("/")
    return f"{args.base_url.rstrip('/')}/agent/command"


def build_url(api_root, path, params=None):
    url = f"{api_root.rstrip('/')}/{path.lstrip('/')}"
    query = {}
    for key, value in (params or {}).items():
        if value is None or value == "":
            continue
        query[key] = value
    if query:
        return f"{url}?{urllib.parse.urlencode(query, doseq=True)}"
    return url


def decode_json_response(response):
    charset = response.headers.get_content_charset("utf-8")
    body = response.read().decode(charset)
    if not body:
        return {}
    return json.loads(body)


def request_json(url, method="GET", payload=None, headers=None):
    request_headers = {
        "Accept": "application/json",
    }
    data = None
    if payload is not None:
        data = json.dumps(payload).encode("utf-8")
        request_headers["Content-Type"] = "application/json"
    if headers:
        request_headers.update(headers)
    request = urllib.request.Request(url, data=data, headers=request_headers, method=method)
    with urllib.request.urlopen(request) as response:
        return decode_json_response(response)


def fetch_read_json(args, command, path, params=None, normalizer=None):
    url = build_url(normalize_api_root(args), path, params)
    data = request_json(url)
    if normalizer:
        data = normalize_payload(data, normalizer)
    return success_payload(command, data)


def plugin_command(args, command, command_args):
    try:
        command_url = normalize_command_url(args)
        return request_json(
            command_url,
            method="POST",
            payload={
                "command": command,
                "args": command_args,
            },
        )
    except urllib.error.HTTPError as error:
        body = error.read().decode("utf-8", errors="replace")
        if body:
            try:
                return json.loads(body)
            except json.JSONDecodeError:
                pass
        if error.code == 404:
            return error_payload(
                command,
                "PLUGIN_ENDPOINT_NOT_AVAILABLE",
                "Zotero write bridge is not loaded at /agent/command. Install or enable the add-on and restart Zotero.",
                {
                    "status": error.code,
                    "reason": error.reason,
                    "url": getattr(error, "url", None),
                    "hint": "From this repo, run `npm run install:source`, then restart Zotero.",
                },
            )
        return error_payload(
            command,
            "HTTP_ERROR",
            "Request to plugin command endpoint failed",
            {
                "status": error.code,
                "reason": error.reason,
                "url": getattr(error, "url", None),
            },
        )
    except urllib.error.URLError as error:
        return error_payload(
            command,
            "CONNECTION_ERROR",
            "Could not connect to the Zotero plugin command endpoint",
            {"reason": str(error.reason)},
        )


def not_implemented_payload(command, details=None):
    return error_payload(
        command,
        "NOT_IMPLEMENTED",
        f"{command} is not implemented in this scaffold yet",
        details,
    )


def repo_root():
    return Path(__file__).resolve().parent.parent


def ensure_pdf_text_helper():
    override = os.environ.get(PDF_EXTRACTOR_OVERRIDE_ENV)
    if override:
        return Path(override).expanduser()
    return repo_root() / "scripts" / "pdf_text_extract.py"


def run_pdf_text_helper(path, mode):
    helper = ensure_pdf_text_helper()
    result = subprocess.run(
        [
            "python3",
            str(helper),
            "--path",
            path,
            "--mode",
            mode,
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or result.stdout.strip() or "PDF parser helper failed")
    payload = json.loads(result.stdout)
    if not payload.get("ok"):
        raise RuntimeError(payload.get("error", {}).get("message", "PDF parser helper failed"))
    return payload


def ensure_pdf_ocr_helper():
    override = os.environ.get(PDF_OCR_HELPER_OVERRIDE_ENV)
    if override:
        return Path(override).expanduser()

    source = repo_root() / "scripts" / "pdf_text_extract.swift"
    binary = repo_root() / ".local" / "bin" / "pdf_text_extract"
    binary.parent.mkdir(parents=True, exist_ok=True)

    if not binary.exists() or source.stat().st_mtime > binary.stat().st_mtime:
        result = subprocess.run(
            ["swiftc", str(source), "-o", str(binary)],
            capture_output=True,
            text=True,
            check=False,
        )
        if result.returncode != 0:
            raise RuntimeError(
                "Failed to build local PDF OCR helper: "
                + (result.stderr.strip() or result.stdout.strip() or "unknown swiftc error")
            )
    return binary


def run_pdf_ocr_helper(path, mode):
    helper = ensure_pdf_ocr_helper()
    scale = os.environ.get(PDF_EXTRACTOR_SCALE_ENV, "2.0")
    result = subprocess.run(
        [
            str(helper),
            "--path",
            path,
            "--mode",
            mode,
            "--scale",
            scale,
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        raise RuntimeError(result.stderr.strip() or result.stdout.strip() or "PDF OCR helper failed")
    payload = json.loads(result.stdout)
    if not payload.get("ok"):
        raise RuntimeError(payload.get("error", {}).get("message", "PDF OCR helper failed"))
    return payload


def resolve_ocrmypdf_binary():
    override = os.environ.get(OCR_MYPDF_BIN_ENV)
    if override:
        return str(Path(override).expanduser())

    binary = "ocrmypdf"
    if shutil.which(binary := "ocrmypdf"):
        return binary
    raise RuntimeError(
        "OCRmyPDF is not installed. Install it with `brew install ocrmypdf`, or set "
        f"{OCR_MYPDF_BIN_ENV} to a working binary."
    )


def run_ocrmypdf_helper(path, mode):
    binary = resolve_ocrmypdf_binary()
    language = os.environ.get(OCR_MYPDF_LANG_ENV, "eng")

    with tempfile.TemporaryDirectory(prefix="zotero-ocrmypdf-") as temp_dir:
        temp_path = Path(temp_dir)
        output_pdf = temp_path / "ocr-output.pdf"
        command = [
            binary,
            "--language",
            language,
            "--mode",
            mode,
            "--output-type",
            "pdf",
            path,
            str(output_pdf),
        ]
        result = subprocess.run(
            command,
            capture_output=True,
            text=True,
            check=False,
        )
        if result.returncode != 0:
            raise RuntimeError(result.stderr.strip() or result.stdout.strip() or "OCRmyPDF failed")
        if not output_pdf.exists():
            raise RuntimeError("OCRmyPDF did not produce an output PDF")

        extraction = run_pdf_text_helper(str(output_pdf), "pdf")
        extraction["extractor"] = f"local-ocrmypdf-{mode}"
        extraction["ocrmypdfMode"] = mode
        extraction["ocrmypdfLanguage"] = language
        extraction["ocrmypdfBinary"] = binary
        return extraction


def attachment_path_payload(args, attachment_key):
    return plugin_command(
        args,
        "attachments.path",
        {"attachmentKey": attachment_key},
    )


def zotero_attachment_text_payload(args, attachment_key):
    return plugin_command(
        args,
        "attachments.readText",
        {"attachmentKey": attachment_key},
    )


def filter_items_by_type(data, item_type):
    if not isinstance(data, list):
        return data
    matches = []
    for entry in data:
        entry_type = extract_entry_data(entry).get("itemType")
        if entry_type == item_type:
            matches.append(entry)
    return matches


def filter_attachment_items(data):
    return filter_items_by_type(data, "attachment")


def filter_note_items(data):
    return filter_items_by_type(data, "note")


def read_note_input(args):
    if bool(args.note) == bool(args.note_file):
        raise ValueError("provide exactly one of --note or --note-file")
    if args.note_file:
        return Path(args.note_file).read_text(encoding="utf-8")
    return args.note


def attachment_rank(attachment):
    if attachment.get("contentType") != "application/pdf":
        return -1
    score = 100
    score += ATTACHMENT_LINK_MODE_PRIORITY.get(attachment.get("linkMode"), 0) * 10
    if attachment.get("localPath"):
        score += 8
    title = (attachment.get("title") or "").lower()
    filename = (attachment.get("filename") or "").lower()
    if "full text" in title:
        score += 6
    if "pdf" in title:
        score += 3
    if filename.endswith(".pdf"):
        score += 2
    return score


def choose_best_pdf_attachment(attachments):
    pdfs = [attachment for attachment in attachments if attachment.get("contentType") == "application/pdf"]
    if not pdfs:
        return None
    return sorted(
        pdfs,
        key=lambda attachment: (
            attachment_rank(attachment),
            attachment.get("dateAdded") or "",
            attachment.get("attachmentKey") or "",
        ),
        reverse=True,
    )[0]


def should_retry_with_ocr(extraction):
    text = (extraction or {}).get("text") or ""
    normalized = re.sub(r"\s+", " ", text).strip().lower()
    if not normalized:
        return True
    if normalized.count("reproduced with permission of the copyright owner") >= 3:
        return True

    pages = [
        page for page in (extraction or {}).get("pages", [])
        if isinstance(page, dict) and isinstance(page.get("textChars"), int)
    ]
    if len(pages) >= 4:
        average_chars = sum(page["textChars"] for page in pages) / len(pages)
        if average_chars < 350:
            return True
    return False


def merge_attachment_metadata(*attachments):
    merged = {}
    for attachment in attachments:
        if isinstance(attachment, dict):
            for key, value in attachment.items():
                if value is None:
                    continue
                merged[key] = value
    return merged


def attachment_read_text_payload(args, attachment, command_name):
    attachment_key = attachment.get("attachmentKey")
    requested_extractor = args.extractor
    if args.extractor == "zotero":
        payload = zotero_attachment_text_payload(args, attachment_key)
        if not payload.get("ok"):
            return payload
        text = payload.get("data", {}).get("text") or ""
        return success_payload(
            command_name,
            merge_attachment_metadata(
                attachment,
                payload.get("data"),
                {
                    "text": text,
                    "textChars": len(text),
                    "extraction": {
                        "extractor": "zotero",
                        "mode": "zotero",
                        "requestedMode": requested_extractor,
                    },
                },
            ),
        )

    if attachment.get("contentType") != "application/pdf":
        payload = zotero_attachment_text_payload(args, attachment_key)
        if not payload.get("ok"):
            return payload
        text = payload.get("data", {}).get("text") or ""
        return success_payload(
            command_name,
            merge_attachment_metadata(
                attachment,
                payload.get("data"),
                {
                    "text": text,
                    "textChars": len(text),
                    "extraction": {
                        "extractor": "zotero",
                        "mode": "zotero",
                        "requestedMode": requested_extractor,
                    },
                },
            ),
        )

    path = attachment.get("path")
    try:
        if args.extractor == "auto":
            helper_mode = "pdf"
            extraction = run_pdf_text_helper(path, helper_mode)
            if should_retry_with_ocr(extraction):
                try:
                    helper_mode = "ocrmypdf-redo"
                    extraction = run_ocrmypdf_helper(path, "redo")
                except Exception:
                    helper_mode = "ocr"
                    extraction = run_pdf_ocr_helper(path, helper_mode)
        elif args.extractor == "ocr":
            helper_mode = "ocr"
            extraction = run_pdf_ocr_helper(path, helper_mode)
        elif args.extractor == "ocrmypdf-redo":
            helper_mode = "ocrmypdf-redo"
            extraction = run_ocrmypdf_helper(path, "redo")
        elif args.extractor == "ocrmypdf-force":
            helper_mode = "ocrmypdf-force"
            extraction = run_ocrmypdf_helper(path, "force")
        else:
            helper_mode = args.extractor
            extraction = run_pdf_text_helper(path, helper_mode)
    except Exception as error:
        if args.extractor in {"ocrmypdf-redo", "ocrmypdf-force"}:
            code = "LOCAL_PDF_OCRMYPDF_FAILED"
        elif args.extractor == "ocr":
            code = "LOCAL_PDF_OCR_FAILED"
        else:
            code = "LOCAL_PDF_PARSE_FAILED"
        return error_payload(
            command_name,
            code,
            str(error),
            {
                "attachmentKey": attachment_key,
                "path": path,
                "extractor": args.extractor,
            },
        )

    text = extraction["text"]
    return success_payload(
        command_name,
        merge_attachment_metadata(
            attachment,
            {
                "text": text,
                "textChars": len(text),
                "extraction": {
                "extractor": extraction.get("extractor"),
                "mode": helper_mode,
                "requestedMode": requested_extractor,
                "pageCount": extraction.get("pageCount"),
                "selectedPages": extraction.get("selectedPages"),
                "pages": extraction.get("pages"),
                    "renderToolAvailable": extraction.get("renderToolAvailable"),
                    "ocrmypdfMode": extraction.get("ocrmypdfMode"),
                    "ocrmypdfLanguage": extraction.get("ocrmypdfLanguage"),
                    "ocrmypdfBinary": extraction.get("ocrmypdfBinary"),
                },
            },
        ),
    )


def parse_csv(value):
    if value is None:
        return []
    return [entry.strip() for entry in value.split(",") if entry.strip()]


def parse_json_object(value, field):
    if value is None:
        return {}
    parsed = json.loads(value)
    if not isinstance(parsed, dict):
        raise ValueError(f"{field} must decode to a JSON object")
    return parsed


def normalize_doi(value):
    if value is None:
        raise ValueError("doi is required")
    cleaned = value.strip()
    if not cleaned:
        raise ValueError("doi is required")
    cleaned = re.sub(r"^doi:\s*", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"^https?://(?:dx\.)?doi\.org/", "", cleaned, flags=re.IGNORECASE)
    match = re.search(r"(10\.\d{4,9}/\S+)", cleaned, flags=re.IGNORECASE)
    if not match:
        raise ValueError(f"Could not extract a DOI from {value!r}")
    return match.group(1).rstrip(").,;]")


def csl_text(value):
    if isinstance(value, list):
        for entry in value:
            text = csl_text(entry)
            if text:
                return text
        return None
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def csl_date(value):
    if not isinstance(value, dict):
        return None
    date_parts = value.get("date-parts")
    if not isinstance(date_parts, list) or not date_parts:
        return None
    first = date_parts[0]
    if not isinstance(first, list) or not first:
        return None
    parts = [str(part) for part in first[:3] if part is not None]
    if not parts:
        return None
    if len(parts) == 1:
        return parts[0]
    if len(parts) == 2:
        return f"{parts[0]}-{parts[1].zfill(2)}"
    return f"{parts[0]}-{parts[1].zfill(2)}-{parts[2].zfill(2)}"


def csl_creators(data):
    creator_map = {
        "author": "author",
        "editor": "editor",
        "translator": "translator",
        "director": "director",
        "composer": "composer",
        "interviewer": "interviewer",
        "recipient": "recipient",
    }
    creators = []
    for csl_key, creator_type in creator_map.items():
        entries = data.get(csl_key)
        if not isinstance(entries, list):
            continue
        for entry in entries:
            if not isinstance(entry, dict):
                continue
            literal = csl_text(entry.get("literal"))
            if literal:
                creators.append({
                    "name": literal,
                    "creatorType": creator_type,
                })
                continue
            family = csl_text(entry.get("family"))
            given = csl_text(entry.get("given"))
            if family or given:
                creator = {"creatorType": creator_type}
                if family:
                    creator["lastName"] = family
                if given:
                    creator["firstName"] = given
                creators.append(creator)
    return creators


def zotero_item_type_from_csl(csl_type):
    mapping = {
        "article": "journalArticle",
        "article-journal": "journalArticle",
        "article-magazine": "magazineArticle",
        "article-newspaper": "newspaperArticle",
        "bill": "bill",
        "book": "book",
        "chapter": "bookSection",
        "dataset": "dataset",
        "entry-dictionary": "dictionaryEntry",
        "manuscript": "manuscript",
        "paper-conference": "conferencePaper",
        "patent": "patent",
        "post-weblog": "blogPost",
        "proceedings-article": "conferencePaper",
        "report": "report",
        "speech": "presentation",
        "thesis": "thesis",
        "webpage": "webpage",
    }
    return mapping.get(csl_type, "journalArticle")


def doi_lookup_urls(doi):
    encoded = urllib.parse.quote(doi, safe="")
    override = os.environ.get(DOI_LOOKUP_BASE_ENV)
    if override:
        return [f"{override.rstrip('/')}/{encoded}"]
    return [
        f"https://doi.org/{encoded}",
        f"https://api.crossref.org/works/{encoded}/transform/{DOI_CSL_CONTENT_TYPE}",
    ]


def lookup_doi_csl(doi):
    headers = {
        "Accept": DOI_CSL_CONTENT_TYPE,
        "User-Agent": "zotero-local-agent-management/0.1.1",
    }
    failures = []
    for url in doi_lookup_urls(doi):
        try:
            return request_json(url, headers=headers)
        except urllib.error.HTTPError as error:
            failures.append(f"{url} -> HTTP {error.code}")
        except urllib.error.URLError as error:
            failures.append(f"{url} -> {error.reason}")
    raise ValueError("DOI lookup failed: " + "; ".join(failures))


def add_field_if_present(fields, field, value):
    if value is not None and value != "":
        fields[field] = value


def lookup_doi_metadata(doi):
    normalized_doi = normalize_doi(doi)
    csl = lookup_doi_csl(normalized_doi)
    item_type = zotero_item_type_from_csl(csl_text(csl.get("type")))
    fields = {}

    add_field_if_present(fields, "title", csl_text(csl.get("title")))
    add_field_if_present(fields, "abstractNote", csl_text(csl.get("abstract")))
    add_field_if_present(fields, "date", csl_date(csl.get("issued")) or csl_date(csl.get("created")))
    add_field_if_present(fields, "DOI", normalize_doi(csl.get("DOI") or normalized_doi))
    add_field_if_present(fields, "url", csl_text(csl.get("URL")) or f"https://doi.org/{normalized_doi}")
    add_field_if_present(fields, "pages", csl_text(csl.get("page")))
    add_field_if_present(fields, "volume", csl_text(csl.get("volume")))
    add_field_if_present(fields, "issue", csl_text(csl.get("issue")))
    add_field_if_present(fields, "publisher", csl_text(csl.get("publisher")))
    add_field_if_present(fields, "place", csl_text(csl.get("publisher-place")) or csl_text(csl.get("event-place")))
    add_field_if_present(fields, "language", csl_text(csl.get("language")))
    add_field_if_present(fields, "shortTitle", csl_text(csl.get("title-short")))
    add_field_if_present(fields, "ISSN", csl_text(csl.get("ISSN")))
    add_field_if_present(fields, "ISBN", csl_text(csl.get("ISBN")))
    add_field_if_present(fields, "seriesTitle", csl_text(csl.get("collection-title")))
    add_field_if_present(fields, "archive", csl_text(csl.get("archive")))
    add_field_if_present(fields, "archiveLocation", csl_text(csl.get("archive_location")))

    container_title = csl_text(csl.get("container-title"))
    container_field_by_type = {
        "blogPost": "blogTitle",
        "bookSection": "bookTitle",
        "conferencePaper": "proceedingsTitle",
        "journalArticle": "publicationTitle",
        "magazineArticle": "publicationTitle",
        "newspaperArticle": "publicationTitle",
        "webpage": "websiteTitle",
    }
    container_field = container_field_by_type.get(item_type, "publicationTitle")
    add_field_if_present(fields, container_field, container_title)
    if item_type == "journalArticle":
        add_field_if_present(fields, "journalAbbreviation", csl_text(csl.get("container-title-short")))
    if item_type == "conferencePaper":
        add_field_if_present(fields, "conferenceName", csl_text(csl.get("event")))

    creators = csl_creators(csl)
    if creators:
        fields["creators"] = creators

    return {
        "doi": normalized_doi,
        "itemType": item_type,
        "source": "doi-csl",
        "fields": fields,
    }


def handle_collections_list(args):
    return fetch_read_json(
        args,
        "collections.list",
        "collections",
        {
            "limit": args.limit,
            "start": args.start,
        },
        normalizer=normalize_collection_entry,
    )


def handle_collections_create(args):
    return plugin_command(
        args,
        "collections.create",
        {
            "name": args.name,
            "parentCollectionKey": args.parent_key,
        },
    )


def handle_collections_rename(args):
    return plugin_command(
        args,
        "collections.rename",
        {
            "collectionKey": args.key,
            "name": args.name,
        },
    )


def handle_collections_trash(args):
    return plugin_command(
        args,
        "collections.trash",
        {"collectionKey": args.key},
    )


def handle_items_list(args):
    path = "items"
    if args.collection_key:
        encoded_key = urllib.parse.quote(args.collection_key, safe="")
        path = f"collections/{encoded_key}/items"
    return fetch_read_json(
        args,
        "items.list",
        path,
        {
            "limit": args.limit,
            "start": args.start,
        },
        normalizer=normalize_item_entry,
    )


def handle_items_get(args):
    key = urllib.parse.quote(args.key, safe="")
    return fetch_read_json(args, "items.get", f"items/{key}", normalizer=normalize_item_entry)


def handle_items_search(args):
    return fetch_read_json(
        args,
        "items.search",
        "items",
        {
            "q": args.query,
            "limit": args.limit,
            "start": args.start,
        },
        normalizer=normalize_item_entry,
    )


def handle_items_paper(args):
    item_payload = handle_items_get(args)
    if not item_payload.get("ok"):
        return item_payload

    attachments_payload = handle_attachments_list(
        argparse.Namespace(
            **{
                **vars(args),
                "item_key": args.key,
                "limit": None,
                "start": None,
            }
        )
    )
    if not attachments_payload.get("ok"):
        return attachments_payload

    best_attachment = choose_best_pdf_attachment(attachments_payload.get("data", []))
    if not best_attachment:
        return error_payload(
            "items.paper",
            "NO_PDF_ATTACHMENT",
            "No PDF attachment found for this item",
            {
                "itemKey": args.key,
            },
        )

    path_payload = attachment_path_payload(args, best_attachment["attachmentKey"])
    if not path_payload.get("ok"):
        return path_payload

    attachment = merge_attachment_metadata(best_attachment, path_payload.get("data"))
    read_payload = attachment_read_text_payload(args, attachment, "items.paper")
    if not read_payload.get("ok"):
        return read_payload

    return success_payload(
        "items.paper",
        {
            "item": item_payload.get("data"),
            "attachment": merge_attachment_metadata(
                best_attachment,
                read_payload.get("data"),
            ),
        },
    )


def handle_items_lookup_doi(args):
    try:
        return success_payload("items.lookupDOI", lookup_doi_metadata(args.doi))
    except ValueError as error:
        return error_payload(
            "items.lookupDOI",
            "DOI_LOOKUP_FAILED",
            str(error),
            {"doi": args.doi},
        )


def handle_items_create(args):
    try:
        fields = parse_json_object(args.patch, "patch")
        lookup = None
        if args.doi:
            lookup = lookup_doi_metadata(args.doi)
            fields = {
                **lookup["fields"],
                **fields,
            }
            item_type = args.item_type or lookup["itemType"]
        else:
            if not args.item_type:
                raise ValueError("--item-type is required unless --doi is provided")
            item_type = args.item_type
        if args.title is not None:
            fields["title"] = args.title
    except ValueError as error:
        code = "DOI_LOOKUP_FAILED" if args.doi else "INVALID_INPUT"
        return error_payload(
            "items.create",
            code,
            str(error),
            {"doi": args.doi} if args.doi else {},
        )

    payload = {
        "itemType": item_type,
        "fields": fields,
    }
    collection_keys = parse_csv(args.collection_keys)
    if collection_keys:
        payload["collectionKeys"] = collection_keys
    tags = parse_csv(args.tags)
    if tags:
        payload["tags"] = tags
    response = plugin_command(args, "items.create", payload)
    if lookup and response.get("ok") and isinstance(response.get("data"), dict):
        response["data"]["lookup"] = {
            "doi": lookup["doi"],
            "itemType": lookup["itemType"],
            "source": lookup["source"],
        }
    return response


def handle_items_update(args):
    return plugin_command(
        args,
        "items.update",
        {
            "itemKey": args.key,
            "fields": parse_json_object(args.patch, "patch"),
        },
    )


def handle_items_set_field(args):
    return plugin_command(
        args,
        "items.setField",
        {
            "itemKey": args.key,
            "field": args.field,
            "value": args.value,
        },
    )


def handle_items_trash(args):
    return plugin_command(
        args,
        "items.trash",
        {"itemKey": args.key},
    )


def handle_items_add_to_collection(args):
    return plugin_command(
        args,
        "items.addToCollection",
        {
            "itemKey": args.key,
            "collectionKey": args.collection_key,
        },
    )


def handle_items_remove_from_collection(args):
    return plugin_command(
        args,
        "items.removeFromCollection",
        {
            "itemKey": args.key,
            "collectionKey": args.collection_key,
        },
    )


def handle_items_move(args):
    return plugin_command(
        args,
        "items.move",
        {
            "itemKey": args.key,
            "collectionKey": args.collection_key,
        },
    )


def handle_tags_add(args):
    return plugin_command(
        args,
        "tags.add",
        {
            "itemKey": args.key,
            "tag": args.tag,
        },
    )


def handle_tags_remove(args):
    return plugin_command(
        args,
        "tags.remove",
        {
            "itemKey": args.key,
            "tag": args.tag,
        },
    )


def handle_bulk_trash(args):
    return plugin_command(
        args,
        "bulk.trashItems",
        {"itemKeys": parse_csv(args.keys)},
    )


def handle_bulk_add_to_collection(args):
    return plugin_command(
        args,
        "bulk.addToCollection",
        {
            "itemKeys": parse_csv(args.keys),
            "collectionKey": args.collection_key,
        },
    )


def handle_bulk_remove_from_collection(args):
    return plugin_command(
        args,
        "bulk.removeFromCollection",
        {
            "itemKeys": parse_csv(args.keys),
            "collectionKey": args.collection_key,
        },
    )


def handle_bulk_move(args):
    return plugin_command(
        args,
        "bulk.move",
        {
            "itemKeys": parse_csv(args.keys),
            "collectionKey": args.collection_key,
        },
    )


def handle_bulk_add_tag(args):
    return plugin_command(
        args,
        "bulk.addTag",
        {
            "itemKeys": parse_csv(args.keys),
            "tag": args.tag,
        },
    )


def handle_bulk_remove_tag(args):
    return plugin_command(
        args,
        "bulk.removeTag",
        {
            "itemKeys": parse_csv(args.keys),
            "tag": args.tag,
        },
    )


def handle_unsafe_run_js(args):
    return plugin_command(
        args,
        "unsafe.runJS",
        {"code": args.code},
    )


def handle_attachments_list(args):
    if args.item_key:
        key = urllib.parse.quote(args.item_key, safe="")
        payload = fetch_read_json(
            args,
            "attachments.list",
            f"items/{key}/children",
            {
                "limit": args.limit,
                "start": args.start,
            },
        )
        payload["data"] = filter_attachment_items(payload["data"])
        payload["data"] = normalize_payload(payload["data"], normalize_attachment_entry)
        return payload

    return fetch_read_json(
        args,
        "attachments.list",
        "items",
        {
            "itemType": "attachment",
            "limit": args.limit,
            "start": args.start,
        },
        normalizer=normalize_attachment_entry,
    )


def handle_attachments_best_pdf(args):
    attachments_payload = handle_attachments_list(
        argparse.Namespace(
            **{
                **vars(args),
                "limit": None,
                "start": None,
            }
        )
    )
    if not attachments_payload.get("ok"):
        return attachments_payload
    best_attachment = choose_best_pdf_attachment(attachments_payload.get("data", []))
    if not best_attachment:
        return error_payload(
            "attachments.best-pdf",
            "NO_PDF_ATTACHMENT",
            "No PDF attachment found for this item",
            {"itemKey": args.item_key},
        )
    return success_payload("attachments.best-pdf", best_attachment)


def handle_attachments_path(args):
    return attachment_path_payload(args, args.attachment_key)


def handle_attachments_read_text(args):
    path_payload = attachment_path_payload(args, args.attachment_key)
    if not path_payload.get("ok"):
        return path_payload
    attachment = path_payload.get("data", {})
    return attachment_read_text_payload(args, attachment, "attachments.readText")


def handle_notes_list(args):
    if args.item_key:
        key = urllib.parse.quote(args.item_key, safe="")
        payload = fetch_read_json(
            args,
            "notes.list",
            f"items/{key}/children",
            {
                "limit": args.limit,
                "start": args.start,
            },
        )
        payload["data"] = filter_note_items(payload["data"])
        payload["data"] = [normalize_note_entry(entry, include_content=False) for entry in payload["data"]]
        return payload

    return fetch_read_json(
        args,
        "notes.list",
        "items",
        {
            "itemType": "note",
            "limit": args.limit,
            "start": args.start,
        },
        normalizer=lambda entry: normalize_note_entry(entry, include_content=False),
    )


def handle_notes_get(args):
    key = urllib.parse.quote(args.key, safe="")
    payload = fetch_read_json(args, "notes.get", f"items/{key}", normalizer=normalize_note_entry)
    if payload.get("ok") and payload.get("data", {}).get("fields", {}).get("itemType") != "note":
        return error_payload(
            "notes.get",
            "INVALID_INPUT",
            "Requested item is not a note",
            {"noteKey": args.key},
        )
    return payload


def handle_notes_upsert(args):
    try:
        note = read_note_input(args)
    except ValueError as error:
        return error_payload("notes.upsert", "INVALID_INPUT", str(error))
    return plugin_command(
        args,
        "notes.upsert",
        {
            "noteKey": args.key,
            "parentItemKey": args.item_key,
            "note": note,
        },
    )


def handle_notes_trash(args):
    return plugin_command(
        args,
        "notes.trash",
        {"noteKey": args.key},
    )


def handle_attachments_export(args):
    return plugin_command(
        args,
        "attachments.export",
        {
            "attachmentKey": args.attachment_key,
            "to": args.to,
        },
    )


def handle_attachments_open(args):
    return plugin_command(
        args,
        "attachments.open",
        {"attachmentKey": args.attachment_key},
    )


def handle_attachments_experimental_add(args):
    return plugin_command(
        args,
        "attachments.experimental.add",
        {
            "itemKey": args.item_key,
            "file": args.file,
            "title": args.title,
        },
    )


def handle_attachments_experimental_trash(args):
    return plugin_command(
        args,
        "attachments.experimental.trash",
        {"attachmentKey": args.attachment_key},
    )


def create_parser():
    parser = argparse.ArgumentParser(
        prog="zotero",
        description="JSON-first Zotero CLI scaffold for local read and write commands.",
    )
    parser.add_argument(
        "--base-url",
        default=DEFAULT_BASE_URL,
        help=f"Base URL for the local Zotero HTTP server. Default: {DEFAULT_BASE_URL}",
    )
    parser.add_argument(
        "--api-root",
        default=None,
        help=f"Built-in Zotero local read API root. Default: {DEFAULT_READ_API_ROOT}",
    )
    parser.add_argument(
        "--command-url",
        default=None,
        help=f"Plugin command endpoint. Default: {DEFAULT_COMMAND_URL}",
    )
    command_parsers = parser.add_subparsers(dest="resource", required=True)

    collections_parser = command_parsers.add_parser("collections")
    collections_commands = collections_parser.add_subparsers(dest="action", required=True)
    collections_list_parser = collections_commands.add_parser("list")
    collections_list_parser.add_argument("--limit", type=int)
    collections_list_parser.add_argument("--start", type=int)
    collections_list_parser.set_defaults(handler=handle_collections_list)

    collections_create_parser = collections_commands.add_parser("create")
    collections_create_parser.add_argument("--name", required=True)
    collections_create_parser.add_argument("--parent-key")
    collections_create_parser.set_defaults(handler=handle_collections_create)

    collections_rename_parser = collections_commands.add_parser("rename")
    collections_rename_parser.add_argument("--key", required=True)
    collections_rename_parser.add_argument("--name", required=True)
    collections_rename_parser.set_defaults(handler=handle_collections_rename)

    collections_trash_parser = collections_commands.add_parser("trash")
    collections_trash_parser.add_argument("--key", required=True)
    collections_trash_parser.set_defaults(handler=handle_collections_trash)

    items_parser = command_parsers.add_parser("items")
    items_commands = items_parser.add_subparsers(dest="action", required=True)

    items_list_parser = items_commands.add_parser("list")
    items_list_parser.add_argument("--collection-key")
    items_list_parser.add_argument("--limit", type=int)
    items_list_parser.add_argument("--start", type=int)
    items_list_parser.set_defaults(handler=handle_items_list)

    items_get_parser = items_commands.add_parser("get")
    items_get_parser.add_argument("--key", required=True)
    items_get_parser.set_defaults(handler=handle_items_get)

    items_paper_parser = items_commands.add_parser("paper")
    items_paper_parser.add_argument("--key", required=True)
    items_paper_parser.add_argument(
        "--extractor",
        type=normalize_extractor_name,
        default="auto",
        help=(
            "Paper text extraction path. Default: auto. Use `ocr` for local OCR, "
            "`ocrmypdf-redo` or `ocrmypdf-force` for OCRmyPDF passes, or `zotero` "
            "for Zotero's built-in text layer."
        ),
    )
    items_paper_parser.set_defaults(handler=handle_items_paper)

    items_search_parser = items_commands.add_parser("search")
    items_search_parser.add_argument("--query", "--q", dest="query", required=True)
    items_search_parser.add_argument("--limit", type=int)
    items_search_parser.add_argument("--start", type=int)
    items_search_parser.set_defaults(handler=handle_items_search)

    items_lookup_doi_parser = items_commands.add_parser("lookup-doi")
    items_lookup_doi_parser.add_argument("--doi", required=True)
    items_lookup_doi_parser.set_defaults(handler=handle_items_lookup_doi)

    items_create_parser = items_commands.add_parser("create")
    items_create_parser.add_argument("--item-type")
    items_create_parser.add_argument("--doi")
    items_create_parser.add_argument("--title")
    items_create_parser.add_argument("--patch")
    items_create_parser.add_argument("--collection-keys")
    items_create_parser.add_argument("--tags")
    items_create_parser.set_defaults(handler=handle_items_create)

    items_update_parser = items_commands.add_parser("update")
    items_update_parser.add_argument("--key", required=True)
    items_update_parser.add_argument("--patch", required=True)
    items_update_parser.set_defaults(handler=handle_items_update)

    items_set_field_parser = items_commands.add_parser("set-field")
    items_set_field_parser.add_argument("--key", required=True)
    items_set_field_parser.add_argument("--field", required=True)
    items_set_field_parser.add_argument("--value", required=True)
    items_set_field_parser.set_defaults(handler=handle_items_set_field)

    items_trash_parser = items_commands.add_parser("trash")
    items_trash_parser.add_argument("--key", required=True)
    items_trash_parser.set_defaults(handler=handle_items_trash)

    items_add_to_collection_parser = items_commands.add_parser("add-to-collection")
    items_add_to_collection_parser.add_argument("--key", required=True)
    items_add_to_collection_parser.add_argument("--collection-key", required=True)
    items_add_to_collection_parser.set_defaults(handler=handle_items_add_to_collection)

    items_remove_from_collection_parser = items_commands.add_parser("remove-from-collection")
    items_remove_from_collection_parser.add_argument("--key", required=True)
    items_remove_from_collection_parser.add_argument("--collection-key", required=True)
    items_remove_from_collection_parser.set_defaults(handler=handle_items_remove_from_collection)

    items_move_parser = items_commands.add_parser("move")
    items_move_parser.add_argument("--key", required=True)
    items_move_parser.add_argument("--collection-key", required=True)
    items_move_parser.set_defaults(handler=handle_items_move)

    tags_parser = command_parsers.add_parser("tags")
    tags_commands = tags_parser.add_subparsers(dest="action", required=True)

    tags_add_parser = tags_commands.add_parser("add")
    tags_add_parser.add_argument("--key", required=True)
    tags_add_parser.add_argument("--tag", required=True)
    tags_add_parser.set_defaults(handler=handle_tags_add)

    tags_remove_parser = tags_commands.add_parser("remove")
    tags_remove_parser.add_argument("--key", required=True)
    tags_remove_parser.add_argument("--tag", required=True)
    tags_remove_parser.set_defaults(handler=handle_tags_remove)

    bulk_parser = command_parsers.add_parser("bulk")
    bulk_commands = bulk_parser.add_subparsers(dest="action", required=True)

    bulk_trash_parser = bulk_commands.add_parser("trash")
    bulk_trash_parser.add_argument("--keys", required=True)
    bulk_trash_parser.set_defaults(handler=handle_bulk_trash)

    bulk_add_to_collection_parser = bulk_commands.add_parser("add-to-collection")
    bulk_add_to_collection_parser.add_argument("--keys", required=True)
    bulk_add_to_collection_parser.add_argument("--collection-key", required=True)
    bulk_add_to_collection_parser.set_defaults(handler=handle_bulk_add_to_collection)

    bulk_remove_from_collection_parser = bulk_commands.add_parser("remove-from-collection")
    bulk_remove_from_collection_parser.add_argument("--keys", required=True)
    bulk_remove_from_collection_parser.add_argument("--collection-key", required=True)
    bulk_remove_from_collection_parser.set_defaults(handler=handle_bulk_remove_from_collection)

    bulk_move_parser = bulk_commands.add_parser("move")
    bulk_move_parser.add_argument("--keys", required=True)
    bulk_move_parser.add_argument("--collection-key", required=True)
    bulk_move_parser.set_defaults(handler=handle_bulk_move)

    bulk_add_tag_parser = bulk_commands.add_parser("add-tag")
    bulk_add_tag_parser.add_argument("--keys", required=True)
    bulk_add_tag_parser.add_argument("--tag", required=True)
    bulk_add_tag_parser.set_defaults(handler=handle_bulk_add_tag)

    bulk_remove_tag_parser = bulk_commands.add_parser("remove-tag")
    bulk_remove_tag_parser.add_argument("--keys", required=True)
    bulk_remove_tag_parser.add_argument("--tag", required=True)
    bulk_remove_tag_parser.set_defaults(handler=handle_bulk_remove_tag)

    notes_parser = command_parsers.add_parser("notes")
    notes_commands = notes_parser.add_subparsers(dest="action", required=True)

    notes_list_parser = notes_commands.add_parser("list")
    notes_list_parser.add_argument("--item-key")
    notes_list_parser.add_argument("--limit", type=int)
    notes_list_parser.add_argument("--start", type=int)
    notes_list_parser.set_defaults(handler=handle_notes_list)

    notes_get_parser = notes_commands.add_parser("get")
    notes_get_parser.add_argument("--key", required=True)
    notes_get_parser.set_defaults(handler=handle_notes_get)

    notes_upsert_parser = notes_commands.add_parser("upsert")
    notes_upsert_parser.add_argument("--key")
    notes_upsert_parser.add_argument("--item-key")
    notes_upsert_parser.add_argument("--note")
    notes_upsert_parser.add_argument("--note-file")
    notes_upsert_parser.set_defaults(handler=handle_notes_upsert)

    notes_trash_parser = notes_commands.add_parser("trash")
    notes_trash_parser.add_argument("--key", required=True)
    notes_trash_parser.set_defaults(handler=handle_notes_trash)

    unsafe_parser = command_parsers.add_parser("unsafe")
    unsafe_commands = unsafe_parser.add_subparsers(dest="action", required=True)

    unsafe_run_js_parser = unsafe_commands.add_parser("run-js")
    unsafe_run_js_parser.add_argument("--code", required=True)
    unsafe_run_js_parser.set_defaults(handler=handle_unsafe_run_js)

    attachments_parser = command_parsers.add_parser("attachments")
    attachments_commands = attachments_parser.add_subparsers(dest="action", required=True)

    attachments_list_parser = attachments_commands.add_parser("list")
    attachments_list_parser.add_argument("--item-key")
    attachments_list_parser.add_argument("--limit", type=int)
    attachments_list_parser.add_argument("--start", type=int)
    attachments_list_parser.set_defaults(handler=handle_attachments_list)

    attachments_best_pdf_parser = attachments_commands.add_parser("best-pdf")
    attachments_best_pdf_parser.add_argument("--item-key", required=True)
    attachments_best_pdf_parser.set_defaults(handler=handle_attachments_best_pdf)

    attachments_path_parser = attachments_commands.add_parser("path")
    attachments_path_parser.add_argument("--attachment-key", required=True)
    attachments_path_parser.set_defaults(handler=handle_attachments_path)

    attachments_read_text_parser = attachments_commands.add_parser("read-text")
    attachments_read_text_parser.add_argument("--attachment-key", required=True)
    attachments_read_text_parser.add_argument(
        "--extractor",
        type=normalize_extractor_name,
        default="auto",
        help=(
            "PDF text extraction path. Default: auto. Use `ocr` for local OCR, "
            "`ocrmypdf-redo` or `ocrmypdf-force` for OCRmyPDF passes, or `zotero` "
            "for Zotero's built-in text path."
        ),
    )
    attachments_read_text_parser.set_defaults(handler=handle_attachments_read_text)

    attachments_export_parser = attachments_commands.add_parser("export")
    attachments_export_parser.add_argument("--attachment-key", required=True)
    attachments_export_parser.add_argument("--to", required=True)
    attachments_export_parser.set_defaults(handler=handle_attachments_export)

    attachments_open_parser = attachments_commands.add_parser("open")
    attachments_open_parser.add_argument("--attachment-key", required=True)
    attachments_open_parser.set_defaults(handler=handle_attachments_open)

    attachments_experimental_parser = attachments_commands.add_parser("experimental")
    attachments_experimental_commands = attachments_experimental_parser.add_subparsers(dest="experimental_action", required=True)

    attachments_experimental_add_parser = attachments_experimental_commands.add_parser("add")
    attachments_experimental_add_parser.add_argument("--item-key", required=True)
    attachments_experimental_add_parser.add_argument("--file", required=True)
    attachments_experimental_add_parser.add_argument("--title")
    attachments_experimental_add_parser.set_defaults(handler=handle_attachments_experimental_add)

    attachments_experimental_trash_parser = attachments_experimental_commands.add_parser("trash")
    attachments_experimental_trash_parser.add_argument("--attachment-key", required=True)
    attachments_experimental_trash_parser.set_defaults(handler=handle_attachments_experimental_trash)

    return parser


def main(argv=None):
    parser = create_parser()
    args = parser.parse_args(argv)

    try:
        payload = args.handler(args)
        print_json(payload)
        if payload.get("ok", False):
            return 0
        return 2
    except ValueError as error:
        print_json(error_payload("cli", "INVALID_INPUT", str(error)))
        return 2
    except urllib.error.HTTPError as error:
        body = error.read().decode("utf-8", errors="replace")
        details = {
            "status": error.code,
            "reason": error.reason,
            "url": getattr(error, "url", None),
        }
        if body:
            details["body"] = body
        print_json(error_payload("http.get", "HTTP_ERROR", "Request to Zotero local API failed", details))
        return 1
    except urllib.error.URLError as error:
        print_json(
            error_payload(
                "http.get",
                "CONNECTION_ERROR",
                "Could not connect to the Zotero local API",
                {"reason": str(error.reason)},
            )
        )
        return 1


if __name__ == "__main__":
    sys.exit(main())
