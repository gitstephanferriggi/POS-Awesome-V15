# -*- coding: utf-8 -*-
# Copyright (c) 2024, yosys solutions and contributors
# For license information, please see license.txt

from __future__ import unicode_literals
import frappe


@frappe.whitelist()
def get_print_formats(doctype):
    print_formats = frappe.get_all("Print Format", filters={"doc_type": doctype}, fields=["name"])
    return [p.name for p in print_formats]


@frappe.whitelist()
def get_offline_print_context(pos_profile):
    """Cache only the receipt format configured on a readable POS Profile."""
    import base64
    import mimetypes
    import re

    profile = frappe.get_doc("POS Profile", pos_profile)
    profile.check_permission("read")
    name = profile.get("print_format_for_online") or profile.get("print_format")
    if not name:
        return dict(profile=profile.name, format=None, html="", css="", letter_head="")
    template = frappe.get_doc("Print Format", name)
    letter = frappe.get_doc("Letter Head", profile.letter_head).content if profile.letter_head else ""

    def inline_image(match):
        url = match.group(2)
        # No external URLs or arbitrary filesystem access. Normal receipt image
        # permission checks also apply when caching the configured letterhead.
        if not url.startswith(("/files/", "/private/files/")):
            return match.group(0)
        file = frappe.get_doc("File", {"file_url": url})
        file.check_permission("read")
        mime = mimetypes.guess_type(url)[0]
        if mime not in ("image/png", "image/jpeg", "image/gif", "image/webp"):
            return match.group(0)
        content = file.get_content()
        if len(content) > 1024 * 1024:
            frappe.throw("The receipt logo is too large to cache offline.")
        encoded = base64.b64encode(content).decode()
        return 'src="data:' + mime + ';base64,' + encoded + '"'

    letter = re.sub(r'src=([\"\'])(.*?)\1', inline_image, letter or "", flags=re.I)
    return dict(profile=profile.name, format=name, html=template.html or "", css=template.css or "",
                letter_head=letter, modified=template.modified)
