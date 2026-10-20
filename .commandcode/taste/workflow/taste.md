# Workflow & Tooling

## Block/plugin authoring
- For a block with a fixed set of modes/operations, wants the operation exposed as a `select` param (enumerated dropdown) rather than a free-text string the user has to type. Confidence: 0.75
- Prefers minimal, pragmatic MVP scope: accepts plain string params for connection details (bucket URL, secrets) "for now" instead of building richer abstractions; iteration can come later. Confidence: 0.55
- When asking for a new feature block, expects it scaffolded into the repo's own demo plugin source folder using the project's CLI/scaffold rather than hand-created files. Confidence: 0.6
