---
description: Automated Git workflow for creating PRs, auto-merging, and syncing forks/local repos.
---

# Git PR & Repo Sync Workflow

This workflow is meant to be used by the agent to automate the finalization of a task: committing, pushing, opening a PR to the upstream repository, auto-merging it, and keeping the user's fork and local repository perfectly synced.

## When to use
Trigger this workflow when a user requests to push their code, open a PR, merge it, and sync their repositories. 

## Prerequisites
- The agent must be in a feature branch (not `main`).
- GitHub CLI (`gh`) must be installed and authenticated (`gh auth status`).

## Step-by-Step Instructions

1. **Commit Changes**
   - Stage the relevant files: `git add <files>`
   - Commit with a descriptive message: `git commit -m "fix/feat: descriptive message"`
   - Wait for any pre-commit hooks to finish successfully.

2. **Push the Feature Branch**
   - Push to the user's origin fork: `git push -u origin <branch-name>`

3. **Create the Pull Request**
   - Create a PR against the upstream repository (e.g., `Fluxify-rest/Fluxify`).
   - Run: `gh pr create --repo <upstream-repo> --head <username>:<branch-name> --title "<Title>" --body "<Body>"`

4. **Enable Auto-Merge / Wait for Checks**
   - Enable auto-merge so the PR merges immediately upon CI passing (if applicable):
     `gh pr merge <pr-number> --repo <upstream-repo> --merge --auto --delete-branch`
   - You can also view the status using `gh pr view <pr-number> --repo <upstream-repo>`. Ensure it says `state: MERGED` or auto-merge is active.

5. **Sync the Forked Repository**
   - Once the PR is merged upstream, update the user's remote fork's main branch:
     `gh repo sync <username>/<repo-name> -b main`

6. **Sync the Local Repository**
   - Switch back to main locally: `git checkout main`
   - Pull the updated changes from the remote fork: `git pull origin main`

7. **Clean Up Local Environment**
   - Delete the temporary local feature branch: `git branch -D <branch-name>`

You are now successfully synced with the upstream `main` branch, and the temporary feature branches have been securely disposed of!
