<!-- repo-map:no-verification -->
<!-- GENERATED FILE -- do not edit by hand.
     Regenerate with `repo-tools map`. -->

# Test Coverage Analysis

## Summary

| Metric | Count |
|--------|-------|
| Total Source Files | 15 |
| Total Test Files | 2 |
| Source Files with Tests | 6 |
| Source Files without Tests | 9 |
| Coverage (raw, direct-import) | **40.0%** |
---

## Source Files Without Test Coverage

The following 9 source files are not directly imported by any test file:

### Z/

- `src/Z/loop.ts` → Expected test: `tests/unit/Z/loop.test.ts`

### root/

- `src/_x.ts` → Expected test: `tests/unit/root/_x.test.ts`
- `src/cli.ts` → Expected test: `tests/unit/root/cli.test.ts`
- `src/dyn.ts` → Expected test: `tests/unit/root/dyn.test.ts`
- `src/orphan.ts` → Expected test: `tests/unit/root/orphan.test.ts`
- `src/ping.ts` → Expected test: `tests/unit/root/ping.test.ts`
- `src/pong.ts` → Expected test: `tests/unit/root/pong.test.ts`
- `src/register.ts` → Expected test: `tests/unit/root/register.test.ts`

### util/

- `src/util/index.ts` → Expected test: `tests/unit/util/index.test.ts`

---

## Source Files With Test Coverage

| Source File | Test Files |
|-------------|------------|
| `src/B.ts` | `barrel.test.ts` |
| `Z/index.ts` | `barrel.test.ts` |
| `Z/zed.ts` | `barrel.test.ts` |
| `src/a.ts` | `a.test.ts`, `barrel.test.ts` |
| `src/index.ts` | `barrel.test.ts` |
| `src/view.tsx` | `barrel.test.ts` |

---

## Test File Details

| Test File | Imports from Source |
|-----------|---------------------|
| `tests/a.test.ts` | 1 files |
| `tests/barrel.test.ts` | 6 files |
