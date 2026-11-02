"""Official address localities shared with the offline POS city selector."""
from functools import lru_cache
import json
from pathlib import Path
import re
import unicodedata


def _key(value):
    value = unicodedata.normalize("NFKD", (value or "").casefold().replace("ħ", "h"))
    return re.sub(r"[^a-z0-9]", "", "".join(c for c in value if not unicodedata.combining(c)))


@lru_cache(maxsize=1)
def _directory():
    records = json.loads(Path(__file__).with_suffix(".json").read_text())["localities"]
    return {_key(row["value"]): row for row in records}


def delivery_town_for_city(city):
    row = _directory().get(_key(city))
    if not row:
        return city
    if row["island"] == "Gozo":
        if row["council"] == "Ir-Rabat (Għawdex)":
            return "Rabat Gozo"
        if row["council"] == "Iż-Żebbuġ (Għawdex)":
            return "Zebbug Gozo"
        if row["council"] == "Ta' Kerċem":
            return "Kercem"
        if row["council"] == "Ta' Sannat":
            return "Sannat"
    return {
        "Il-Belt Valletta": "Valletta", "L-Imdina": "Mdina", "L-Imġarr": "Mgarr",
        "L-Imqabba": "Mqabba", "L-Imsida": "Msida", "L-Imtarfa": "Mtarfa",
    }.get(row["council"], row["council"])
