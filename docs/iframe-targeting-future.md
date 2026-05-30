# Iframe Targeting Future Work

First-class iframe targeting is outside the command contract. Page commands execute in the resolved tab's main frame, while `snapshot` and `frame` expose iframe diagnostics only.

A future iframe feature needs one protocol-level frame target model shared by CLI parsing, content-script routing, ref lifetimes, partial failure reporting, and browser permission errors. It should cover same-origin and cross-origin frames without changing the existing main-frame defaults.
