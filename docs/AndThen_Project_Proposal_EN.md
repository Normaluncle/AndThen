# Project Proposal: "And Then?" (然后呢?)

> **Let every answer written in earnest have a chance to meet its afterward.**

| Project Name | And Then? (然后呢?) |
| --- | --- |
| Document Version | v1.1 (restructured with the framework-plan methodology) |
| Date | 2026-09-14 |
| Document Type | Full proposal integrating product requirements, user research, project progress, and business value |
| Audience | Competition judges, incubation evaluation, pilot planning |

> This is the English version of `然后呢_项目企划书.md` (v1.1). In case of any discrepancy, the Chinese version prevails.

---

## Contents

1. [Project Positioning](#1-project-positioning)
2. [Why This Matters](#2-why-this-matters)
3. [Research Evidence](#3-research-evidence)
4. [Service Boundaries](#4-service-boundaries)
5. [Product Design](#5-product-design)
6. [v1.0 Overall Goals](#6-v10-overall-goals)
7. [Current Progress](#7-current-progress)
8. [Business Value](#8-business-value)
9. [Roadmap](#9-roadmap)
10. [Beyond v1.0](#10-beyond-v10)
11. [Appendix](#appendix)

---

# 1. Project Positioning

**"And Then?" lets readers express follow-up interest in a past experience, lets the original author voluntarily take an AI-assisted interview based on their original post, and connects the author-confirmed "afterward" back to the original answer for preservation, publication, and re-reading.**

Its goal is **not** a new content platform competing with Zhihu, **not** a "comeback / success story" channel, and **not** an independent fact-checking tool for readers — **but** a revisit mechanism running on top of Zhihu's existing Q&A assets: letting "half-told stories" grow an author-confirmed "afterward" — with the author's full consent.

The core loop:

```
A real, authorized old answer
        ↓
   A reader follows up
        ↓
   Fit-for-revisit judgment
        ↓
   Manual / verified-channel invitation
        ↓
     Original-author verification
        ↓
       AI dynamic interview
        ↓
   Author confirms item by item
        ↓
   The "Afterward" is published
        ↓
   Following readers get notified
```

The product fixes its two ends as "ask" and "answer": the reader-side button is **"And Then?"**; the author-side content object is called **the "Afterward" (后来)**; the main CTA is **"Write Your Afterward"**. The naming reflects where the product truly starts: the reader's natural "I want to know more" upon seeing an old answer. The author, on the other hand, is not asked to answer a question again, but to write what actually happened — their own "Afterward." (Full brand-language table in Appendix D.1.)

---

# 2. Why This Matters

Zhihu has accumulated over a decade of real-life experience — career pivots, startups, home-buying, grad school, industry predictions. These posts were complete when published, but time turned them into "half-told stories": readers finish and leave, authors finish and stop, and the platform can only keep re-recommending the same batch of old content. Our research shows this is not an isolated phenomenon:

| Problem | Impact |
| --- | --- |
| Readers' follow-up desire has nowhere to go | 53.8% of respondents wanted to know more after reading old posts; 73.1% saw value in a "follow the follow-up" feature — yet no product exists to receive that action |
| The bar for authors to share updates is too high | Willingness is not the problem (all 4 authors said they would consider it) — burden is: rewriting long posts, feeling pressured or judged keeps their stories frozen in time |
| Long-tail content has no second life | Without new content nodes, long-tail answers can only be re-recommended; a decade of "experience assets" cannot be reused |

"And Then?" solves one fundamental problem: **attaching an authorized, traceable "follow-up" link to existing content** — not rebuilding every link of the content ecosystem at once.

---

# 3. Research Evidence

Dual-track validation: **broad survey + deep prototype**. The reader survey verified whether the need exists and where it concentrates; the cloud prototype verified whether the loop runs end-to-end and whether the boundaries hold.

## 3.1 Reader Side: The Need Exists, and It Is Highly Concentrated

Sample: 27 submissions, 26 valid. Three content types in a controlled design; each respondent read 5 random posts and answered per post. (Data source: survey exports listed in Appendix E; methodology in Appendix C.)

**Willingness indicators**

| Indicator | Result |
| --- | --- |
| Wanted to know more after reading | **14 people (53.8%)** |
| Saw value in a "follow the follow-up" feature | Very valuable 4 + fairly valuable 15 = **19 people (73.1%)** |

**Three content types compared** (percentages over 26 valid respondents; per-post exposure is a randomized subset — cross-post comparison should be read with caution)

| Content type | Examples | Wanted the follow-up | Share |
| --- | --- | --- | --- |
| **Type B — contrasts / judgments** | quit at 43, real estate's last five years, housing prices for 30 years, career outlooks, side-hustle guides, company picks | 9 | **5.8%** |
| **Type A — emotional venting** | studying-abroad breakdowns, workplace rants, nightmare roommates, rage-coping posts | 4 | **3.1%** |
| **Type C — evergreen knowledge** | entropy, long-termism, product-management notes, supply & demand | 1 | **0.8%** |

**Three key findings**

**Finding 1: The need is concentrated, not universal.**
Across 16 posts, the top two — "Quit at 43" and "Real estate's last five years" — each reached 11.5% (3 people); 8 posts scored 0%. The feature should not open to all content; it should precisely identify posts with unfinished events, plans, or judgments.

**Finding 2: "Interesting" and "want the follow-up" are two different things.**
"Entropy" had the highest positive reading sentiment of all (9 people, 34.6%) — yet nobody wanted to know what happened to its author. Knowledge posts satisfy the present need and create no follow-up motive. This directly supports the decision not to implant the entry point in already-closed content.

**Finding 3: What triggers follow-up is narrative gap and self-projection, not popularity.**
"Story left unfinished" (53.8%) and "similar to my own situation" (42.3%) far outweighed social cues like author fame or upvotes. Entry-point screening should be based on content structure, not engagement data.

## 3.2 Author Side: Willingness Is Not the Problem — Boundaries Are

Sample: 4 authors — 3 who had published, 1 who had not, including 1 explicitly skeptical of AI.

| Sample | Published? | AI revisit willingness | Concerns |
| --- | --- | --- | --- |
| Sample 1 | No | Depends | Privacy |
| Sample 2 | Yes, professional domain | Very willing | Privacy |
| Sample 3 | Yes, personal planning | Depends | Failed, regretful experiences |
| Sample 4 | Yes | Depends | Privacy; skeptical of AI |

**Core observation: nobody refused to participate.**

- Conditions for accepting a revisit (multi-select): can skip questions **75%**; can set visibility / anonymity / save-without-publishing **75%**; the AI understands what I mean **75%**; can edit what the AI organized 50%; no need to write long text 25%.
- Reasons to decline (multi-select): privacy concerns **100%**; failure and regret 25%; distrust of AI 25%.

**Verbatim quotes from respondent authors** (source: open-ended questions in the author survey; data files in Appendix E)

> "Opening those things I wrote back then… I realize how naive I was, so full of ideas; now I feel a bit worn down by life… a little lost, and a little relieved, too."
> —— Author Sample 3 (published personal-planning content, 2026-09-13; original in Chinese)

> "I haven't reached the state I imagined back then, and there's still a bit of regret — but the goal is still the goal, and I'm calmer about it now."
> —— Author Sample 3

> "I've uninstalled Zhihu. The things that felt like the end of the world back then look like small matters now."
> —— Author Sample 1 (never published, 2026-09-13)

> "Fixed questionnaires feel too rigid — like finishing a task; even if I write, it feels like no one truly understands me, just me outputting one-way. But with an AI dynamic interview… I feel my words actually get a response."
> —— Author Sample 3 (prefers AI revisit)

> "AI's data analysis can assist decisions, but it must not seep into life."
> —— Author Sample 4 (skeptical of AI, 2026-09-14)

> "The posts I wrote back then drew a lot of resonance and questions… I passed my experience on to people who needed it. I got wet in the rain myself, and held an umbrella for others."
> —— Author Sample 2 (very willing, 2026-09-13)

The shared emotion of authors re-reading their old posts is "worn down by life, a little lost, a little relieved" and "didn't reach the state I imagined, with some regret." **Revisiting old posts generally comes with negative emotions** — the interview tone must hold that regret, not force a "comeback / success" frame.

## 3.3 The Core Tension: What Readers Want Is Exactly What Authors Most Need to Protect

| Side | What they want | Data |
| --- | --- | --- |
| **Readers** | Follow-ups on big decisions and judgments — what happened after quitting, did the prediction come true | Decision/judgment posts' follow-up rate 5.8% — **7×** that of knowledge posts |
| **Authors** | These same posts are the most sensitive — privacy, failure, regret | **100%** mentioned privacy; failure and regret were explicitly named |

**The value readers want sits precisely in the territory authors most need to protect.**

Therefore, "And Then?" will succeed or fail not by whether it can ask, but by whether it can make authors willing to answer safely. That is why author control comes first: **private by default, skippable, editable, revocable, and publication requires separate confirmation** — these are not add-on features but the preconditions for the need to exist at all.

---

# 4. Service Boundaries

"And Then?" is responsible for exactly one thing: **running the single loop of "follow-up → revisit → author confirmation → publish the Afterward" over authorized historical content.**

In scope:

- Ingestion and versioning of authorized historical content
- Reader follow-ups, revisit-fit judgment, invitations, and original-author verification
- AI dynamic interviews, author item-by-item confirmation, publication, and revocation
- De-identified research exports under defined metrics

Out of scope:

- **Independent verification of life outcomes** — "time verification" only means comparing the original statement with the later revisit; it is not a fact audit or causal proof
- **Generating results the author never provided** — the AI identifies, interviews, links evidence, and organizes; it never fabricates an "Afterward"
- **Using income, illness, or life "win/loss" as hooks** — pilots start from learning projects, professional growth, personal works, and non-sensitive career experiences
- **Depending on full historical data or on-platform push to run** — the loop works on restricted sources alone

Eight product decisions:

| # | Decision | Rationale & boundary |
| --- | --- | --- |
| D01 | Reader follow-ups enter the main loop; an author-initiated entry is kept in parallel | Both reader demand and author initiative have value; neither is made the only entry |
| D02 | No upvote or recency threshold | Candidates are chosen by the existence of revisitable events/plans/judgments; engagement is auxiliary only |
| D03 | The AI identifies, interviews, links evidence, and organizes | Never generates results the author didn't provide; never packages auto-scoring as "optimal timing" |
| D04 | Start from low-sensitivity domains: learning, professional skills, projects | Respect author boundaries; build trust from the safest scenarios |
| D05 | Publish a separate follow-up record linked to the original answer | Forms a complete content object with a traceable relationship |
| D06 | Runs without full historical data or on-platform push | Reduces external dependencies; keeps the loop reliable |
| D07 | Focus on one reliable path rather than parallel feature development | Make one thing trustworthy before expanding |
| D08 | Evaluate with behavior and evidence, not promotional claims | Conclusions must come from actual execution records |

**Tone boundary**: when facing failure, changed plans, or experiences the author prefers not to publicize, always use voluntary, gentle language — never wording that could read as pressure or interrogation.

---

# 5. Product Design

**Three entry scenarios**

| Scenario | Description |
| --- | --- |
| Reader-initiated | An authorized answer enters the system; a reader clicks "And Then?" creating a real demand event; after content-fit, safety, and identity checks, researchers decide whether to send a manual invitation |
| Author-initiated | The author imports their own historical content and starts the revisit voluntarily — interview and publication work even without reader follow-ups; the page is explicitly labeled "author-initiated" |
| Pre-consented pilot authors | Researchers complete recruitment, identity verification, and display permission in advance, creating a restricted entry for validating the system and the revisit experience |

**Core mechanisms**

**Follow-ups dedupe and can be undone.** One person, one post, one vote; cancelling a follow-up removes it from reason statistics. When clicking "And Then?", readers may choose "the result and changes now," "the turns and experiences along the way," or "reflections and advice looking back," or write a custom question (≤20 characters). Custom questions are categorized by AI after consent — for topic selection only, never overriding the author's no-go boundaries.

**Interviews degrade gracefully and never lose data.** Text-based, at most five main questions, one question at a time; follow-up, skip, pause, and early exit are all supported. On network or model failure, the session converts to a manual form; saved answers are never lost.

**Publication requires author confirmation.** Drafts keep the original interview questions; questions and answers are published only after the author confirms both, and the author may hide questions. Any edit invalidates prior confirmation — re-confirmation is required. Private by default; publication requires separate confirmation.

**Revocation and deletion take effect immediately.** After revocation, the public page is inaccessible. Deletion proceeds item by item: source, interview, draft, public artifact, cache, index.

**Three key data-governance designs**

1. **Separate past and present** — a revisit records both "when the author said it" and "when the thing happened."
2. **Layered authenticity** — identity association, author confirmation, and external evidence verification are stored as independent states.
3. **Authorization is never derived from login** — a successful login does not create a public authorization; consent is recorded separately and re-checked at publication time.

Research metrics: one person one vote per post; research exports contain whitelisted fields only — no user identifiers, raw texts, interview answers, or drafts; readers and authors are separate cohorts and are never merged. (Page list, roles & permissions, and data-model details in Appendix D.)

---

# 6. v1.0 Overall Goals

v1.0's goal is to make one real loop **runnable, verifiable, and demonstrable** — not to cover all content domains.

| Goal | What it means |
| --- | --- |
| The loop can run end-to-end | At least one authorized source completes follow-up → revisit → author confirmation → publication → follower-list update |
| Error paths can be demonstrated | Unconfirmed publication is rejected; unauthorized reads are rejected; after revocation the public page is inaccessible |
| Degradation has a fallback | On model failure, saved answers are kept and the loop can complete via the manual form |
| Research data exports by defined metrics | De-identified, cohort-separated, whitelisted fields |

**Success criteria**

- **Engineering success**: at least one authorized source completes the full loop; key error paths are demonstrable; no unauthorized publication or fabricated counts.
- **Research success**: traceable positive and negative feedback, showing in which samples the target behavior did or did not occur.
- **Business success**: to be defined after a larger sample, a longer observation window, and platform collaboration.

---

# 7. Current Progress

## 7.1 Loop status, reported as-is

| Stage | Status |
| --- | --- |
| Historical content ingestion | **Done**: link import, source versioning, official-search verified |
| Reader follow-ups | **Done**: one person one vote, cancellable, cancellations excluded from stats |
| Revisit-fit judgment | **Done**: source analysis among four AI task types; identifies events, plans, and judgments |
| Invitation & verification | **Done**: invitation records, fixed observation window, acceptance-rate cohort stats |
| AI dynamic interview | **Partial**: skip and save pass; semantic repetition and premature wrap-up remain — in synthetic samples, question 3 wrapped early, question 4 was blocked by the repetition check; across 6 calls, 4 wrote questions and 2 were rejected |
| Author confirmation & publication | **Done**: item-by-item confirmation, unconfirmed publication rejected, private by default, revoked content inaccessible |
| Reader update | **Done**: notification without refresh; "then / later" side-by-side view |
| Deletion & governance | **Done**: independent deletion credentials, revocation linkage |

**How we handle the "partial" item**: we do not raise the failure threshold, do not count repeated questions as success, allow manual completion to close the loop, and list interview stability as the top priority of the next iteration.

## 7.2 Engineering verification (states)

- Automated regression passes: **235 tests passed**, 1 skipped by default; type checks and first CI run pass
- The service is publicly reachable: HTTPS deployment with healthy certificate renewal; 20 read-only requests at concurrency 4 all returned 200, p95 189 ms
- Real service calls leave traces: the real model, vector service, and author-memory service have all been called in production
- Cross-role acceptance completes: three independent accounts completed the full reader / author / admin flows; 8 browser interactions passed
- Backups restore: a database backup restored to an isolated database; 28 tables readable
- Research exports are permission-graded: admins can export de-identified research data; unauthorized reads are rejected
- Engineering scale: 10 business modules, 65 commits (2026-09-12 16:16 — 2026-09-13 16:02), 15 UI reference screens and 10 visual assets

(Acceptance records and matrix: `docs/acceptance-matrix.md`; code: github.com/Normaluncle/AndThen.)

## 7.3 Timeline

| Time | Phase | Output |
| --- | --- | --- |
| Sep 12 AM | Problem definition & design | Product concept and core loop; PRD v1.1 (eight product decisions and data boundaries) |
| Sep 12 PM | Engineering baseline | Request contracts, auth model, DB migrations, task queue and workers |
| Sep 12 evening | Core modules | Identity & permissions, source import, reader follow-ups, manual review, interview & drafts, publish & notify, revoke & delete |
| Sep 13 | Reader survey | 27 submissions, 26 valid; three-type controlled experiment |
| Sep 13 | Author survey (round 1) | 3 samples; willingness and boundary data |
| Sep 13 | Frontend & visuals | 15 UI reference screens, 10 visual assets, acceptance matrix |
| Sep 13 | Cloud deployment & acceptance | HTTPS deployment; real model / vector / memory services connected; three-account cross-role acceptance |
| Sep 14 | Author survey (supplement) | 1 more sample; first coverage of an AI-skeptical user |

---

# 8. Business Value

## 8.1 Layer 1: Activating the stock content asset

Zhihu's most unique, hardest-to-replicate asset is a decade of real-life experience. These posts were complete when published; time made them half-told stories — readers finish and leave, authors finish and stop, the platform re-recommends the same batch.

"And Then?" attaches a "follow-up" to this content:

| Party | Value |
| --- | --- |
| Content ecosystem | One-off expression becomes an updatable storyline; long-tail content regains a lifecycle |
| Readers | From "reading one story" to "following one story," creating new revisit motives and reading time |
| Authors | Low-barrier closure for what they wrote years ago; quality authors' motivation is reactivated |
| Platform | Raising reuse of stock content without producing new content — the cheapest ecosystem gain |

This layer fits Zhihu best: the product doesn't build a new content pool — it uses Zhihu's existing Q&A assets with stable account attribution. Readers follow "people" and "experiences," which is exactly Zhihu's community structure.

## 8.2 Layer 2: Structured data that only this mechanism can produce

Every author-confirmed "Afterward" deposits one structured record:

```
What was said then · What happened after · How long the span
Did the judgment hold · Did the direction change · Was publication consented
```

The specialness of this data: **it exists only on the basis of the original author's voluntary confirmation — it is "authorized real outcomes," not model speculation or comment retelling.** Crawlers can't scrape it, summarizers can't generate it, Q&A models can't infer it — the answer lives only with the author, and appears only when they are willing.

Our own database answers not "what do people think" but "**what actually happened to people who did this**": when someone quits to start a business and succeeds, what feature set shows up? When they fail, what different combination appears? How do a career pivot, an industry judgment, or a long-term plan actually unfold across different time spans?

As samples accumulate, these features grow from cases into a searchable experience structure. Such conclusions have a **time moat**: they need real time spans, real author relationships, and real confirmation mechanisms — impossible to scrape once or replicate quickly. For Zhihu, this is a "lived outcomes" data asset layered on top of existing content.

## 8.3 Layer 3: Decision-scenario value, extended

| Party | Value |
| --- | --- |
| Readers | From "reading others' stories" to "finding what happened to people in situations like mine" — a reference for their own judgment |
| Content distribution | Follow-ups naturally form new content nodes, feeding topic operations and features |
| Community relations | Authors and readers move from one-off reading to long-term following, raising account stickiness and revisit motives |
| Farther out | At scale, structured life-trajectory data could support references for career choices, industry judgments, and long-term planning |

Zhihu's slogan is "Where there's a question, there's an answer." "And Then?" offers the next station — **not just the answer of the moment, but the answer time gives.**

The premise of this path is trust. The product's first principle is therefore not to collect more, but to keep authors in control — the first conclusion our research confirmed, and the only way data can keep accumulating.

---

# 9. Roadmap

After v1.0, the work proceeds in five stages. Each stage solves one main problem.

```text
Stage 1 a real pairing runs end-to-end → Stage 2 interview quality comparable → Stage 3 low-sensitivity domains open safely → Stage 4 more domains open → Stage 5 the experience structure becomes searchable
```

## Stage 1 — Real Pairing Validation: one real pairing runs end-to-end

**Problem to solve**

The cloud prototype's loop already runs, but whether "a real reader following a real author" holds in a natural setting has never been verified. Without this stage, every subsequent scale-up rests on an assumption.

**Key deliverables**

- Recruit 5–10 readers and 5–10 authors, stratified
- At least one real pairing with author confirmation
- Pairing process records and traceable negative feedback

**Stage acceptance**

- At least one real pairing completes the full "follow → revisit → publish the Afterward" flow
- The author can choose to publish or stay private, and the choice is respected
- Exit conditions can trigger: on privacy complaints, identity errors, or irrevocable content, pause immediately and return to the previous stage

## Stage 2 — Controlled Testing: interview quality and author burden become comparable

**Problem to solve**

AI dynamic interviews vs. fixed questionnaires have no same-source comparison yet; the current AI interview still has semantic repetition and premature wrap-up, which need a larger sample to verify and fix.

**Key deliverables**

- Scale to 50–100 readers and 10–15 authors
- Same-source blinded comparison of AI interviews vs. fixed questionnaires
- Interview stability fixes (AI five-question flow is the top priority of the next iteration)

**Stage acceptance**

- Interview quality and author burden both pass the comparison standard stably
- Samples can be separated by cohort; team, external participants, and test data never mix
- On exit conditions, pause and roll back to Stage 1

## Stage 3 — Small-Scale Launch: low-sensitivity domains open safely

**Problem to solve**

Content-safety and privacy review have only been verified in a controlled environment; review and revocation under real traffic have not been tested.

**Key deliverables**

- Open restricted low-sensitivity domains (learning, professional skills, project experiences)
- Keep manual review and wire it into the live flow
- Verify revocation and deletion in production

**Stage acceptance**

- Zero privacy complaints and zero identity errors during the open period
- The review flow can block non-compliant content
- Any published content can be revoked and becomes inaccessible immediately

## Stage 4 — Full Launch: more domains can open

**Problem to solve**

Follow, update-notification, and revocation mechanisms need verification at a larger scale and across more content domains.

**Key deliverables**

- Improve follow, update-notification, and revocation
- Open more content domains
- Operating records with zero privacy complaints and identity errors throughout

**Stage acceptance**

- Update notifications reach followers reliably
- Revocation takes effect immediately; historical content stays inaccessible
- Exit-condition monitoring stays effective: pause immediately on privacy complaints or identity errors

## Stage 5 — Data Asset Building: the experience structure becomes searchable

**Problem to solve**

Structured records need sample scale and time spans to form a searchable experience structure; feature operations alone cannot achieve it.

**Key deliverables**

- Continuous accumulation of structured "what was said / what happened / did the judgment hold" records
- A searchable experience structure

**Stage acceptance**

- Sample scale and time spans meet analysis requirements
- Conclusions can be presented as cases, never converting respondents' outcome ratios into anyone's personal success probability

**Every stage has exit conditions**: on privacy complaints, identity errors, or irrevocable content, pause immediately and return to the previous stage.

---

# 10. Beyond v1.0

v1.0 solves only "one real loop that runs, verifies, and demonstrates." The following are deliberately not part of v1.0:

| Future direction | Why not in v1.0 |
| --- | --- |
| Author-authorized personal answer scanning with batch revisit suggestions | Depends on the single loop being stable first; batching would amplify boundary and privacy risk — revisit after real-pairing validation |
| Shareable cards for authorized artifacts and richer edit history | Distribution enhancements; they don't block the core loop's validation |
| On-platform activity signals as auxiliary cues | Research proved narrative gaps, not popularity, trigger follow-ups; re-evaluate only at the auxiliary layer, never as a requirement |
| Income, illness, and life "win/loss" content | Ethical boundary; not used as a hook; excluded from pilots and launch |

v1.0's core principle:

```text
Run one loop steadily and honestly first, then talk scale and expansion.
```

---

# Appendix

## A. Glossary

| Term | Meaning |
| --- | --- |
| Time revisit (时间回访) | Interviewing the person behind a historical statement about what happened after, and linking the record |
| Time verification (时间验证) | Comparing the original statement with the later revisit; not an independent fact audit or causal proof |
| Original-author verification | Verifying account and material attribution; not verifying the person's life outcomes |
| Idempotent | Retrying the same operation never duplicates follows, publications, or notifications |
| Cohort | Research group labels separating team members, external participants, and test data |
| Denominator | The valid sample total behind a metric; different windows and recruitment channels must not mix |
| Degradation | When a dependency fails, a clearly bounded alternative path completes part of the task |
| Traceable | Every displayed fact can be traced to its source, version, permission, and confirmation record |

## B. Research Methodology

**Reader side**: three content types in a controlled design (contrast/judgment, emotional venting, evergreen knowledge); each respondent read 5 random posts and answered per post, plus an overall questionnaire. Distributed anonymously via an online survey platform.

**Author side**: targeted distribution covering both "published" and "never published" people, with open-ended and multi-select condition questions.

**Prototype validation**: a complete system deployed in the cloud; three independent accounts played reader, author, and admin roles to complete end-to-end operations, with acceptance records kept.

## C. Data Methodology Notes

- The reader sample is a convenience sample reached mainly through social channels, concentrated at ages 18–24; it cannot be extrapolated to the platform's whole user base or used to estimate platform-level conversion.
- Per-post exposure is a randomized subset; cross-post comparison should be read with caution; percentages use each question's valid response count (26); multi-select option shares sum to more than 100%.
- The author side is a qualitative sample for discovering concern boundaries and willingness structure — not for proportional conclusions.
- All willingness data is self-reported; real behavioral data is collected in later pilot stages.
- Until samples are sufficient, structured-database conclusions are presented as cases only, never converting respondents' outcome ratios into anyone's personal success probability.

## D. Product Details

### D.1 Brand Language

| Position | Fixed wording | Notes |
| --- | --- | --- |
| Official project name | **And Then? (然后呢?)** | Emphasizes that an old experience is still "unfinished, keep-asking" |
| Reader-side main button | **And Then?** | Clicking establishes a "following the follow-up" relationship |
| Author-side content name | **The "Afterward" (后来)** | The content object formed after the revisit — not a new question |
| Author-side main CTA | **Write Your Afterward** | A gentler invitation: "Would you like to tell what happened after?" |
| Content object | **An "Afterward"** | Linked to the original question, original answer, revisit time, and author confirmation state |
| Side-by-side display | **Then / Later (当时/后来)** | Used in confirmation pages, artifact pages, and demos |

### D.2 Page List

| Page | Primary information & main action |
| --- | --- |
| P01 Discover / Explain | Authorized old answers; product boundaries; enter detail |
| P02 Original answer & follow-ups | Source, version time, reader button "And Then?", existing "Afterwards" |
| P03 My follow-ups | Followed content, updates, unfollow |
| P04 Author workspace | Invitations, self-import, "Afterward" drafts, publication records |
| P05 Interview | Author-side title "Afterward", the original basis, one current question, input & skip |
| P06 Confirm & publish | Then/later side-by-side, fact sources, scope selection |
| P07 "Afterward" artifact | The author-confirmed "Afterward", source relationship, confirmation time |
| P08 Sources & research admin | Authorizations, verifications, invitations, research exports |

### D.3 Roles & Permissions

The system stores **login state, original-author association state, and content authorization state** separately. A successful login does not prove the account owns any pasted answer; holding an invitation link does not alone prove original authorship.

| Role | Can do | Cannot do |
| --- | --- | --- |
| Visitor | Browse public excerpts, try the public demo | View private interviews, publish follow-ups |
| Reader | Follow, unfollow, delete local data | See who declined a revisit, see other readers' identities |
| Verified original author | Accept/decline, correct, edit, confirm publication, revoke | Modify others' sources, let the AI sign the confirmation |
| Research/operations | Review sources, record invitations, process revocations | Browse private interviews without authorization, confirm facts on the author's behalf |
| System/AI | Extract, ask, generate structures pending confirmation | Contact anyone, authorize, or publish on its own |

### D.4 Data Model Essentials

| Entity | Key constraint |
| --- | --- |
| sources / source_snapshots | No publication without authorization; new snapshots never overwrite the historical original |
| consents | Recorded by purpose; revocations are traceable and trigger deletion |
| author_verifications | Weak evidence cannot mark an original author as verified |
| interests | Unique on reader_key × source_id |
| interview_sessions / messages | Session isolation; skips and interruptions are saved |
| followup_versions | Edits invalidate confirmation; every publication is traceable |
| ai_runs / research_events | No plaintext keys stored; research and business separated |

## E. Data Source Inventory

| File | Content | Notes |
| --- | --- | --- |
| `docs/research/384504415_按文本_知乎内容阅读体验调研_27_27.xlsx` | Reader survey raw export (27 submissions, 26 valid) | Survey-platform export; submitted 2026-09-13 16:32–20:57 |
| `docs/research/384504415_按序号_知乎内容阅读体验调研_27_27.xlsx` | Same, numerically encoded | For programmatic processing |
| `docs/research/384534175_按文本_知乎作者侧调查_3_3.xlsx` | Author survey round 1 (3 responses) | Submitted 2026-09-13 16:37–17:56 |
| `docs/research/384596728_按文本_知乎作者侧调查_1_1.xlsx` | Author survey supplement (1 response) | Submitted 2026-09-14 09:29 |
| `docs/research/调研数据汇总.md` | Reader-side per-post metrics and methodology notes | Consistent with Chapter 3 of this document |

The public versions are de-identified: respondent IP and source-detail columns were removed. All author quotes in Chapter 3 come from the open-ended questions of the author survey and are cited anonymously by sample number.

---

<div align="center">

**A reader asks "And then?" · An author writes their "Afterward."**

</div>
