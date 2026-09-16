# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Small-business owners and operators using FYNTA to understand financial records and complete guided accounting actions.

## Product Purpose

FYNTA provides a tenant-scoped accounting workspace for financial records, summaries, and guided writes. Success means users can ask natural-language questions or start an action without learning where every accounting feature lives.

## Positioning

Ask FYNTA combines grounded accounting answers with confirmation-first guided actions inside one conversation.

## Operating Context

Users work within a selected organization and branch. Today/Home is the business overview; Ask FYNTA is the conversation surface for asking about records and initiating actions.

## Capabilities and Constraints

- Read-only financial answers are grounded in selected-branch records.
- Guided invoice, quotation, and customer flows render in the conversation and require explicit confirmation before saving.
- Write-action idempotency and authorization safety must remain intact.
- Desktop uses a conversation workspace; mobile uses a full-width conversation with History as a drawer or temporary sheet.

## Brand Commitments

Use the approved FYNTA logo and uppercase brand presentation with the existing typography, blue accent, border language, and accounting terminology. Avoid presenting Ask FYNTA as a KPI dashboard.

## Evidence on Hand

Existing routes, guided action components, assistant API, and QA Preview deployment are present in the repository.

## Product Principles

- Conversation first, dashboard second.
- Answers are grounded in the user's selected tenant and branch.
- Writes are previewed and confirmed before persistence.
- Useful context appears in response to a question, not permanently before it.

