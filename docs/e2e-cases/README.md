# End-to-end cases

These files are what `e2e-tester` runs, and they are written from the case
study, not from the code and not from the technical issues.

One file per **user journey**, named for the person and what they are doing:

| File                                | Who                          | Case study section |
| ----------------------------------- | ---------------------------- | ------------------ |
| `vendor-sends-the-weekly-file.md`   | the vendor                   | Scenario A         |
| `staff-runs-a-promotion.md`         | ModaCo staff                 | 1 and 2            |
| `shopper-browses-the-storefront.md` | the shopper                  | 2                  |
| `staff-runs-a-flash-sale.md`        | ModaCo staff and the shopper | Scenario B         |
| `operator-watches-the-alerts.md`    | the operator                 | none - see below   |

Each file holds that journey's **user stories** ("as a …, I want …, so that …"),
each with acceptance criteria and test cases. Stories are tested; tasks are
not. A story is something a person gets out of the system. A task — a compose
file, a queue, a migration — is how we build it, and it has no test case here:
the system does not come up without it, and that is the whole test. The three
files this directory briefly held for issues #4, #7 and #8 were tasks dressed
as stories, every case a probe with nobody in it, and they are gone.

The persona is never invented. The case study names the vendor and the
storefront; the internal API user it does not name, so that one is "ModaCo
staff" and nothing more specific.

The operator is the one exception, added by the owner on 2026-09-14. The case
study does not name that persona and these cases do not claim it does. They are
here because a rule that has never fired is indistinguishable from a system that
is never in trouble, and firing them is how the one defect in the alerting was
found - a paged summary that read "1.005081968451019 categories".

Case ids are `<journey>-<n>` and are permanent. A reworded case keeps its id and
a deleted one retires it, so a report line from an old run still points at
something. Cases run cheapest first within a story.

`test-case-generator` keeps these files current: when a pull request advances a
story, it marks which preconditions the tree now satisfies and adds cases only
where the story gained a criterion. It reads the story, never the diff.
