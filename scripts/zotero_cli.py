#!/usr/bin/env python3

import argparse
import json
import sys
import urllib.error
import urllib.parse
import urllib.request


DEFAULT_BASE_URL = "http://127.0.0.1:23119"
DEFAULT_READ_API_ROOT = f"{DEFAULT_BASE_URL}/api/users/0"


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


def normalize_api_root(args):
    if args.api_root:
        return args.api_root.rstrip("/")
    return f"{args.base_url.rstrip('/')}/api/users/0"


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


def http_get_json(url):
    request = urllib.request.Request(url, headers={"Accept": "application/json"})
    with urllib.request.urlopen(request) as response:
        charset = response.headers.get_content_charset("utf-8")
        body = response.read().decode(charset)
    if not body:
        return {}
    return json.loads(body)


def fetch_read_json(args, command, path, params=None):
    url = build_url(normalize_api_root(args), path, params)
    data = http_get_json(url)
    return success_payload(command, data)


def not_implemented_payload(command, details=None):
    return error_payload(
        command,
        "NOT_IMPLEMENTED",
        f"{command} is not implemented in this scaffold yet",
        details,
    )


def filter_attachment_items(data):
    if not isinstance(data, list):
        return data
    attachments = []
    for entry in data:
        item_type = entry.get("data", {}).get("itemType")
        if item_type == "attachment":
            attachments.append(entry)
    return attachments


def handle_collections_list(args):
    return fetch_read_json(
        args,
        "collections.list",
        "collections",
        {
            "limit": args.limit,
            "start": args.start,
        },
    )


def handle_items_list(args):
    return fetch_read_json(
        args,
        "items.list",
        "items",
        {
            "limit": args.limit,
            "start": args.start,
        },
    )


def handle_items_get(args):
    key = urllib.parse.quote(args.key, safe="")
    return fetch_read_json(args, "items.get", f"items/{key}")


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
    )


def handle_attachments_best_pdf(args):
    return not_implemented_payload(
        "attachments.best-pdf",
        {"itemKey": args.item_key},
    )


def handle_attachments_path(args):
    return not_implemented_payload(
        "attachments.path",
        {"attachmentKey": args.attachment_key},
    )


def handle_attachments_read_text(args):
    return not_implemented_payload(
        "attachments.read-text",
        {"attachmentKey": args.attachment_key},
    )


def handle_attachments_export(args):
    return not_implemented_payload(
        "attachments.export",
        {
            "attachmentKey": args.attachment_key,
            "to": args.to,
        },
    )


def create_parser():
    parser = argparse.ArgumentParser(
        prog="zotero",
        description="JSON-first Zotero CLI scaffold for local read commands.",
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

    command_parsers = parser.add_subparsers(dest="resource", required=True)

    collections_parser = command_parsers.add_parser("collections")
    collections_commands = collections_parser.add_subparsers(dest="action", required=True)
    collections_list_parser = collections_commands.add_parser("list")
    collections_list_parser.add_argument("--limit", type=int)
    collections_list_parser.add_argument("--start", type=int)
    collections_list_parser.set_defaults(handler=handle_collections_list)

    items_parser = command_parsers.add_parser("items")
    items_commands = items_parser.add_subparsers(dest="action", required=True)

    items_list_parser = items_commands.add_parser("list")
    items_list_parser.add_argument("--limit", type=int)
    items_list_parser.add_argument("--start", type=int)
    items_list_parser.set_defaults(handler=handle_items_list)

    items_get_parser = items_commands.add_parser("get")
    items_get_parser.add_argument("--key", required=True)
    items_get_parser.set_defaults(handler=handle_items_get)

    items_search_parser = items_commands.add_parser("search")
    items_search_parser.add_argument("--query", "--q", dest="query", required=True)
    items_search_parser.add_argument("--limit", type=int)
    items_search_parser.add_argument("--start", type=int)
    items_search_parser.set_defaults(handler=handle_items_search)

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
    attachments_read_text_parser.set_defaults(handler=handle_attachments_read_text)

    attachments_export_parser = attachments_commands.add_parser("export")
    attachments_export_parser.add_argument("--attachment-key", required=True)
    attachments_export_parser.add_argument("--to", required=True)
    attachments_export_parser.set_defaults(handler=handle_attachments_export)

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
