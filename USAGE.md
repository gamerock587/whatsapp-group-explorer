# WhatsApp Group Explorer 7.1

Browse your WhatsApp groups, compare a group with an Excel roster, send invite links to missing numbers, and remove eligible extra members.

## Installation / update

1. Open chrome://extensions (or edge://extensions) and enable Developer mode.
2. Load unpacked: select this folder. For an existing installation, click Reload.
3. Refresh all WhatsApp Web tabs. Sign in and wait for chats to load.
4. Click the extension icon. It opens or focuses a full extension workspace tab.
5. Select a group, then choose an Excel file.

Requires Chrome / Edge 111+. No external server, database, or npm installation is required.
A small extension service worker opens the workspace and runs explicitly requested WhatsApp actions.

## Excel comparison

Choose .xlsx, .xls, or .csv with name and phone columns. Arabic headers الاسم and رقم الهاتف are detected automatically. Supply your own authorized roster; no personal workbook is distributed.
Select a worksheet, verify the name/phone column mapping, and choose whether the first row contains headers.
The initial import compares automatically. After changing settings, click Compare members.
Files are limited to 10 MB and worksheets to 10,000 data rows.

Membership is matched by normalized phone number, never by display name. Local Iraqi numbers such as 077… and numeric Excel values beginning 77… are normalized to +96477….
Arabic and Persian digits, international + and 00 prefixes, and common spaces/punctuation are supported. Local numbers beginning 0 use the selected country code (964 by default).
Unprefixed international numbers are accepted as written. For ambiguous local formats, use the explicit international number.
Multiple numbers in one cell can be separated by comma, semicolon, slash, or newline.
Duplicate numbers are combined and retain associated names. Invalid phone cells and missing numbers are reported by Excel row.

The comparison displays:
- Yellow, first: known numbers in the group but absent from Excel.
- Red: valid Excel numbers not found in the loaded group numbers.
- Matched: members whose phone number is in Excel, with the Excel name.
- Unverified: group members whose phone number is unavailable.

If WhatsApp has unresolved members or partially loaded membership, red entries may still belong to those members. The interface warns about this uncertainty.
Invalid Excel entries disable removal because they could hide a legitimate roster match. An empty roster also disables removal.

## Group invite link

The existing link is fetched from WhatsApp and shown at the top when your account has access.
If unavailable, paste the correct group's link. Copied links with query parameters (such as ?mode=ac_t) are accepted and normalized.
Copy link copies the canonical link.
No existing link is reset or revoked.

Send invite sends ONLY the link as a private WhatsApp message to that row's number, on one explicit click.
It rechecks fresh membership and the group link when accessible, checks WhatsApp registration, then waits for server sending confirmation.
The button shows Invite sent on success and prevents repeat clicks in the current workspace.
For an uncertain send result, it shows Check WhatsApp. Verify the conversation before retrying; there are no automatic retries or bulk sending.

## Removing extra members

Remove is available only for extra members when your account is a group admin and the roster has valid entries with no invalid cells.
The extension disables removal of yourself, other admins, and the owner.
Each Remove click opens a confirmation naming the person, phone number, and selected group.
The action fetches fresh metadata, verifies the selected member and phone, rechecks roster absence, performs removal, and checks membership again.
The workspace then reloads the group.

## Other controls

Search matches names, Excel names, and numbers.
Copy numbers copies unique available group numbers.
CSV export includes the complete comparison (extra, missing, matched, unverified), independent of the current search filter.
Phone values and formula-like names are escaped for safe spreadsheet import.
Changing groups retains the workbook and recomputes the comparison for the selected group.
Closing the workspace discards imported data and in-memory action statuses.

## Privacy and compatibility

Workbook parsing and comparison happen locally. There is no separate backend or extension storage of roster data.
Send invite transmits the link through your signed-in WhatsApp account. Remove changes WhatsApp group membership only after confirmation.
The old school notifications, invoice workflow, queues, and localhost integration are removed.

Group and member data are limited to what WhatsApp exposes to your account. @lid account identifiers are never displayed as phone numbers.
Internal WhatsApp APIs are unofficial and can change. A live-account verification is still required after installing this release.

## Validation

Run npm test with Node.js 18+.
Tests cover phone normalization, duplicates, invalid entries, the supplied workbook, LID handling, group access errors, invite validation, admin/roster protections, and action failures.
Browser checks have covered the actual workbook import and comparison UI. A loaded-extension test also exercised the real Manifest V3 content bridge and worker against local simulated WhatsApp APIs.
No real messages were sent and no actual group members were removed during development.

