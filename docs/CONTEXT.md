# FluxRadar

FluxRadar runs a one-off paid audit of a public website and turns what it finds into a report the
site owner can act on.

## Language

### Findings

**Rule**:
A versioned check (e.g. `a11y-001`) that a module runs against a site; each one carries a fixed,
human-written recommendation.

**Issue**:
One rule failing on one target (a page, resource or selector), identified across scans by its
fingerprint.

**Open Issue**:
An issue whose status still asks the owner for work: New, Acknowledged or Reopened. Every other
status (Resolved, Ignored, False Positive) is settled.
_Avoid_: active issue, unresolved issue

**Coverage**:
The share of a module's applicable checks that actually completed in a scan. It describes how much
was checked, never how much of anything was fixed or planned.

### Report

**Action Plan**:
A prioritized plan of what to fix on a Complete scan's site and how, written for whoever does the
fixing, and written by AI. Its wording is fixed once written;
its issue counts, Reach and settled Actions follow the scan's current issue statuses. A scan holds
at most one Action Plan per language, and the owner picks that language when asking for it. Re-running
the scan discards its Action Plans, because the issues they were written from no longer exist.
_Avoid_: summary, AI summary, report summary

**Plan Window**:
The three days after a scan's latest run finishes, during which its owner may ask for an Action
Plan. Plans written inside the window stay readable for as long as the report does.
_Avoid_: entitlement (that is the purchase's 30-day window for scans and retries)

**Overview**:
The jargon-free paragraph at the top of an Action Plan that can be forwarded to a client as is; it
is the report's executive summary.
_Avoid_: executive view, client version

**Action**:
One change a person makes in one go that resolves the issues of at least one rule found in the
scan. Advice tied to no such rule is not an Action. An Action may cover several rules, but a rule
belongs to at most one Action of a plan; different causes behind one rule are steps within that
Action. An Action is settled once none of its rules has an open issue left.
_Avoid_: recommendation, tip

**Reach**:
The share of a scan's open issues that at least one Action of its Action Plan addresses, shown
alongside the number of rules involved.
_Avoid_: coverage, plan coverage

**Issue Summary**:
A scan's issues folded by rule, in urgency order, without any AI involved.
_Avoid_: summary (on its own)
