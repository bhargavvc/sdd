# Syncing with Upstream SDD

When sdd-build/sdd-2 releases new versions, sync like this:

## Steps

```bash
# 1. Fetch upstream changes
git fetch upstream

# 2. Switch to upstream-sync branch (keeps clean SDD code)
git checkout upstream-sync
git merge upstream/main

# 3. Switch to main (your SDD-branded branch)
git checkout main
git merge upstream-sync

# 4. Re-run the rename script to rebrand new code
bash scripts/rename-to-sdd.sh

# 5. Resolve any conflicts, test, commit
git add -A
git commit -m "sync: merge upstream sdd-2 vX.Y.Z + rebrand"
git push origin main
```

## Remotes

| Remote | URL | Purpose |
|--------|-----|---------|
| origin | https://github.com/bhargavvc/sdd.git | Your fork (SDD-branded) |
| upstream | https://github.com/sdd-build/sdd-2.git | Original SDD repo |

## Branches

| Branch | Purpose |
|--------|---------|
| main | SDD-branded code (what your team uses) |
| upstream-sync | Clean SDD code from upstream (merge target) |
