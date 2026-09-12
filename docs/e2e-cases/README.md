# End-to-end cases

One file per story, named for its issue number: `13.md` holds the cases for
issue #13. `e2e-tester` reads every file here and runs the cases whose
precondition the current tree satisfies.

The files are written by `test-case-generator` from the story's acceptance
criteria, never from the implementation. A case derived from the code asserts
what was built and passes by construction; a case derived from the story can
fail, which is the only reason it exists.

One file per story rather than one shared catalogue, because six parallel pull
requests appending to one markdown file conflicted six times in a single day on
this repository. Two stories never touch the same file here.

Ids are permanent. A reworded criterion keeps its id, and a deleted one retires
it rather than freeing it for reuse, so a report line from an old run still
means something.

Ids follow the order the criteria appear in the story, so they are stable. The
order cases run in is a separate thing: cheapest first, so a run fails early.
The file says both, and they do not have to agree.
