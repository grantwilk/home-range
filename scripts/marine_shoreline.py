"""Keep charted shoreline bordering ocean-connected marine water in the lower 48."""

import geopandas as gpd
import numpy as np
import shapely
from coastal_water import marine_water_candidates

CRS = "EPSG:5070"  # Contiguous US Albers, in metres.
SHORE_ALIGNMENT_M = 250
TILE_M = 50_000


def nearby_water_mask(water, index, bounds):
    """Buffer local water polygons after clipping to a padded window."""
    x1, y1, x2, y2 = bounds
    padding = SHORE_ALIGNMENT_M + 1
    window = x1 - padding, y1 - padding, x2 + padding, y2 + padding
    ids = index.query(shapely.box(*window))
    if not len(ids):
        return None
    local = shapely.clip_by_rect(water[ids], *window)
    local = shapely.make_valid(local[~shapely.is_empty(local)])
    if not len(local):
        return None
    return shapely.buffer(shapely.union_all(local), SHORE_ALIGNMENT_M)


def connected_marine_water(water, estuary_zones):
    """Follow adjoining bays and sounds from the ocean, stopping at river polygons."""
    water = marine_water_candidates(water)[["MTFCC", "geometry"]]
    water = water.to_crs(CRS).explode(ignore_index=True)
    water.geometry = water.geometry.make_valid()
    # A river polygon can carry the name of its receiving sound for miles
    # inland (e.g. the Connecticut River). Require independent NOAA evidence
    # only for these ambiguous, river-coded names.
    sheltered = estuary_zones.EST_NAME.str.contains(
        r"\b(?:bays?|sounds?|gulfs?|harbou?rs?|lagoons?)\b", case=False, na=False
    )
    eligible = (estuary_zones.SZ_CODE == 3) | ((estuary_zones.SZ_CODE == 2) & sheltered)
    zones = estuary_zones.loc[eligible].to_crs(CRS).geometry.make_valid().array
    zone_index = shapely.STRtree(zones)
    for row in water.loc[water.MTFCC == "H3010"].itertuples():
        mask = nearby_water_mask(zones, zone_index, row.geometry.bounds)
        water.at[row.Index, "geometry"] = (
            row.geometry.intersection(mask) if mask is not None else shapely.Polygon()
        )
    # Clip and repair can both split a polygon into disjoint components.
    while water.geom_type.isin(["GeometryCollection", "MultiPolygon"]).any():
        water = water.explode(ignore_index=True)
    water = water.loc[
        (water.geom_type == "Polygon") & ~water.geometry.is_empty
    ].reset_index(drop=True)
    # Classification belongs to each polygon component. Disconnected pieces of one
    # named bay must not create a shortcut through a river or across an island.
    seeds = np.flatnonzero(water.MTFCC == "H2053")
    if not len(seeds):
        raise ValueError("Marine-water source has no ocean polygons")
    shapes = water.geometry.array
    tree = shapely.STRtree(shapes)
    connected = np.zeros(len(shapes), dtype=bool)
    connected[seeds] = True
    frontier = seeds
    while len(frontier):
        # County-file edges generally coincide. A metre allows for rounding of
        # shared vertices after projection, without bridging channels of river water.
        _, neighbors = tree.query(shapes[frontier], predicate="dwithin", distance=1)
        frontier = np.unique(neighbors[~connected[neighbors]])
        connected[frontier] = True

    # The national chart is coarser than TIGER. Generalize the water mask only
    # after tracing connectivity on the original, full-resolution polygons.
    return water.loc[connected].geometry.simplify(15).array


def clip_to_marine_water(chart, water, estuary_zones):
    """Intersect the source lines with local marine water; never draw mask edges."""
    marine = connected_marine_water(water, estuary_zones)
    sea_index = shapely.STRtree(marine)
    chart = chart.to_crs(CRS)
    shores = chart.geometry.array
    regions = chart.REGIONS.to_numpy()
    shore_index = shapely.STRtree(shores)
    left, bottom, right, top = chart.total_bounds
    first_col, first_row, last_col, last_row = np.floor(
        np.array([left, bottom, right, top]) / TILE_M
    ).astype(int)
    kept_lines, kept_regions = [], []
    for col in range(first_col, last_col + 1):
        x = col * TILE_M
        for row in range(first_row, last_row + 1):
            y = row * TILE_M
            tile = shapely.box(x, y, x + TILE_M, y + TILE_M)
            arc_ids = shore_index.query(tile)
            if not len(arc_ids):
                continue
            mask = nearby_water_mask(marine, sea_index, tile.bounds)
            if mask is None:
                continue
            shapely.prepare(mask)
            arcs = shapely.intersection(shores[arc_ids], tile)
            present = shapely.intersects(mask, arcs)
            arcs = arcs[present]
            partial = ~shapely.covers(mask, arcs)
            arcs[partial] = shapely.intersection(arcs[partial], mask)
            lines = shapely.get_dimensions(arcs) == 1
            kept_lines.extend(arcs[lines])
            kept_regions.extend(regions[arc_ids[present]][lines])
    return gpd.GeoDataFrame(
        {"REGIONS": kept_regions}, geometry=kept_lines, crs=CRS
    ).to_crs("EPSG:4326")
