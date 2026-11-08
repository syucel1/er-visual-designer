# UI mockups — choose a direction

Open **`index.html`** to compare the three options side by side. Each option is one self-contained, interactive HTML file with no build step or server, so you can double-click it to open it in a browser.

| Option | File | Look | Editor placement |
|---|---|---|---|
| A — Aurora Glass | `option-a-aurora-glass.html` | Dark, frosted glass over a violet→cyan aurora | Docked right panel |
| B — Sunrise Studio | `option-b-sunrise-studio.html` | Light IDE layout, coral→magenta→violet gradient | Docked right panel |
| C — Neon Flow | `option-c-neon-flow.html` | Compact dark pro tool, teal→lime neon, icon rail | Pops out next to the selected table |

All three share the same behaviour:

- **Left panel:** a palette you drag **Table**, **View** and **Relationship** onto the canvas from, plus an explorer with a filter.
- **Canvas:** drag tables by their header. Drag a column's ● dot onto another table's column to create a foreign key. Double-click empty space to add a table.
- **Table editor:** column name, database-specific type (grouped), size or precision/scale, PK / NN / auto-increment toggles, default value, and add or delete columns.
- **Database dropdown:** PostgreSQL 16, MySQL 8.4, SQL Server 2022, Oracle 23ai or SQLite 3. Switching converts column types and changes the validation rules.
- **Bottom panel → Problems:** errors, warnings and info, with filters. Click a row to jump to the element; **⚡** applies a quick fix.
- **Bottom panel → DDL:** generate and review syntax-highlighted DDL for the chosen database, with *DROP IF EXISTS* and *quote all* options, copy, and download `.sql`.
- Undo/redo (Ctrl+Z / Ctrl+Y), Delete, Esc. Responsive layouts for tablet and phone: drawer, bottom sheet and floating add button.

`screenshots/` contains desktop, DDL and mobile captures of each option.

These are UX prototypes for choosing a visual direction. The production app will be built as described in `../ER-Visual-Designer-Design.pdf` and `../ROADMAP.md`.
