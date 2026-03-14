---
name: community-classifier
description: |
  Classifies community reports from residents into actionable categories
  using LLM-driven analysis. Extracts structured data from free-text input
  (complaints, sightings, emergencies, questions) and routes them to the
  appropriate authority or department.
  
  Designed for the Talkative Agent Hub tool-runner.
  Requires LLM_API_KEY and LLM_BASE_URL environment variables.
---

# Community Classifier Skill

## What this skill does

- Takes a JSON array of raw community reports (text, optional photos, optional coordinates)
- Uses an LLM to classify each report into configurable categories
- Extracts structured fields: category, subcategory, urgency, location, summary
- Generates a classification report with per-category totals and routing info
- Categories and routing rules are configurable via `references/categories.json`

## Use case

Residents submit unstructured reports through a mobile app (text, photos, location).
This skill processes the raw input and produces structured, routable data that can
feed dashboards, heat maps, or be forwarded to the corresponding authority.

## Inputs

- A JSON file containing an array of community reports:
  - `id`: unique report identifier
  - `resident_id`: anonymized resident identifier
  - `text`: free-text description from the resident
  - `timestamp`: ISO-8601 when the report was submitted
  - `location`: (optional) `{ lat, lng, address_hint }` 
  - `attachments`: (optional) array of `{ type, url }` (photos, audio)

## Outputs

- A JSON report (SkillReportEnvelope) with:
  - `totals`: count per category
  - `items`: per-report classification result
    - `id`, `category`, `subcategory`, `urgency` (1-5), `summary`, `routed_to`, `confidence`
  - `routing_summary`: grouped by destination with count and highest urgency

## Tool command (run inside workspace)

```
node skills/community-classifier/scripts/classifyReports.ts --input <input.json> --output <report.json>
```

## Optional flags

- `--categories <path>`: override default categories file
- `--batch-size <n>`: how many reports to send per LLM call (default: 5)

## Rules

See `references/categories.json` for category definitions and routing rules.
See `references/classification-prompt.md` for the LLM prompt template.
