# ZIP management test site

Open the existing GitHub Pages `zip-management/` page. This remains one
self-contained HTML application; no Python server or local installation is needed.

## Test GHL contact totals

1. Add or locate Used history containing a ZIP to test (for example `33701`).
2. In Used ZIPs, select **Connect GHL** (or **Connection**).
3. Paste the private integration token into the password field and confirm the
   location ID. The supplied test location is prefilled; the token is not.
4. Connect. The ZIP list remains usable while individual spinners turn into counts.

The token stays in this tab's memory and is cleared from the input on submit or
close. It is not saved to IndexedDB, SQLite, localStorage, URLs, or repository code.
After a page reload, connect again; cached counts can then be reused. Disconnect
clears the in-memory connection without deleting existing ZIP data.

Each badge uses the integer `total` from `POST /contacts/search`, with API version
`2021-07-28`, `page: 1`, `pageLimit: 1`, and the exact `postalCode eq ZIP` filter.
Counts are for the configured GHL location, irrespective of ZIP assignment.
A zero is a verified result, not a default for missing/failed data. No contacts are
edited, deleted, or stored by this feature.

## Request control

- ZIP rendering and SQLite mutations never wait for GHL. Count updates repaint
  only the matching badge and never disable ZIP editing controls.
- Only visible Used ZIP badges are scheduled. Queued offscreen work is skipped.
- Two workers per tab, with starts spaced at least 500 ms through a location-wide
  Web Lock shared by tabs of this origin. This leaves headroom below 100/10 seconds.
- A per-ZIP Web Lock and cache recheck coalesce duplicate requests across tabs.
- Successful counts are cached for an hour, keyed by location, a one-way credential
  fingerprint and the exact filter contract, in a separate IndexedDB store.
  Changing view or re-rendering does not fetch fresh provider data unnecessarily.
- **Refresh visible counts** refreshes only those ZIPs, at most once per minute
  per ZIP. Cached values remain visible with a spinner during revalidation.
- A `~` denotes an older cached count; hover for its checked time. `!` denotes an
  unavailable count. Authorization or browser network/CORS failures pause the
  queue instead of failing separately for hundreds of ZIPs.
- HTTP 429 honors Retry-After, with at most one automatic retry. Other transient
  errors are bounded; repeated failures pause the queue.
- Overall-contact-total-based invalidation is deferred until the per-ZIP test is
  verified. For this iteration use the cache lifetime or explicit visible refresh.

Current Chrome/Edge over HTTPS provides the required Web Locks coordination.
Browser-to-GHL requests are subject to the provider's CORS and credential rules;
network/CORS errors are displayed distinctly from verified zero counts.

This is only the standalone test implementation. A later portal integration must
use the existing server-side credential resolver, verified account/location
mapping and website authorization; the runtime token-entry UI is for this test.
No portal repository or production database changes are part of this addition.

## Offline regression tests

With Node 20+ (no packages or real credentials needed):

```sh
node --test zip-management/tests/contact-counts.test.mjs
```


## Find a ZIP in Used ZIP history

Use **Find a ZIP in history** within the Used ZIP history section. Enter one ZIP
to show every matching entry, including deleted occurrences and pending requests.
Short numeric ZIPs are padded with leading zeroes, consistently with ZIP entry.
Matching ZIPs receive a blue outline; their existing deleted/duplicate styling
remains visible. Each result keeps its original row number, date, source and
comment/order number, plus the rest of the ZIPs in that entry. A GHL-tagged row
is still a manually pasted GHL list, and Pending is not a confirmed order.

**Clear search**, the input's clear control, or **Escape** restores all history.
Invalid input (including ZIP+4, text or multiple ZIPs) shows a message and leaves
all entries visible. The filter uses only the current history already loaded in
memory: no new SQLite reads, GHL requests, storage writes or schema changes.

Run all standalone regression tests with:

```sh
node --test zip-management/tests/*.test.mjs
```


## Sort Used ZIPs

Used ZIPs default to **smallest-to-largest ZIP order** in every view. The only
sort buttons are **Contacts ↓** (highest first) and **Contacts ↑** (lowest first).
Click the active contact-sort button again to clear it and restore ZIP order. Sorting also applies to each Used search-result subset. In By State and
By City views it sorts ZIPs inside each group. ZIP sorting keeps geographic
headings alphabetical; contact sorting orders groups by their summed available
contact counts as well. Contact-count ties use ascending ZIP order. Unknown, missing or
invalid counts stay last in either direction; a verified zero is a real count.

Contact sorting uses only the current connection's already available count
cache, including displayed older cached values. The small availability indicator
shows how many Used ZIPs currently have known totals. Sorting does not request
counts for the entire list; the existing visible-ZIP loading, caching, pacing
and retry rules continue to apply. As counts arrive, chips move in place after
a short debounce, retaining selection/focus/scroll and their existing count
badges and observers. Disconnecting/changing the connection clears those counts.

**Copy all** follows the selected ZIP/contact ordering. Sorting does not modify
SQLite, history, assignments or deletion records. The selection is retained
while changing views or refreshing this page's data; reloading defaults to smallest-to-largest ZIP order with neither contact button active.


## State and city contact totals

Used ZIP state/city headings show the sum of available contact counts for the
ZIPs displayed in that group. All counts known: **1,234 contacts**. Partial:
**≥1,234 contacts · 2/3 ZIPs**. None known: **— contacts · 0/3 ZIPs**. A verified
zero remains zero. Group sorting uses the available subtotal in the chosen
direction, with no-count groups last and state/city names as stable ties.
Totals and group/ZIP order update in place as counts arrive or a connection
is cleared, without remounting count badges or restarting their observers.

Search-result groups sum only the ZIPs in that result, not the entire state
or city. Individual contact badges retain their existing stale/cache indicators;
group sums use those available values. No extra provider requests, SQLite reads
or schema changes are introduced for these totals. History grouping is unchanged.


## Uniform Used ZIP tiles

Used ZIPs use an equal **88 × 36 px** tile in individual, state, city and search
views. The ZIP is centered on the first line, with its selection checkbox and
delete control alongside. A smaller, italic contact count sits directly below the ZIP code. The ZIP code’s font size and weight are unchanged. The tile dimensions stay fixed as counts load or change length.
Loading, stale and error indicators remain available; hover keeps the full count
and timestamp explanation, and the count retains its accessible label.
