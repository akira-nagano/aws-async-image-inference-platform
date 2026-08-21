# Upstream provenance

- Source: `https://github.com/awslabs/agent-plugins`
- Component: `plugins/deploy-on-aws/skills/aws-architecture-diagram`
- Revision: `bc78579b3d65d590de8a3f3abef4b23e72ff9e59`
- License: Apache-2.0; see `LICENSE` and `NOTICE`.

The Skill and references were installed with Codex's `skill-installer`.
The official `plugins/deploy-on-aws/scripts` directory is vendored under
`scripts/` because validation and preview generation are part of the Skill's
quality contract.

This project does not register the upstream Claude-specific PostToolUse hook.
Instead, `scripts/validate_drawio_bundle.py` provides a cross-platform,
explicit validation command and obtains `defusedxml` in an isolated `uv`
environment.

The four upstream post-processing modules that annotate
`defusedxml.ElementTree.ElementTree` enable postponed annotation evaluation for
Python compatibility. Their processing logic is otherwise unchanged.
The dynamic sibling-module loader also registers modules in `sys.modules`
before execution so dataclasses work on Python 3.12, and removes the entry if
module execution fails.