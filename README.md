# Home Range

Home Range helps you find places to live in the United States. Choose the climate, natural hazards, population, and nearby places that matter to you, then share a map of the areas that meet your criteria.

[Open Home Range](https://grantwilk.com/home-range/)

## Try It

The map opens with one filter, **Average January Low**. It shows temperatures across the country until you narrow the range. Try setting it to **40–75°F**, then use **Add Filter → Temperature** to add **Average July High** and set it to **40–80°F**. **Match All** finds six counties that satisfy both ranges. **Match Any** finds 486 that satisfy either one.

Open **Add Filter** to browse these groups.

| Group | Filter Types |
| --- | --- |
| Climate & Weather | Temperature, Relative Humidity, Hot Days, Annual Precipitation, Wet Days, Cloudy Days per Year |
| Population & Nearby Places | County Population, Distance to Places |
| Land & Terrain | Land Cover, Landscape Region, Average County Elevation, Distance to Nature |
| Natural Hazards | Natural Hazard Risk |

- Choose **Temperature**, **Relative Humidity**, **Annual Precipitation**, **Distance to Places**, **Distance to Nature**, or **Natural Hazard Risk** and select the measurement or feature on its card. You can add another card of the same type. For example, set independent limits for a grocery store, a river, and a park.
- Click the eye or layer name to color the map. Its switch applies or pauses the filter. Use **×** to remove the card.
- Drag either handle or enter a minimum and maximum. Editing a bound enables the filter. Both endpoints are inclusive. **Hot Days** also lets you set the daily high that counts as a hot day.
- **County Population** uses smaller slider steps for rural counties and larger steps for major metros. Type whole numbers for precise limits.
- Use **Find a Place** or press **/** to search for a city, town, or county by name. Add a state to narrow the results, or enter a five-digit county code. Choosing a city or town zooms directly to it. You can also enter latitude and longitude. With a distance layer active or visible, the result opens nearby-place details.
- Cities and towns are labeled at every scale. Zoom in to see smaller places. The **Map Key** identifies symbols for each enabled point filter, even when the map displays another measure. In dense areas, zoom in to reveal more individual locations.
- **Export PDF** downloads the current extent as an 11 × 17 inch vector map with searchable town names, a color scale, a symbol key, filter ranges, and data sources. Zoom to the area you want before exporting.
- **Share View** copies a link that restores the filters, their order and ranges, the visible layer, the match setting, and the map position. You can also bookmark the address. To share with another person, use your published site's address.

## Share a Filtered Map

[Try January lows of 20–35°F and tornado risk of 0–25](https://grantwilk.com/home-range/?janLow=20..35&TRND_RISKS=0..25&match=all&layer=TRND_RISKS). The map shows tornado risk and highlights counties that satisfy both ranges.

To edit a link by hand, use the filter key followed by an inclusive `minimum..maximum`. Each filter in the query starts enabled. Add `paused=janLow` to keep that card and its range with the switch off. Use `match=all` or `match=any` and `layer=<key>` to choose what the map displays. The address shows the key for each filter you add.

- `airports=0..30` selects locations within 30 straight-line miles of a qualifying commercial airport.
- `cities=0..10&cities.population=150000..3000000` selects places within ten miles of a city in that population range.
- `heatDays=0..30&heatDays.cutoff=95&mapCutoff=90` filters on days reaching 95°F and displays days reaching 90°F when the heat layer is viewed.
- `rainfall=25..45&snowfall=0..50` selects counties averaging 25–45 inches of rain and up to 50 inches of new snow per year.
- `cloudyDays=0..75` selects counties averaging at most 75 cloudy days per year. Old `cloud` percentage links open with the replacement filter paused so you can choose a range in days.
- `filters=none` opens an empty filter panel. Shared links restore the cards included in the link.

**Custom Places** travel with the link, including each saved name and its coordinates. The browser stores these after the `#` so the hosting server receives only the filter settings. Anyone you give the full link to can see the saved places.

Older links that specified travel minutes open with those distance filters paused and a notice. The place type, city population limits, and saved custom places carry over. Each affected card suggests a new range from zero to the usual distance for that place type. Review the miles and switch the filter on when ready. Other filters retain their settings. If multiple older ranges for a single measure cannot fit one interval, the app identifies that measure and pauses it for review.

## Data Coverage

Geography uses 2017 boundaries for 3,142 counties and equivalents across the 50 states and Washington, D.C. The map distinguishes a known failure, an unavailable layer value, and an uncertain filter result. County fills, shared border lines, and facility dots are drawn in SVG. Zooming reveals finer boundary detail and more nearby sites. The 2017 Census cartographic boundaries are generalized for mapping. [U.S. Census County Boundaries](https://www2.census.gov/geo/tiger/GENZ2017/shp/cb_2017_us_county_500k.zip)

| Measure | Period | Spatial coverage |
| --- | --- | --- |
| January low, July high, local coldest-month low, local hottest-month high, monthly high/low profiles | 1991–2020 | 3,140 counties |
| Mean relative humidity in the local coldest and hottest months | 1981–2010 | 3,140 counties |
| Days with a daily high at or above a chosen temperature, wet-day frequency (drier to wetter) | 1991–2020 | 3,107 counties |
| Annual rainfall | 1991–2020 | 3,142 counties |
| Annual snowfall | 17 complete snow seasons from 2008–09 through 2025–26 | 2,966 counties in the contiguous U.S. |
| Cloudy days per year | 1991–2020 | 3,142 counties |
| Land cover, as a percentage of classified land | 2025 contiguous U.S., 2016 Alaska, 2001 Hawaii | 3,142 counties. Moss and lichen are distinguished in Alaska. |
| Prairie Parkland and Great Plains ecological divisions | 2025 EcoMap | 3,061 counties in the contiguous U.S. |
| Hot or cold desert climate | 1991–2020 | 3,119 counties |
| Average county elevation | USGS GMTED2010 terrain grid | 3,142 counties |
| Estimated county population | July 1, 2025 | 3,142 counties |
| Reported violent crime rate | 2014 and 2016 | 2,951 counties |
| Homicide death rate | 2017–2023 | 1,447 counties |
| Overall natural hazard risk and 18 individual hazards | FEMA National Risk Index, December 2025 | 3,133 matched county boundaries. Coverage varies by hazard. |

Temperature and wet-day frequency use NOAA's published county-scale daily series for the contiguous U.S. and monthly series for Alaska and Hawaii. The importer requires complete records. Day counts use the daily county-area average. Wet days reach 0.01 inches of precipitation. Local coldest and hottest months use mean temperature to choose the month. Lexington city, Virginia, lacks a daily series in the source. The historical Valdez-Cordova Census Area has no matching Alaska monthly record. [EpiNOAA Documentation](https://arc.ncics.org/nclimgrid-overview/) · [NOAA Monthly County Files](https://www.ncei.noaa.gov/monitoring-content/data/us/climdiv/monthly/current/county-readme.txt)

Choose **Add Filter → Average County Elevation** to select a range in feet above sea level. The eye displays the terrain layer. Each value averages the USGS 30-arc-second mean-elevation grid over the mapped county footprint, including water surfaces within the boundary. Each cell contributes according to its area inside the county. A town, neighborhood or individual home can have a different elevation. [USGS GMTED2010](https://pubs.usgs.gov/of/2011/1073/)

Population comes from U.S. Census Bureau Vintage 2025 resident estimates. The map draws 2017 county outlines. For counties with the same identifier, the estimate follows the 2025 county, including any minor boundary adjustments. The eight historical Connecticut counties use sums of their constituent towns. Alaska’s historical Valdez-Cordova Census Area uses the sum of Chugach and Copper River census areas. [Census County Estimates](https://www.census.gov/data/datasets/time-series/demo/popest/2020s-counties-total.html)

Under **Add Filter → Annual Precipitation**, choose **Annual Rainfall** or **Annual Snowfall**. Add the filter twice to set limits on both. Rainfall measures the depth of liquid precipitation. Home Range subtracts the water equivalent of frozen precipitation from ERA5 total precipitation, sums the monthly amounts, and averages 30 calendar years over each county. ERA5’s 0.25° grid can smooth local differences, particularly in mountains. [ERA5 Monthly Data](https://gdex.ucar.edu/datasets/d633001/) · [ECMWF Data Documentation](https://confluence.ecmwf.int/display/CKB/ERA5%3A+data+documentation)

Snowfall measures the depth of newly fallen snow accumulated during an October–September season. This includes snow that melts between storms. Home Range averages 17 complete seasons from NOAA’s National Gridded Snowfall Analysis. The September 2021 archive is incomplete, so 2020–21 is omitted everywhere. Alaska, Hawaii, and counties where valid cells cover less than 95% of the mapped area show **No data**. A measured zero can match a zero-inch range. [NOAA Snowfall Analysis](https://www.nohrsc.noaa.gov/snowfall/) · [NOAA Product Definition](https://www.nohrsc.noaa.gov/technology/pdf/PDD_National_Gridded_Snowfall_Analysis.pdf)

**Cloudy Days per Year** counts a day when the county’s average cloud cover reaches 80%. The filter uses NOAA’s North American Regional Reanalysis, which combines weather observations with a model on a roughly 32 km grid. For each UTC day, Home Range averages the grid values across the county, counts qualifying days in each calendar year, then averages those annual counts over 1991–2020. Nighttime contributes to the daily mean. All 3,142 counties have at least 95% of their mapped area represented on every day of the period. A day below the threshold can still be partly cloudy. [NOAA North American Regional Reanalysis](https://www.ncei.noaa.gov/products/weather-climate-models/north-american-regional) · [Daily Cloud Data](https://psl.noaa.gov/thredds/dodsC/Datasets/NARR/Dailies/monolevel/tcdc.1991.nc.html)

Choose **Add Filter → Relative Humidity**, then select **Coldest Month** or **Hottest Month**. Set the range in percent. County details show which calendar month supplies each value. The month comes from the same NOAA temperature profile as the coldest-month low and hottest-month high. Humidity comes from CHELSA v2.1’s modeled monthly near-surface relative humidity, averaged over each county from its native 30-arcsecond grid. The humidity baseline is 1981–2010 and the month-selection baseline is 1991–2020. [CHELSA Climatologies](https://www.chelsa-climate.org/datasets/chelsa_climatologies) · [Humidity Dataset Methods](https://doi.org/10.5194/essd-14-5573-2022)

## County Landscapes

Use **Add Filter → Land & Terrain → Land Cover** for what you might see from above. Choose a cover type, then set its minimum and maximum share of county land. Open a county’s **County Landscape** panel for the full mix. The two largest shares appear together even when neither covers a majority.

| Preference | Example Settings With Match All |
| --- | --- |
| A mix of farms and woods | Add **Crops & Pasture** at **35–65%** and **Forest** at **35–65%**. |
| A largely open prairie landscape | Combine **Grassland** at **50–100%** with **Landscape Region → Great Plains** at **50–100%**. **Prairie Parkland** covers a different ecological division with a mix of prairie and woodland. |
| Farm country with little development | Use **Crops & Pasture** at **40–100%** and **Developed Land** at **0–10%**. Development includes roads, low-density housing, and some lawns. |
| Avoid desert climates | Use **Landscape Region → Desert Climate** at **0–0%**. Raise the upper handle if a small desert portion is acceptable. |

**Land Cover** uses the USGS National Land Cover Database’s satellite classifications at 30 m resolution. Each cell inside a county contributes to one cover class. Open water is excluded from the percentages, and wetlands count as land. The map uses 2025 imagery classifications for the contiguous U.S., 2016 for Alaska, and 2001 for Hawaii. Moss and lichen form a separate class in Alaska. County percentages describe the overall surroundings. Distances from a house to the nearest field or building require a finer-scale search. [USGS Annual NLCD](https://www.usgs.gov/centers/eros/science/annual-national-land-cover-database) · [MRLC Coverage and Vintages](https://www.mrlc.gov/faq)

**Landscape Region** answers a different question. **Prairie Parkland** and **Great Plains** measure the share of mapped county area in those USDA Forest Service ecological divisions. The regional boundary persists where prairie has been converted to farms or towns. A grassland classification alone cannot establish native prairie. **Desert Climate** counts the areas that the 1991–2020 Köppen–Geiger map classifies as hot or cold desert (BWh or BWk). It can include shrub-covered or developed land. Home Range overlays both sources on the same county land mask used for Land Cover. Each measure requires its source to classify at least 95% of that mapped land. Counties spanning a boundary can have a partial share. The climate boundaries come from a roughly 1 km grid. Tiny mapped shares display as **<0.1%** or **>99.9%** to keep the exact endpoints useful. [USDA Forest Service EcoMap 2025](https://apps.fs.usda.gov/ArcX/rest/services/EDW/EDW_Ecomap2025_01/MapServer) · [Beck et al. Climate Classification](https://doi.org/10.1038/s41597-023-02549-6)

## County Crime

Choose **Add Filter → County Crime** and select a measure. The two handles set the inclusive range per 100,000 residents. Use the eye to see the county rates. You can add the filter a second time to use both measures together.

- **Reported Violent Crime Rate** covers homicide, rape, robbery, and aggravated assault reported to police in **2014 and 2016**. The denominator is the population served by reporting agencies. County Health Rankings advises against comparing this measure across states because reporting practices differ. The underlying FBI county data can include estimates for incomplete agency reports. County Health Rankings retired this historical measure in 2023. [Measure Documentation](https://www.countyhealthrankings.org/sites/default/files/media/document/Trends%20documentation%202022.pdf) · [County Data Methods](https://www.icpsr.umich.edu/sites/nacjd/posts/shared/uniform-crime-reporting-program-resource-guide)
- **Homicide Death Rate** counts annual deaths from assault among county residents during **2017–2023**, using death certificates. A death is assigned to the victim’s county of residence. The publisher suppresses rates for counties with fewer than ten deaths over the entire period. [County Health Rankings Homicide Methods](https://www.countyhealthrankings.org/health-data/community-conditions/social-and-economic-factors/safety-and-social-support/homicides)

Both layers use the publisher’s rates, rounded to one decimal place. Missing values produce an unknown filter result. A published zero is eligible for a range that includes zero.

## Natural Hazards

Choose **Add Filter → Natural Hazard Risk**, then select a hazard. The **All Hazards Combined** option displays FEMA’s overall natural hazard risk score. To keep counties in the lowest fifth for two hazards, select **Tornado** and set its range to **0–20**. Add another **Natural Hazard Risk** filter, choose **Inland Flooding**, set it to **0–20**, and select **Match All**.

Each score is a county percentile from 0 to 100, rounded to two decimal places. Higher values indicate greater relative risk. FEMA combines expected annual losses with social vulnerability and community resilience. The scores describe whole counties. An 80 represents a national ranking, and the likelihood of a disaster at a particular home requires different data. The overall index uses the hazards FEMA could assess. Inspect a county for its scores and FEMA ratings. [FEMA Technical Documentation](https://www.fema.gov/sites/default/files/documents/fema_national-risk-index_technical-documentation.pdf)

A range starting at zero includes counties FEMA marks **Not applicable**, shown in blue-gray on the hazard map. A positive minimum excludes them. A published zero is a numeric score indicating zero modeled loss. **Insufficient data** and **No matching county boundary** remain unknown for that filter. The latter applies to the eight historical Connecticut counties and Alaska’s former Valdez–Cordova Census Area. [Download the FEMA County Release](https://www.fema.gov/about/reports-and-data/openfema/nri/v120/NRI_Table_Counties.zip)

## Distance to Places

Choose **Add Filter → Distance to Places**, then select a place type. To look for a home within five miles of a school, set the minimum to zero and the maximum to five. To look for homes five to ten miles away from the nearest school, set both bounds. Each distance is the shortest straight-line distance from that point on the map to an eligible site, in miles. Roads, terrain, and traffic can change the distance or time of an actual trip.

The eye displays the distance layer independently of its switch. At national scale, the map thins nearby dots for readability. Zoom in to see more sites and finer distance bands. Every eligible site contributes to the distance calculation at every zoom level.

| Layer | Included sites | Source |
| --- | --- | --- |
| K–12 Schools | 117,940 public and private school names at 110,463 distinct mapped locations. Any school offering K–12 instruction can satisfy the filter. Campuses with the same geocode share a pin. | [NCES School Locations](https://nces.ed.gov/programs/edge/Geographic/SchoolLocations) |
| Major Hospitals | 614 verified locations across all states and D.C. with documented heart bypass cases. Of 861 qualifying Medicare providers, 247 lacked a verifiable site. Availability today can differ from the reporting period. | [CMS Hospital Outcomes](https://data.cms.gov/provider-data/dataset/ynj2-r877) · [STS Public Reporting](https://publicreporting.sts.org/acsd) |
| Grocery Stores | 43,940 SNAP-authorized supermarkets, superstores, and identified large grocery stores at 43,826 locations. Nonparticipating retailers and stores of unknown size are outside this directory. | [USDA SNAP Retailer Locator](https://www.fns.usda.gov/snap/retailer-locator) |
| Commercial Airports | 141 small, medium, and large FAA primary hubs. Dane County Regional in Madison, WI (MSN) is a small hub. The cutoff follows Madison’s hub class. Distances end at the airport reference point. | [FAA Passenger Boardings](https://www.faa.gov/airports/planning_capacity/passenger_allcargo_stats/passenger) |
| Major Cities | 35,532 Census places and municipal towns. The second pair of handles filters by the population of the place. Aurora, IL has 179,898 residents and Chicago has 2,711,226 in this vintage. Three records without a population estimate remain searchable by name. | [2024 Census Gazetteer](https://www.census.gov/geographies/reference-files/time-series/geo/gazetteer-files.2024.html) |
| Custom Places | Choose one or more addresses, places, cities, or coordinates in **Edit Places**. Local city search and coordinate entry work offline. Submitting a name or address also queries Photon. Shared view links include the selected names and coordinates. | [Photon](https://github.com/komoot/photon) · [OpenStreetMap](https://www.openstreetmap.org/copyright) |

Select a point to see its county, the overall match, and the distance to its nearest eligible site. Distances account for Earth’s curvature. **Location Sources & Downloads** in the map legend opens the definition, reporting period, and downloadable directory for each active or displayed place type.

## Distance to Nature

Under **Add Filter → Land & Terrain → Distance to Nature**, choose a feature and set the minimum and maximum straight-line miles. To find homes near both a lake and a park, add a card for each and choose **Match All**. Choose **Larger Rivers or Lakes** to let either kind of water qualify while keeping your other requirements. Select the eye to see the feature outlines and distance bands, then click the map to identify the nearest mapped feature. Zoom in for narrow rivers and small lakes. [Try a River or Lake Within Five Miles and a Park Within Ten Miles](https://grantwilk.com/home-range/?freshwater=0..5&parks=0..10&layer=freshwater&match=all)

| Feature | Where the distance ends |
| --- | --- |
| Coast & Great Lakes | The nearest mapped shore, including both sides of barrier islands and the mainland shores of bays, sounds, and estuaries, and mapped tidal riverbanks. For ocean and Gulf shores in the contiguous states, Home Range uses NOAA’s charted mean-high-water shoreline and excludes lines drawn across open water to close chart sections. The NOAA compilation was published in 1998 from 1988–1992 charts, which vary in how far they follow tributaries. Erosion and fill can also move the shore. Alaska, Hawaii, and all five Great Lakes use the 2025 Census coastline. [NOAA Medium Resolution Shoreline](https://shoreline.noaa.gov/med-res.html) · [2025 Census Coastline](https://www2.census.gov/geo/tiger/TIGER2025/COASTLINE/) |
| Mountain Ranges | The footprint of a named mountain range. Valleys inside the footprint also read zero miles. Boundaries adapted from Snethlage et al. (2022). [GMBA Mountain Inventory](https://doi.org/10.48601/earthenv-t9k2-1407) · [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| Parks, Forests & Preserves | Publicly owned land recorded as open to the public in qualifying national parks, national forests, state parks, state forests and preserves. Distance reaches the holding boundary and is zero inside. Coverage depends on agency reporting. An entrance or trailhead can be farther away. Busse Woods in Cook County also uses the county’s holdings and the named Ned Brown parcel. [Cook County Holdings](https://www.arcgis.com/home/item.html?id=b6a08eaec52b490ebb2bec09036c5f12) · [Illinois Protected Natural Lands](https://www.arcgis.com/home/item.html?id=c7ec4164dd634895b9351d168e8ac7c6) · [USGS Protected Areas Database](https://doi.org/10.5066/P96WBCHS) |
| Larger Rivers | A mapped centerline of a named stream with Strahler order 3 or higher in the 2014 USGS National Atlas 1:1,000,000 network. The order describes branching in this particular dataset. The Fox River through Aurora, IL, qualifies. [USGS Stream Mapping Method](https://pubs.usgs.gov/sir/2009/5202/) |
| Lakes of 400+ Acres | A mapped lake, pond, or qualifying reservoir polygon of at least 400 acres. Distance reaches the shoreline and is zero on the water. Powers Lake, WI, qualifies at about 451 acres. Explicitly intermittent and industrial waterbodies are excluded. Hawaii has no qualifying lake in this extract. [USGS Hydrography](https://hydro.nationalmap.gov/arcgis/rest/services/nhd/MapServer/12) · [Wisconsin DNR](https://apps.dnr.wi.gov/Water/waterDetail.aspx?wbic=744200) |

Explore a five-mile shoreline filter around [Albemarle and Pamlico Sounds](https://grantwilk.com/home-range/?coast=0..5&layer=coast&extent=20,-16710,-6295) or [Puget Sound](https://grantwilk.com/home-range/?coast=0..5&layer=coast&extent=25,-1813,-911). Zoom in to see narrow inlets or select a location for its measured distance.

Geometry files load when their filters are used. The browser measures from each location to the mapped lines and areas, including polygon holes. Boundaries are simplified for this planning map. Selecting a point computes its distance directly, while the colored bands use samples across the visible map. Shorelines and river centerlines describe physical features; access rights and entrances require a separate check.

## Run Locally

Install Node.js 22.13+ and Python 3. From the project directory, run `npm ci`, then `npm start`. The preview builds and serves the same files used for production. [Open the local map](http://127.0.0.1:4178/)

For a static build, run `npm run build`. The contents of `dist/` can be served at a domain root or a project subpath.

## Publish to GitHub Pages

The Pages workflow builds the site on GitHub and deploys the contents of `dist/`. Changes merged to `main` publish automatically. A version tag such as `v1.0.0` can publish a specific revision. Pull requests build and check the site before review. [Publishing Workflow](.github/workflows/pages.yml)

The project site inherits the custom domain of the account’s main website and lives at `/home-range/`. [Production Map](https://grantwilk.com/home-range/) · [GitHub Pages Custom Domains](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/about-custom-domains-and-github-pages)

## Add a Layer

1. Establish the geographic unit, identifier, source, period, units, precision, missing-value rule, and the meaning of a match. County attributes use FIPS. A distance layer uses named coordinates and the shared straight-line distance calculation.
2. Produce a versioned static attribute file from documented inputs. Join county attributes by five-digit FIPS in the data-loading section of `app.js`. Preserve a missing measurement as null or absent.
3. Add the measure to the registry in `model.js`. Specify the units, definition, period, legend bins, palette, and full filter range. Assign the measure to its type in `filter-catalog.js` so it appears in the picker. The filter rows, controls, legend, search results, and place profile read the registry. For a new facility type, register the measure in `facility-model.js` and provide `data/facilities/<key>.json` with named longitude/latitude rows, sources, dates and a coverage definition.
4. Add source attribution to the legend and place details and a regression check for known values, valid zeroes, coverage, and missing values. Build and test under a project subpath.

## Rebuild and Verify Data

Committed JSON files are sufficient for hosting. Rebuilding the scientific data is optional. Run from this directory with Python 3.11+ and uv.

| Command | Output |
| --- | --- |
| `uv run scripts/crime.py` | County violent-crime and homicide death rates from County Health Rankings |
| `uv run scripts/nature_landforms.py` | U.S. shoreline lines and named mountain-range polygons |
| `uv run scripts/nature_parks.py` | Public parks, forests, and preserves |
| `uv run scripts/nature_water.py` | Larger river centerlines and lake and reservoir polygons |
| `uv run scripts/facilities_schools_grocery.py --cache /tmp/home-range-facilities` | K–12 school and grocery directories |
| `uv run scripts/facilities_hospitals_airports.py` | Bypass-capable hospitals and FAA hub airports |
| `uv run scripts/facilities_cities.py --cache /tmp/home-range-cities` | Census places, municipal towns and their population estimates. Includes checks on representative coordinates. |
| `uv run scripts/hazards.py` | FEMA December 2025 risk percentiles and classifications, matched by county identifier |
| `node scripts/geography.mjs` | Census-derived county geometry and full names |
| `uv run scripts/elevation.py --cache /tmp/home-range-elevation` | Area-weighted terrain elevations in feet for the 2017 county boundaries |
| `uv run scripts/population.py` | July 2025 Census resident estimates matched to the county map and reconciled against published state totals |
| `uv run scripts/build_climate.py --cache /tmp/home-range-epinoaa` | Temperature and day-count statistics from 360 monthly county files and the included Alaska/Hawaii monthly extract |
| `uv run scripts/humidity.py --cache /tmp/home-range-humidity` | County mean relative humidity in the locally coldest and hottest months |
| `uv run scripts/land_cover.py --cache /tmp/home-range-landcover` | County percentages from native USGS land cover grids |
| `uv run scripts/ecoregions.py --cache /tmp/home-range-ecoregions --land-cover-cache /tmp/home-range-landcover` | County shares in two ecological divisions and a desert climate |
| `uv run scripts/rainfall.py --cache /tmp/home-range-rainfall` | Average annual liquid precipitation from monthly ERA5 data |
| `uv run scripts/snowfall.py --cache /tmp/home-range-snowfall` | Mean seasonal depth of new snow from NOAA’s gridded snowfall analysis |
| `uv run scripts/cloud.py --cache /tmp/home-range-narr` | Average annual cloudy-day counts from daily NOAA cloud cover and county boundaries |

Run `npm run lint`, `npm test`, `npm run build`, and `npm run browser`. Browser checks use installed Google Chrome and a temporary local web server. The Python data checks are `uv run tests/land_cover_test.py`, `uv run tests/ecoregions_test.py`, `uv run --with duckdb==2.0.1 tests/climate_test.py`, `uv run tests/cloud_test.py`, `uv run tests/rainfall_test.py`, `uv run tests/snowfall_test.py`, `uv run tests/humidity_test.py`, `uv run tests/population_test.py`, `uv run tests/elevation_test.py`, `uv run tests/cities_test.py`, `uv run tests/schools_grocery_test.py`, `uv run tests/hospitals_airports_test.py`, `uv run tests/test_hazards.py`, `uv run tests/nature_landforms_test.py`, `uv run tests/nature_parks_test.py`, and `uv run tests/nature_water_test.py`. Python formatting and lint are checked with Ruff. [Design and Review Record](REVIEW.md)
