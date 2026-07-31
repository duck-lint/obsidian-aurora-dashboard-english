# Dashboard

A calm, interactive home dashboard for Obsidian. Dashboard turns the current
vault into a practical overview of tasks, knowledge connections, writing
activity, note health, installed plugins, recent notes, and top-level folders.

This repository is an English-language fork maintained by `duck-lint`, with a
Nord-inspired visual language. All analysis runs locally inside Obsidian.

<img width="1260" height="1439" alt="image" src="https://github.com/user-attachments/assets/2280f644-e3e3-4db9-b90d-1aebdc7c392d" />

## What it shows

- Total Markdown notes and total readable word count.
- Notes with no resolved backlinks.
- Empty or very short notes, with a configurable word threshold.
- An editable Todo list sourced only from one explicitly configured Markdown file. It is empty by default.
- An animated 3D galaxy knowledge graph powered by Three.js/WebGL, with orbit controls, moving link particles, tooltips, and clickable notes.
- A horizontally scrollable, manually ordered list of installed plugin shortcuts.
- A 365-day writing activity heatmap.
- A 30-day added-word trend.
- Recently modified notes.
- Note and word totals for each top-level folder.
- Clickable details for every headline metric, issue, date, and folder.

Dashboard opens automatically when the workspace is ready. You can
choose whether it replaces the active tab or opens in a new tab.

## Metric definitions

| Metric | Definition |
| --- | --- |
| Notes | Included `.md` files in the current vault. |
| Total words | Readable CJK characters plus non-CJK word groups after common Markdown syntax, frontmatter, code fences, and comments are removed. |
| No backlinks | Included notes that are not targeted by any resolved link in Obsidian's metadata cache. |
| Empty or very short | Notes whose readable word count is at or below the configured threshold. The default is 10. |
| Open tasks | Unchecked Markdown task items matching `- [ ]` in the configured Todo file only. No task file is read until a path is configured. |
| Added words | Positive word-count deltas observed after the plugin starts tracking. Deletions do not reduce a day's total. |

Obsidian files do not contain an exact historical “words added per day” ledger.
For dates before installation, Dashboard can estimate activity by
grouping each note's current word count under its last-modified date. Estimated
cells use a subtle opacity difference and can be disabled in settings.

## Privacy and safety

- No analytics, network calls, accounts, or cloud service.
- Statistics and activity history stay in
  `.obsidian/plugins/aurora-dashboard/data.json`.
- The Todo module reads only the explicitly configured Markdown file and edits it only when you change or complete one of its tasks.
- Excluded folders and their descendants are omitted from every metric.

## Install

### Manual installation

1. Create `.obsidian/plugins/aurora-dashboard/` inside your vault.
2. Copy `main.js`, `manifest.json`, and `styles.css` into that folder.
3. Reload Obsidian.
4. Enable **Dashboard** under **Settings → Community plugins**.

### Community plugin directory

The upstream project documents Community Plugin submission, but this English
fork is not submitted to that directory. Use manual installation or the
workflow artifact described below.

## Commands

- **Dashboard: Open dashboard**
- **Dashboard: Refresh dashboard statistics**

The ribbon dashboard icon also opens the view.

The shortcut strip reads installed plugin manifests from the current vault.
Use its manage button to reorder, remove, or add entries. Selecting a shortcut
opens that plugin's Obsidian detail page through the official `show-plugin` URI.

The 3D graph renderer uses the MIT-licensed
[`3d-force-graph`](https://github.com/vasturiano/3d-force-graph) project and
Three.js. Reduced-motion system preferences disable continuous star and link
particle animation.

## Settings

- Optional greeting name.
- Open on startup.
- Replace the active tab or open a new tab.
- Todo Markdown file path (empty by default).
- Empty/short-note threshold.
- Excluded folders.
- Show or hide estimated pre-install history.
- Activity calendar range: 90, 180, or 365 days.

## Development

Requirements: Node.js 22 and npm.

```bash
npm install
npm run dev
```

Run the complete verification suite:

```bash
npm run check
```

This runs ESLint, Vitest, TypeScript type-checking, and the production esbuild
bundle, plus the scoped untranslated-interface check.

The GitHub Actions workflow runs the same checks on pull requests and pushes to
`main` using Node.js 22. It uploads exactly `main.js`, `manifest.json`, and
`styles.css` as the `dashboard-english-build` artifact.

## Release

1. Update `manifest.json`, `package.json`, `versions.json`, and
   `CHANGELOG.md`.
2. Run `npm run check`.
3. Commit the source and metadata changes. `main.js` is generated during the
   release workflow and is intentionally ignored by Git.
4. Push a Git tag exactly equal to the manifest version, without a `v` prefix.
5. The included GitHub Action publishes `main.js`, `manifest.json`, and
   `styles.css` as release assets.

This fork is not an official upstream translation. It preserves the original
plugin ID, settings keys, saved-data schema, view type, command IDs, CSS class
names, vault statistics, activity history, and minimum Obsidian version.

Upstream project: [tianxiangyu0717-hub/obsidian-aurora-dashboard](https://github.com/tianxiangyu0717-hub/obsidian-aurora-dashboard)

English fork: [duck-lint/obsidian-aurora-dashboard](https://github.com/duck-lint/obsidian-aurora-dashboard-english)

## Compatibility

`minAppVersion` is `1.8.7`. The plugin does not use Node or Electron APIs and
includes narrow-view responsive styles. Hands-on QA currently covers Obsidian
1.13.4 on macOS.

## Design reference

The color system and restrained dark surfaces are inspired by
[insanum/obsidian_nord](https://github.com/insanum/obsidian_nord). Dashboard is
an independent plugin and does not include code or assets from
that theme.

## License

[MIT](LICENSE). Original project and author attribution are preserved.
