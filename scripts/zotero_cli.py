#!/usr/bin/env python3

import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request


DEFAULT_BASE_URL = "http://127.0.0.1:23119"
DEFAULT_READ_API_ROOT = f"{DEFAULT_BASE_URL}/api/users/0"
DEFAULT_COMMAND_URL = f"{DEFAULT_BASE_URL}/agent/command"
TOKEN_ENV_NAMES = ("ZOTERO_AGENT_TOKEN", "ZOTERO_AGENT_BRIDGE_TOKEN")


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


def normalize_command_url(args):
    if args.command_url:
        return args.command_url.rstrip("/")
    return f"{args.base_url.rstrip('/')}/agent/command"


def resolve_token(args):
    if args.token:
        return args.token
    for env_name in TOKEN_ENV_NAMES:
        value = os.environ.get(env_name)
        if value:
            return value
    return None


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


def fetch_read_json(args, command, path, params=None):
    url = build_url(normalize_api_root(args), path, params)
    data = request_json(url)
    return success_payload(command, data)


def plugin_command(args, command, command_args):
    token = resolve_token(args)
    if not token:
        return error_payload(
            command,
            "TOKEN_REQUIRED",
            "ZOTERO_AGENT_TOKEN is required for plugin-backed commands",
            {"acceptedEnvVars": list(TOKEN_ENV_NAMES)},
        )

    try:
        return request_json(
            normalize_command_url(args),
            method="POST",
            payload={
                "command": command,
                "args": command_args,
            },
            headers={"x-zotero-agent-token": token},
        )
    except urllib.error.HTTPError as error:
        body = error.read().decode("utf-8", errors="replace")
        if body:
            try:
                return json.loads(body)
            except json.JSONDecodeError:
                pass
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


def filter_attachment_items(data):
    if not isinstance(data, list):
        return data
    attachments = []
    for entry in data:
        item_type = entry.get("data", {}).get("itemType")
        if item_type == "attachment":
            attachments.append(entry)
    return attachments


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


def handle_items_create(args):
    fields = parse_json_object(args.patch, "patch")
    if args.title is not None:
        fields["title"] = args.title
    payload = {
        "itemType": args.item_type,
        "fields": fields,
    }
    collection_keys = parse_csv(args.collection_keys)
    if collection_keys:
        payload["collectionKeys"] = collection_keys
    tags = parse_csv(args.tags)
    if tags:
        payload["tags"] = tags
    return plugin_command(args, "items.create", payload)


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
    return plugin_command(
        args,
        "attachments.path",
        {"attachmentKey": args.attachment_key},
    )


def handle_attachments_read_text(args):
    return plugin_command(
        args,
        "attachments.readText",
        {"attachmentKey": args.attachment_key},
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
    parser.add_argument(
        "--token",
        default=None,
        help="Shared token for plugin-backed commands. Falls back to ZOTERO_AGENT_TOKEN.",
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

    items_create_parser = items_commands.add_parser("create")
    items_create_parser.add_argument("--item-type", required=True)
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

    attachments_open_parser = attachments_commands.add_parser("open")
    attachments_open_parser.add_argument("--attachment-key", required=True)
    attachments_open_parser.set_defaults(handler=handle_attachments_open)

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
