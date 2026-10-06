# Writing and updating the docs

> Who this is for: anyone changing behavior or writing a docs page. You will know where a change belongs, which page to update, and the style rules.

The docs are written for people deciding whether and how to use Taskbay, not for the maintainers. The older planning documents (specs, phase plans, decision records, evidence logs) are kept in `docs/archive/`. They are history, not the current truth. The code is the final authority; if a page and the code disagree, fix the page.

## Structure

Each page answers one reader question. Do not mix purposes.

| Folder | Question it answers |
| --- | --- |
| `README.md`, `docs/quickstart.md` | Is this useful to me? Can I make it work? |
| `docs/concepts/` | How does it work, and why? |
| `docs/guides/` | How do I do a specific task? |
| `docs/reference/` | What exactly are the names, defaults and shapes? Exhaustive. |
| `docs/operations/` | How do I run it and fix it? |
| `docs/security/` | What is protected, and what is not? |
| `docs/project/` | How mature is it? |
| `docs/contributing/` | How do I change it? |

Start with `docs/README.md`, which indexes the pages by question.

## When you change code, update this page

| You changed | Update |
| --- | --- |
| An environment variable or default | `docs/reference/configuration.md` |
| A CLI, npm script or flag | `docs/reference/cli.md` |
| An API route, request or error | `docs/reference/http-api.md` |
| An extension or media type | the matching page under `docs/reference/extensions/` |
| A table, column or invariant | `docs/reference/data-model.md` |
| Sign-in, roles, grants | `docs/guides/sign-in-and-roles.md`, `docs/concepts/identity-and-access.md` |
| Credentials, outbound network rules | `docs/guides/agent-credentials.md`, `docs/security/service-identity.md`, `docs/security/threat-model.md` |
| Something maturity-related (a limit lifted, a feature added) | `docs/project/status-and-roadmap.md`, `docs/reference/compatibility.md` |
| User-visible behavior | `CHANGELOG.md` |

A pull request that changes behavior and no page should say why in its description.

## Style rules

1. One H1 per file. Put a one-line "who this is for and what you will have" quote at the top.
2. Back a claim with something the reader can run, or link to the code or test that shows it. No numbers without a reproducible source in the repository.
3. State limits early: what Taskbay supplies, what the agent or operator must supply, what is experimental, what is unsupported.
4. Show failure paths: for each procedure, what failing looks like and how to diagnose it.
5. Be precise: defaults, units, ranges, error shapes, who is authorized. Tables for reference; prose for concepts.
6. Tone: plain, short sentences, active voice. No marketing words.
7. Do not describe internal process (phases, slices, requirement IDs, "spec-driven"). If a decision needs a rationale, write it in the page and link a decision record from `docs/archive/adr/` at most once, under "Further reading".
8. Say the project is pre-1.0 where it matters.
9. Keep real names: environment variables keep the `A2A_` prefix; document identifiers as the code uses them.
10. Code blocks are fenced and tagged (`bash`, `json`, `ts`, `text`, `mermaid`). Commands are copy-pasteable, one per block, without a `$` prompt. Include only commands you have verified exist, and expected output only if you ran it.
11. End each page with 2 to 5 "Related" links.
12. Use relative links, and make sure each resolves.

Guides and concept pages follow this shape: title, one-line audience, short intro, "Before you start", steps, "When it fails", "Limits", "Related".

## Checking links

There is no link checker script in the repository. Before opening a pull request, check that relative links in the files you touched resolve. This one-liner prints broken relative Markdown links:

```bash
node -e "const fs=require('fs'),p=require('path');const walk=d=>fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>e.isDirectory()?(e.name==='node_modules'||e.name==='.next'||e.name==='.git'?[]:walk(p.join(d,e.name))):e.name.endsWith('.md')?[p.join(d,e.name)]:[]);for(const f of walk('.')){const t=fs.readFileSync(f,'utf8').replace(/\`\`\`[\s\S]*?\`\`\`/g,'');for(const m of t.matchAll(/\]\(([^)#\s]+)(#[^)]*)?\)/g)){const l=m[1];if(/^[a-z]+:/.test(l))continue;if(!fs.existsSync(p.join(p.dirname(f),l)))console.log(f+': '+l)}}"
```

## Related

- [Development setup](development.md)
- [CONTRIBUTING.md](../../CONTRIBUTING.md)
