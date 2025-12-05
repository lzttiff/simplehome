## Local / Ignored files (short guide)

This project intentionally ignores a few local/generated files that are useful during development but must not be committed or published.

Ignored files (present in this repo's `.gitignore`):

- `gemini.key` — local AI key used for testing with Gemini. Keep this private. Do not commit.
- `data/debug-client.log` — client debug logs captured during local development.
- `data/storage.json` — local file-based storage used by the development server.

Why they're ignored
- These files contain either secrets (API keys) or local runtime data that shouldn't be checked into version control. Ignoring them prevents accidental exposure and reduces noise in commits.

If a key was exposed
- If `gemini.key` or any secret was ever pushed to a remote (public or shared), rotate the key immediately (regenerate on the provider side) and update any CI/secret stores that used it.
- If you need help scrubbing a pushed secret from Git history, I can prepare steps using `git filter-repo` or the BFG Repo-Cleaner — note that rewriting history requires coordination and force-pushing.

How to check local status

```bash
# show ignored but present files
ls -la gemini.key data/debug-client.log data/storage.json

# confirm they are not tracked
git ls-files --error-unmatch gemini.key || echo "gemini.key: not tracked"
git ls-files --error-unmatch data/debug-client.log || echo "data/debug-client.log: not tracked"
git ls-files --error-unmatch data/storage.json || echo "data/storage.json: not tracked"
```

How to re-add a file intentionally

If you intentionally want to add any of these files to the repository (not recommended):

```bash
# remove the matching .gitignore pattern first, or force-add
git add -f gemini.key
git commit -m "chore: add gemini.key (intentional)"
```

Recommended next steps

- Keep secrets out of the repo; use environment variables or a secret manager for CI.
- If you're unsure whether a secret was pushed earlier, tell me and I will scan recent commits for those filenames and help you decide whether to rotate keys or scrub history.

---
Short and to the point — if you'd like I can also add a small `docs/SECURITY.md` with recommended secret-management policies.
