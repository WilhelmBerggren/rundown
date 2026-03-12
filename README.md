# rundoc

rundoc makes your code snippets runnable. It is a lightweight alternative to a jupyter notebook.

Try it with this command:
```sh
rundoc README.md
```

It should show a rendered markdown page, with a "run" button below code snippets like this one:

```js
console.log(new Date());
```

```output
2026-03-12T15:12:42.854Z
```

When you run it, its output gets appended below the code snippet. If you run it again, it gets replaced.

## Installation

```sh
# Install from source (requires Deno)
deno compile --allow-read --allow-write --allow-net --allow-run \
  --output rundoc \
  src/main.ts
```

## Usage

```sh
rundoc <file.md>
rundoc <file.md> --port 8080
rundoc <file.md> --no-open
```

## Supported languages

| Language tag | Interpreter required |
|---|---|
| `js`, `javascript` | `deno` |
| `ts`, `typescript` | `deno` |
| `python`, `py` | `python3` |
| `bash` | `bash` |
| `sh` | `sh` |
| `ruby` | `ruby` |
