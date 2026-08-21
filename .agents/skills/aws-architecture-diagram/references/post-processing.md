# Post-Processing Pipeline

Run deterministic fixers and validation through the project-local cross-platform wrapper:

```bash
mise exec -- uv run ./.agents/skills/aws-architecture-diagram/scripts/validate_drawio_bundle.py ./docs/<filename>.drawio
```

The wrapper uses an isolated `uv` environment declared in the script, so it does not add `defusedxml` to the inference service or the global Python environment. It runs these fixers in order:

1. **fix_nesting.py** — Sets Region `container=0`, re-parents children to root
2. **fix_icon_colors.py** — Corrects service icon fillColor to match category
3. **fix_step_badges.py** — Nudges overlapping step badges apart
4. **fix_placement** — Moves external actors below the title block (y >= 140)
5. **fix_legend_size** — Resizes the legend panel to match diagram height

All upstream scripts are vendored in `scripts/lib/`. The pipeline is orchestrated by `scripts/lib/post_process_drawio.py`, then `scripts/lib/validate_drawio.py` validates the result, and `scripts/lib/drawio_url.py` prints a preview URL.

The upstream Claude PostToolUse hook is intentionally not registered in this Codex project. Run the wrapper explicitly after every generated or updated `.drawio` file.