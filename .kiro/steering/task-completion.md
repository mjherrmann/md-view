---
inclusion: always
---

# Task Completion Gate

A task is NOT complete until all of the following pass without warnings or errors:

1. `npm run lint`
2. `npm run build`
3. `npm run test`

## Additional requirements

- Test coverage must cover 100% of branched code paths.
- No orphaned/dead code left in the codebase after implementation.
- Run all three checks after every meaningful code change, not only at the end.
