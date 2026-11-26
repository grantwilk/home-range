"""Encode real geographic lines and polygons for the static proximity layers."""

import gzip
import json
import os
import tempfile
from pathlib import Path

OUTPUT = Path(__file__).resolve().parents[1] / "data" / "nature"
SCALE = 10_000
TOLERANCE = 0.001


def parts_of(shape, kind):
    if shape.is_empty:
        return
    if shape.geom_type == ("Polygon" if kind == "area" else "LineString"):
        yield shape
    elif hasattr(shape, "geoms"):
        for part in shape.geoms:
            yield from parts_of(part, kind)


def encode(coords, closed):
    """Delta-code quantized longitude/latitude pairs as printable varints."""
    chars = bytearray()
    previous = (0, 0)
    count = 0
    for xy in coords:
        point = (round(xy[0] * SCALE), round(xy[1] * SCALE))
        if count and point == previous:
            continue
        for new, old in zip(point, previous, strict=True):
            delta = new - old
            n = 2 * delta if delta >= 0 else -2 * delta - 1
            while n >= 32:
                chars.append((n & 31) + 95)
                n >>= 5
            chars.append(n + 63)
        previous = point
        count += 1
    return chars.decode("ascii") if count >= (4 if closed else 2) else None


def write_layer(key, features, *, source, url, period, definition, geometry):
    """Write named multipart geometry, retaining each polygon's interior rings."""
    if geometry not in {"area", "line"}:
        raise ValueError(geometry)
    OUTPUT.mkdir(exist_ok=True, parents=True)
    names = {}
    count = 0
    metadata = {
        "source": source,
        "url": url,
        "period": period,
        "definition": definition,
        "geometry": geometry,
        "scale": SCALE,
    }
    with tempfile.NamedTemporaryFile(
        dir=OUTPUT.parent.parent, suffix=".partial", delete=False
    ) as temp:
        staging = Path(temp.name)
    try:
        with (
            staging.open("wb") as raw,
            gzip.GzipFile(filename="", mode="wb", fileobj=raw, mtime=0) as out,
        ):
            out.write(json.dumps(metadata).encode()[:-1] + b',"parts":[')
            for name, shape in features:
                for part in parts_of(shape, geometry):
                    part = part.simplify(TOLERANCE, preserve_topology=True)
                    rings = (
                        [part.exterior, *part.interiors]
                        if geometry == "area"
                        else [part]
                    )
                    outer, *holes = (
                        encode(r.coords, geometry == "area") for r in rings
                    )
                    if not outer:
                        continue
                    name_id = names.setdefault(name, len(names))
                    row = [name_id, outer, *(r for r in holes if r)]
                    if count:
                        out.write(b",")
                    out.write(json.dumps(row, separators=(",", ":")).encode())
                    count += 1
            if not count:
                raise ValueError(f"{key} contains no geometry")
            out.write(b'],"names":')
            out.write(json.dumps(list(names), separators=(",", ":")).encode() + b"}")
        destination = OUTPUT / f"{key}.json.gz"
        staging.chmod(0o644)
        os.replace(staging, destination)
        print(
            f"{key}: {count:,} geometry parts, {len(names):,} labels, {destination.stat().st_size:,} bytes"
        )
    finally:
        staging.unlink(missing_ok=True)
