# Requirements

An asset-inventory module: maintain a catalogue of assets,
list and filter them, export the list to Excel, and let the user shape
the exported file.

## Stories

| ID | Title | Sprint | Status | Triggers |
|---|---|---|---|---|
| S-01 | Create, read, update and delete an asset | 1 | planning | P-ASS-01, P-ASS-02, P-ASS-04, P-ASS-05 |
| S-02 | Browse, filter and page the asset list | 1 | planning | P-ASS-03 |
| S-03 | Export the asset list to Excel | 1 | planning | P-EXP-01, P-EXP-03, P-EXP-04, P-EXP-05 |
| S-04 | Customize the exported file | 1 | planning | P-CUS-01, P-CUS-02, P-CUS-03 |
| US-14 | Sign in and access protected functions | TBD | done | — |
| US-15 | Manage roles and enforce permissions | TBD | done | — |

## Sprints

| Sprint | Dates | Stories |
|---|---|---|
| 1 | 15/09/2026 | S-01, S-02, S-03, S-04 |
| TBD | To be scheduled | US-14, US-15 |

## Glossary

| Term | Meaning |
|---|---|
| **Asset** | A physical asset tracked in the inventory. |
| **Asset tag** | Human-assigned unique identifier, printed on a sticker. |
| **Export profile** | A saved, named configuration describing what an exported file contains and how it is formatted. |
| **Extended attribute** | A asset attribute held in the JSON column rather than a fixed relational column. |

## What is not here

Acceptance criteria live in the individual story files. Decision status
lives in the solution space, not here -- a story file names the problems
it triggers and stops there. Sprint progress lives in the issue tracker.