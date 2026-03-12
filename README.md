# rundown

rundown is a markdown editor that can run code snippets!


https://github.com/user-attachments/assets/2d66b4cc-62f7-403a-ac37-fffb8dc080c3


## Usage

```sh
echo hello
```

output:

```output
hello
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
2026-03-12T20:41:38.154Z
```

When you run it, its output gets appended below the code snippet. If you run it
again, it gets replaced.

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

| Language tag       | Interpreter required |
| ------------------ | -------------------- |
| `js`, `javascript` | `deno`               |
| `ts`, `typescript` | `deno`               |
| `python`, `py`     | `python3`            |
| `bash`             | `bash`               |
| `sh`               | `sh`                 |
| `ruby`             | `ruby`               |
