# Phase 7: Documentation

**Goal:** Document Effect adoption for contributors (EN + zh-CN), linked from architecture pages, without changing runtime code.

**Inputs:** [Overview](./00-overview.md); completed or in-progress Phases 1–2 (minimum content); Diátaxis layout under `docs/`.

**Assumptions:**

- User-facing tutorials/how-tos do not need Effect details (implementation concern).
- Explanation docs are the right Diátaxis slot.
- Chinese mirror required per `AGENTS.md`.

**Architecture:** Add `docs/explanation/effect.md` describing boundary rules, module map, import style, and phase status. Link from architecture. Keep plans directory as implementation source of truth.

**Tech Stack:** Markdown only.

**Depends on:** Phase 1–2 content to describe accurately. Can draft early; finalize after those merge.

**Out of scope:** Rewriting protocol spec; marketing copy in README beyond an optional Explanation bullet.

---

## File Map

- Create: `docs/explanation/effect.md`
- Create: `docs/zh-CN/explanation/effect.md`
- Modify: `docs/explanation/architecture.md` — Related link
- Modify: `docs/zh-CN/explanation/architecture.md` — Related link
- Optional Modify: `README.md`, `README.zh-CN.md` — one Explanation list entry
- Optional Modify: `docs/plans/effect-adoption-plan/README.md` — mark phase status when docs land

---

## Tasks

### Task 7.1: English explanation

**Outcome:** Contributors know how Effect is used and what not to do.

**Files:**

- Create: `docs/explanation/effect.md`

**Steps:**

- [ ] Sections (concise editorial style):
  1. Why Effect in pi-x-ide
  2. Boundary rule (run at edges; no leak into Pi host / VS Code activate)
  3. Module map: `effect-errors.ts`, `effect-runtime.ts`, `effect-schema.ts`, `schema.ts` adapters
  4. Import style
  5. Error tagging conventions
  6. What stays Promise-based
  7. Non-goals (no full Layer rewrite yet; plugins out of scope)
  8. Link to `docs/plans/effect-adoption-plan/`
- [ ] Do not document unmerged APIs as if shipped; phrase “introduced as adoption proceeds” if drafting early.

**Validation:**

- Open file in editor; links to architecture and plans resolve.

### Task 7.2: Chinese mirror

**Outcome:** `docs/zh-CN/explanation/effect.md` matches EN structure.

**Files:**

- Create: `docs/zh-CN/explanation/effect.md`

**Steps:**

- [ ] Mirror headings and rules.
- [ ] Single space between English/code and Chinese text.
- [ ] Relative links: plans path needs correct `../../plans/effect-adoption-plan/` depth from `docs/zh-CN/explanation/`.

**Validation:**

- Visually compare section list EN vs zh-CN.

### Task 7.3: Architecture cross-links

**Outcome:** Architecture pages point to Effect explanation.

**Files:**

- Modify: `docs/explanation/architecture.md`
- Modify: `docs/zh-CN/explanation/architecture.md`

**Steps:**

- [ ] Add under Related: link to `effect.md` / Chinese counterpart.
- [ ] One sentence: Pi-side TypeScript may use Effect internally for errors/schema/IO.

**Validation:**

- Links resolve from both language trees.

### Task 7.4: Optional README index entry

**Outcome:** Discoverable from root README documentation list.

**Files:**

- Optional Modify: `README.md`, `README.zh-CN.md`

**Steps:**

- [ ] Under Explanation: “Effect adoption (contributors)” → docs path.
- [ ] Keep EN/ZH sync.

**Validation:**

- README links work on GitHub preview.

---

## Final Validation

- Run: none required for code
- Check: EN/ZH pairs exist and architecture links valid
- If code phases already merged: ensure module names in docs match repo (`rg effect- src/shared`)

---

## Failure Behavior

- N/A (docs only)

## Privacy and Security

- Docs must restate: never log auth tokens.

## Rollout Notes

- Can merge with Phase 1–2 PR or follow immediately after.
- Update phase status table in plan README when done.

## Risks and Mitigations

- **Docs drift** — keep plan directory as detailed tasks; explanation stays short principles only.

## Open Questions

- None.
