# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in the quarto-dbml repository.

# Quarto Extension: quarto-dbml

quarto-dbml is a Quarto extension for rendering DBML (Database Markup Language) diagrams. Functionally, this means users can add DBML code blocks to their Quarto documents and create entity relationship diagrams that can be rendered in either static forms (for PDF) or interactive ones (for HTML). This extension should have full DBML feature support, including native DBML rendering. 

## Project Structure

- `_extension/`: Where the extension lives (output)
- `example/`: Contains `example.qmd` for testing
- `index.qmd`: Documentation/demo file
- `dbml.lua`: The core filter logic
- `_extension.yml`: Extension metadata

## Core Commands

- **Render Example:** `quarto render example/`
- **Install Local:** `quarto install extension .`
- **Remove Local:** `quarto uninstall extension .`

## Guidelines

- **Lua Logic:** Use `pandoc.List` and `pandoc.Elements` effectively.
- **YAML Formatting:** Follow the structure of `_extension.yml` for configuration.
- **Testing:** Always create a Minimal Working Example (MWE) in `example/` to test new features.
- **Documentation:** Update `README.md` if changing user-facing syntax.

## Technical Requirements

- **Quarto Version:** 1.4+
- **Languages:** DBML, Lua, YAML, Markdown
