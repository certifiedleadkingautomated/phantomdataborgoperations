# ZIP map prototype

The top summary counts unique Used and New ZIPs from the current subaccount's
existing data. The map icon opens a large dialog without starting GHL requests.
Leaflet 1.9.4 and Geoman Free 2.18.0 load only when the map opens. OpenStreetMap
tiles load for the visible view, with attribution.

Upload `uszips.csv` using the existing upload control. It now retains `lat` and
`lng` in addition to `zip`, `city`, and `state_name`. Earlier uploads only saved
city/state: upload the CSV again to supply map coordinates. Existing ZIPs and
history are preserved. A city/state-only CSV remains usable for grouping, but
cannot supply map coordinates. Missing locations are listed explicitly rather
than plotted at a guessed location.

Used pins are blue, New pins orange, and Home pink. The map's Home ZIP test field
is optional and stored only for this local subaccount. If Home is also Used or
New, one pink pin retains that usage label. Portal integration will read its value
from `portal_accounts.home_zip`; this prototype changes no portal/Supabase code.

Double-click the map or press **Draw area**, click boundary vertices, and click
the starting vertex or double-click to finish. Drag vertices/midpoint handles to
edit. Only one polygon is active. Width and height are bounding dimensions in
miles, matching the supplied Apps Script behavior. The copied list contains
additional ZIP centroids inside/on the polygon, excluding Used, New, and pending
ZIPs. Drawing or copying does not add, delete, or change ZIP usage.

Purple pins show additional ZIPs in the selected polygon, matching the other
pin icons. Visible pins render in small frame batches and are reused as the view
moves, keeping their popups stable. The full sorted list is retained and
copied without a display cap. The local reference is read once each time the map
opens; edits use that in-memory lookup, with no sheet or provider requests.

The initial view fits the current Used/New/Home pins. Legend entries
expand to show mapped and missing ZIPs. **Clear area** removes only the polygon
selection. Escape only clears an active polygon/drawing, including a radius
polygon, and keeps the map open even when no area exists or search is focused.
Close the map explicitly using its top-right X button.
A missing library/data source produces a visible retry instruction.

The **Find ZIP** field searches the local uploaded coordinate lookup and pads
short ZIPs to five digits. It centers on the result, opens its popup and highlights
it with a teal ring without changing an existing Used/New/Home color or status.
ZIPs outside those lists receive a temporary search pin; searching never records
ZIP usage. Missing coordinates produce a clear error without external geocoding.
The clear-search button removes only that highlight, retaining the drawn area.

Every individual pin's popup includes a radius in miles and **Draw radius**.
This creates a 64-vertex geodesic polygon at the requested distance, replacing
only the previous temporary selection. It starts circular but uses the same
vertex/midpoint editing as a manually drawn polygon. Selected ZIPs and measurements
update after edits. The help text distinguishes the original radius from the
later edited area; editing does not claim the boundary is still a true circle.
Valid radii are 0.1–5,000 miles. No ZIP records, GHL contacts or assignments change.

`tests/fixtures/map-zips.csv` provides synthetic reference points for browser
tests. `node --test zip-management/tests/*.test.mjs` runs all local regressions.
