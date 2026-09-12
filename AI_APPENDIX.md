# Form 5 — AI Appendix

> Mandatory attachment for the case study submission. Maintained continuously
> throughout development, not written at the end.

## 1. Tool Manifest

All AI models and tools used, with versions where applicable.

| Model / Tool | Primary Purpose of Use | Effectiveness (1-5) & Brief Why |
| --- | --- | --- |
| Claude Code (Claude Opus 5) | Repository scaffolding, CI and quality-gate setup, TDD implementation, documentation | _To be filled in_ |
| Claude Code Action (Claude Opus 5) | Advisory automated code review on every pull request | _To be filled in_ |

## 2. AI Tool Usage Approach

Workflow, prompting strategy and human refinement per phase. Summaries only, no raw outputs.

| Phase / Specific Task | Prompting Strategy & Context Provided | Human Refinement (How did you edit or iterate?) |
| --- | --- | --- |
| Project infrastructure | Gave the full case study PDF plus explicit process constraints: TypeScript, TDD, Conventional Commits, PR-only changes, SonarCloud quality gate, advisory AI review. Asked for a design first, approved it, then had the work split across parallel agents. | _To be filled in_ |
| _To be filled in_ | | |
| _To be filled in_ | | |

## 3. Judgement, Challenges & Verification

How the limitations of the AI were handled.

| Challenge Encountered | Judgement / Verification (How did you fact-check?) | Resolution (How did you fix the issue?) |
| --- | --- | --- |
| _To be filled in_ | | |
| _To be filled in_ | | |

Record here especially the biggest architectural or logical mistake found in AI
output for Scenario A (bulk ingestion under serverless constraints) or
Scenario B (flash-sale read/write load), and how the design was steered away
from it.

## 4. Overall Reflection

**Estimated Ratio:** _To be filled in_ (e.g. 30% AI / 70% human)

**Key Takeaway:** _To be filled in_ — notable blind spots revealed in the tools,
and whether using AI significantly altered the original approach.
