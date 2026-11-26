# Design and Review Record

## Map and Filters

Home Range uses counties for climate, population, elevation, and hazard measures. Distance filters work within counties. Each card has an inclusive range, a switch that applies the filter, and an eye that selects the displayed layer. Match All and Match Any combine the active filters. Shared links preserve the filters, their ranges, the visible layer, and the map position.

The prototype review found that small counties were hard to select on a phone and that two gray map states needed clearer labels. The released interface supports keyboard search, county profiles, a collapsible filter panel, and separate legend keys for unavailable values and uncertain matches. A browser regression checks that the complete national map fits above the legend and that the lower portion remains interactive.

## Data and Geometry

- **County measures.** The data checks verify geographic identifiers, units, source-specific coverage, and missing values. The hazard tests distinguish a zero risk score, a hazard the source marks inapplicable, and a county with insufficient data.
- **Nearby places.** Distances use the nearest eligible site and can cross a county or state line. The map thins visible pins at national scale and measures against the full directory. Checks cover hospitals, grocery stores, schools, commercial airports, city populations, and custom coordinates.
- **Natural features.** The source review checked all five Great Lakes, Alaska, Hawaii, mountain ranges, park inholdings, the Fox River at Aurora, and Powers Lake. A Denali boundary test identified a discrepancy along a long east–west segment. Subdividing that segment brought the boundary reading below 0.001 mile. Tests also cover holes and overlapping polygons at the date line.

## Release Checks

The browser suite exercises the production build under the project URL path at desktop and phone viewport sizes. It checks map bounds, slider handles, filter combinations, layer switching, shared links, geometry downloads, and a reload with an earlier script in the browser cache. The data files include their coverage and source notes. [Data Coverage](README.md#data-coverage)
