# repo-tools

`repo-tools` is one command-line tool with three subcommands for TypeScript repositories:

| Subcommand | Job |
|---|---|
| `depgraph` | Writes the dependency graph and the architecture reports of a TypeScript tree. |
| `chunk` | Splits a large file into chunks, merges the chunks back, and shows which chunks changed. |
| `compress` | Writes a compact copy of a file for a model context, and restores it. |

Status: under construction. The CLI shell is available. The three subcommands are not built yet.

## Run

Run the tool from source with Bun:

```sh
bun install
bun src/bin.ts --help
```

## Develop

| Command | Job |
|---|---|
| `bun test` | Runs the unit tests. |
| `bun run typecheck` | Runs the TypeScript type check. |
| `bun run lint` | Runs the lint and format check. |
| `bun run build` | Writes the Node bundle `dist/cli.js`. |
| `bun run compile` | Writes the compiled executable for this platform into `bin/`. |
| `bun run smoke -- <command...>` | Runs the smoke test against one way to run the tool. |
| `bun run privacy` | Runs the privacy check on the tracked files and the commit messages. |
| `bun run hooks` | Installs the `commit-msg` hook that runs the privacy check on each message. |

## License

MIT. See `LICENSE`.
