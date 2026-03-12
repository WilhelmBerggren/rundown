# rundown
rundown turns your markdown file into a notebook

## Usage

```sh
echo hello there
```

output:
```output
hello there
```

```sh
rundown <file.md>
rundown <file.md> --port 8080
rundown <file.md> --no-open
```

## Examples

```js
console.log(new Date());
```

output:
```output
2026-03-12T20:36:31.235Z
```

When you run it, its output gets appended below the code snippet. If you run it again, it gets replaced.

## Installation


```sh
brew install deno
```

```sh
# Install from source (requires Deno)
deno compile --allow-read --allow-write --allow-net --allow-run \
  --output rundown \
  src/main.ts
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
