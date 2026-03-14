import re
import subprocess
import sys
import threading
import time
import os
from http.server import BaseHTTPRequestHandler
from pathlib import Path

SHELL_LANGS = {'sh', 'bash', 'shell'}
TIMEOUT = 30

# Matches ```sh / ```bash / ```shell fences (non-greedy, dotall)
_SHELL_RE = re.compile(r'```(?:sh|bash|shell)\n.*?```', re.DOTALL)
# Matches an output fence (with optional preceding blank line) immediately following a shell fence
_OUTPUT_AFTER_RE = re.compile(r'\n\n?```output\n.*?```', re.DOTALL)


def find_shell_blocks(content: str) -> list:
    """Return a list of re.Match objects for every shell fence in content.

    Output fences (```output) are excluded from the results and from the
    index count — they are invisible to the caller.
    """
    return list(_SHELL_RE.finditer(content))


def update_output_block(content: str, n: int, output_text: str) -> str:
    """Insert or replace the output fence after the Nth shell block (0-indexed)."""
    blocks = find_shell_blocks(content)
    if n >= len(blocks):
        raise ValueError(f'No shell block at index {n} (found {len(blocks)})')
    block = blocks[n]
    after = content[block.end():]
    new_output = f'\n\n```output\n{output_text}\n```'
    m = _OUTPUT_AFTER_RE.match(after)
    if m:
        return content[:block.end()] + new_output + after[m.end():]
    else:
        return content[:block.end()] + new_output + after


# ── Global state ──────────────────────────────────────────────────────────────
_md_path: Path = None          # set in __main__
_suppress = False              # True while server is writing the file
_sse_clients: list = []        # list of wfile objects waiting for events
_last_mtime: float = 0.0
_lock = threading.Lock()       # guards _suppress and _sse_clients mutations


# ── Request handler ───────────────────────────────────────────────────────────
class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass  # suppress default access log

    # ── helpers ───────────────────────────────────────────────────────────────
    def _send(self, code: int, ctype: str, body: bytes):
        self.send_response(code)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_body(self) -> bytes:
        length = int(self.headers.get('Content-Length', 0))
        return self.rfile.read(length) if length else b''

    def _parse_form(self) -> dict:
        from urllib.parse import parse_qs
        raw = self._read_body()
        parsed = parse_qs(raw.decode())
        return {k: v[0] for k, v in parsed.items()}

    # ── GET / ─────────────────────────────────────────────────────────────────
    def _get_root(self):
        html_path = Path(__file__).parent / 'index.html'
        body = html_path.read_bytes()
        self._send(200, 'text/html; charset=utf-8', body)

    # ── GET /content ──────────────────────────────────────────────────────────
    def _get_content(self):
        body = _md_path.read_text().encode()
        self._send(200, 'text/plain; charset=utf-8', body)

    # ── GET /events ───────────────────────────────────────────────────────────
    def _get_events(self):
        self.send_response(200)
        self.send_header('Content-Type', 'text/event-stream')
        self.send_header('Cache-Control', 'no-cache')
        self.end_headers()
        with _lock:
            _sse_clients.append(self.wfile)
        try:
            # Keep the connection alive with periodic pings; detect disconnect
            # on write failure (BrokenPipeError / OSError).
            while True:
                time.sleep(1)
                self.wfile.write(b': ping\n\n')
                self.wfile.flush()
        except (BrokenPipeError, OSError):
            pass
        finally:
            with _lock:
                if self.wfile in _sse_clients:
                    _sse_clients.remove(self.wfile)

    # ── POST /run ─────────────────────────────────────────────────────────────
    def _post_run(self):
        form = self._parse_form()
        try:
            n = int(form['index'])
        except (KeyError, ValueError):
            self._send(400, 'text/plain', b'Missing or invalid index')
            return

        content = _md_path.read_text()
        blocks = find_shell_blocks(content)
        if n >= len(blocks):
            self._send(400, 'text/plain', f'No block at index {n}'.encode())
            return

        code = blocks[n].group()
        # Strip the fence lines, keep only the code body
        code_body = '\n'.join(code.splitlines()[1:-1])

        try:
            proc = subprocess.run(
                ['sh', '-c', code_body],
                capture_output=True, text=True, timeout=TIMEOUT
            )
            output = (proc.stdout + proc.stderr).rstrip()
        except subprocess.TimeoutExpired:
            output = f'Error: timed out after {TIMEOUT}s'

        updated = update_output_block(content, n, output)
        with _lock:
            global _suppress
            _suppress = True
        try:
            _md_path.write_text(updated)
        finally:
            with _lock:
                _suppress = False

        self._send(200, 'text/plain; charset=utf-8', output.encode())

    # ── POST /save ────────────────────────────────────────────────────────────
    def _post_save(self):
        body = self._read_body().decode()
        with _lock:
            global _suppress
            _suppress = True
        try:
            _md_path.write_text(body)
        finally:
            with _lock:
                _suppress = False
        self._send(200, 'text/plain', b'ok')

    # ── dispatch ──────────────────────────────────────────────────────────────
    def do_GET(self):
        if self.path == '/':
            self._get_root()
        elif self.path == '/content':
            self._get_content()
        elif self.path == '/events':
            self._get_events()
        else:
            self._send(404, 'text/plain', b'Not found')

    def do_POST(self):
        if self.path == '/run':
            self._post_run()
        elif self.path == '/save':
            self._post_save()
        else:
            self._send(404, 'text/plain', b'Not found')


# ── File watcher ──────────────────────────────────────────────────────────────
def _watch():
    global _last_mtime
    _last_mtime = _md_path.stat().st_mtime
    while True:
        time.sleep(1)
        try:
            mtime = _md_path.stat().st_mtime
        except FileNotFoundError:
            continue
        if mtime != _last_mtime:
            _last_mtime = mtime
            with _lock:
                if _suppress:
                    continue
                clients = list(_sse_clients)
            dead = []
            for wfile in clients:
                try:
                    wfile.write(b'data: change\n\n')
                    wfile.flush()
                except (BrokenPipeError, OSError):
                    dead.append(wfile)
            if dead:
                with _lock:
                    for d in dead:
                        if d in _sse_clients:
                            _sse_clients.remove(d)


# ── Entry point ───────────────────────────────────────────────────────────────
if __name__ == '__main__':
    from http.server import ThreadingHTTPServer
    if len(sys.argv) < 2:
        print('Usage: python3 server.py <file.md>', file=sys.stderr)
        sys.exit(1)
    _md_path = Path(sys.argv[1])
    if not _md_path.exists():
        _md_path.write_text(f'# {_md_path.stem}\n')
    print(f'Serving {_md_path} at http://localhost:8000')
    threading.Thread(target=_watch, daemon=True).start()
    ThreadingHTTPServer(('', 8000), Handler).serve_forever()
