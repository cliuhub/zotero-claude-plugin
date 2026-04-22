#!/usr/bin/env python3

import argparse
import json
import os
import shutil
import sys
from pathlib import Path


def extend_sys_path():
    candidates = [
        Path.home() / ".agents" / "python",
        Path(__file__).resolve().parent.parent / ".local" / "python",
    ]
    for candidate in candidates:
        resolved = candidate.expanduser()
        if resolved.exists():
            sys.path.insert(0, str(resolved))


extend_sys_path()

import pdfplumber  # noqa: E402
from pypdf import PdfReader  # noqa: E402


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--path", required=True)
    parser.add_argument("--mode", choices=["pdf", "pypdf"], default="pdf")
    return parser.parse_args()


def extract_with_pdfplumber(path):
    page_summaries = []
    page_text = []
    with pdfplumber.open(path) as document:
        for index, page in enumerate(document.pages, start=1):
            text = (page.extract_text() or "").strip()
            page_text.append(text)
            page_summaries.append(
                {
                    "pageNumber": index,
                    "parser": "pdfplumber",
                    "textChars": len(text),
                }
            )
    combined = "\n\n".join(entry for entry in page_text if entry)
    return {
        "ok": True,
        "extractor": "local-pdfplumber",
        "pageCount": len(page_summaries),
        "selectedPages": {"pdfplumber": len(page_summaries)},
        "pages": page_summaries,
        "renderToolAvailable": bool(shutil.which("pdftoppm")),
        "text": combined,
    }


def extract_with_pypdf(path):
    reader = PdfReader(path)
    page_summaries = []
    page_text = []
    for index, page in enumerate(reader.pages, start=1):
        text = (page.extract_text() or "").strip()
        page_text.append(text)
        page_summaries.append(
            {
                "pageNumber": index,
                "parser": "pypdf",
                "textChars": len(text),
            }
        )
    combined = "\n\n".join(entry for entry in page_text if entry)
    return {
        "ok": True,
        "extractor": "local-pypdf",
        "pageCount": len(page_summaries),
        "selectedPages": {"pypdf": len(page_summaries)},
        "pages": page_summaries,
        "renderToolAvailable": bool(shutil.which("pdftoppm")),
        "text": combined,
    }


def main():
    args = parse_args()
    path = Path(args.path).expanduser()
    if not path.exists():
        raise FileNotFoundError(f"PDF not found at {path}")

    if args.mode == "pypdf":
        result = extract_with_pypdf(path)
    else:
        result = extract_with_pdfplumber(path)
        if not result["text"]:
            result = extract_with_pypdf(path)

    if not result["text"]:
        raise RuntimeError("PDF parsing did not produce readable text")

    print(json.dumps(result, indent=2, sort_keys=True))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(
            json.dumps(
                {
                    "ok": False,
                    "error": {
                        "message": str(error),
                    },
                },
                indent=2,
                sort_keys=True,
            )
        )
        raise SystemExit(1)
