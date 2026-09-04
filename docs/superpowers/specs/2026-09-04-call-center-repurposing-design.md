# Call-center CRM repurposing design

## Goal

Repurpose the existing dealership follow-up CRM into a local, demo-ready call-center system. The demo must use dummy data and an isolated local PostgreSQL database. It must not read from or write to the currently connected database service, and it must not modify the existing `.env` configuration.

The demonstration flow is:

`Admin login -> import workbook -> select five Call Guys -> assign leads -> Call Guy logs follow-ups -> managers review performance`

## People and permissions

### Admin

Admin imports lead workbooks, selects the five Call Guys used for assignment, manages users and master data, reassigns leads, and sees all reports across branches.

Admin sees two distinct performance views:

- Call Guy execution performance, grouped by the platform user who processed calls.
- Sales Officer lead performance, grouped by the original Sales Officer imported with each lead.

### Call Guy

There are five Call Guy users in the demo. They form one shared pool across every branch. They see only leads assigned to them and use the existing Fresh, Today, All, and lead follow-up workflow.

Call Guys can log call status, outcomes, remarks, next follow-up dates, booking and retail details, test-drive details, exchange prices, and flags. The current F1, F2, F3, and later follow-up history remains.

### Call Center Manager

The Call Center Manager sees the performance of the five Call Guys across all branches. Their dashboard focuses on workload and calling execution: assigned leads, untouched leads, pending and overdue follow-ups, call outcomes, conversions, lost reasons, and flags.

### Branch Sales Manager

Each Branch Sales Manager is assigned to one branch and can see only that branch's results. Their performance view is grouped by the original Sales Officer attached to imported leads. It shows how those leads progressed after Call Guys processed them.

Sales Officers do not log in, receive platform assignments, or log calls in this application.

## Lead ownership model

Each lead keeps three separate values:

- `branch`: the branch from the import and the scope used for Branch Sales Manager reporting.
- `original sales officer`: the Sales Officer from the imported source data. This is reference and reporting data, not a platform user.
- `assigned call guy`: the platform user responsible for follow-up work.

The branch does not restrict the shared five-person Call Guy pool. Leads from all branches can be assigned to any selected Call Guy.

## Workbook import

The demo upload uses one combined workbook with these columns:

- `Name`
- `Mobile`
- `Source`
- `Branch`
- `Location`
- `Model`
- `SO Name`
- `SO Mobile`
- `Status`

The current repository contains two separate example workbooks: one with lead and branch details and another with Salesforce Sales Officer details. The import will normalize the combined demo format and retain mobile-based matching compatibility where practical.

The import flow will continue to validate required values, normalize mobile numbers, detect duplicates, resolve branch/source/model names against master lists, show a review step, and assign accepted rows to selected Call Guys. The sample workbook will contain multiple branches and original Sales Officers so the full reporting split is visible.

## Reporting

### Call Guy metrics

The Call Center Manager and Admin can inspect:

- total assigned leads
- untouched and active follow-up leads
- due and overdue work
- follow-up count by F1 through F5+
- Connected versus Not Connected calls
- outcome counts
- bookings and retail conversions
- lost outcomes and reasons
- flagged leads
- branch breakdowns

### Sales Officer metrics

Branch Sales Managers see only the original Sales Officers represented by leads in their branch. Admin sees all branches. Metrics are calculated from Call Guy follow-up activity but grouped by the imported Sales Officer, including lead volume, latest outcome, bookings, retail, open follow-ups, lost leads, and conversion-related counts.

## Local isolation

The app will gain a clearly separate local demo configuration, for example `.env.demo`, pointing to a database named `followup_crm_demo` on `localhost`. The current `.env` remains unchanged and is not loaded by the demo command.

The demo setup will seed:

- one admin
- five Call Guys
- one Call Center Manager
- Branch Sales Managers for the demo branches
- demo branches, sources, models, and activities
- imported-style leads and follow-up history

The implementation must fail clearly if the demo configuration is missing rather than silently falling back to the connected database settings.

## Compatibility decisions

- Existing follow-up rules, outcome names, lead history, flagging, and Excel export behavior remain unless a role or reporting change requires an adjustment.
- The legacy Sales Officer platform role should not be used for the new demo workflow. Existing database records are not deleted as part of this local demonstration.
- Marketing lead creation is outside the main demo path because Admin owns the import and assignment demonstration. It may remain available only where retaining existing behavior is low risk.
- The current Salesforce data relationship is preserved as imported Sales Officer data, with the lead mobile number remaining the matching key.

## Success criteria

The demo is successful when:

1. The server can start against the isolated local demo database without using the connected database service.
2. Admin can upload the sample workbook, review it, select five Call Guys, and assign all accepted leads.
3. A Call Guy can log in and process assigned leads through multiple follow-ups.
4. The Call Center Manager can see Call Guy performance across branches.
5. A Branch Sales Manager can see only their branch's original Sales Officer performance.
6. Admin can see both Call Guy and original Sales Officer performance.
7. The sample workbook supports this flow without manual data editing.

