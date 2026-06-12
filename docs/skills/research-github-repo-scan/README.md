# research-github-repo-scan (global Roo skill template)

Copy the sibling `SKILL.md` into your global Roo skills directory so it becomes discoverable:

## Destination
- `~/.roo/skills/research-github-repo-scan/SKILL.md`

## Source (in this repo)
- `docs/skills/research-github-repo-scan/SKILL.md`

## What the skill does
This skill instructs SuperRoo to research and implement the correct workflow for:
- taking a **GitHub repo URL** (from a VSCode/cross-extension UI),
- producing a local workspace materialization step (clone/fetch/safe checkout strategy),
- then running the existing local `repo-scanner` / project-context loader.

It explicitly avoids assuming the repo scanner itself can do GitHub API scans end-to-end without having files locally.
