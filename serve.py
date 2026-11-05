"""Local Spotify demo: python3 serve.py, then http://127.0.0.1:8000/"""
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from urllib.parse import urlsplit

class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(Path(__file__).parent), **kwargs)

    def do_GET(self):
        if urlsplit(self.path).path == '/callback':
            self.path = '/index.html'
        super().do_GET()

    def log_request(self, code='-', size='-'):
        # Never log OAuth authorization codes from URL parameters.
        self.log_message('%s %s %s', self.command, urlsplit(self.path).path, code)

if __name__ == '__main__':
    print('Open http://127.0.0.1:8000/ (Ctrl+C to stop)', flush=True)
    ThreadingHTTPServer(('127.0.0.1', 8000), Handler).serve_forever()
