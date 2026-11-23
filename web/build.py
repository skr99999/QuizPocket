"""Export the shared UI as a static PWA. Requires only Python 3."""
import hashlib
import json
from pathlib import Path
import sys


web = Path(__file__).resolve().parent
output = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else web / "dist"
if output.exists() and (not output.is_dir() or any(output.iterdir())):
    sys.exit(f"Use a new or empty output directory: {output}")

files = {path.name: path.read_bytes() for path in (web.parent / "assets").iterdir() if path.is_file()}
html = files["index.html"].decode("utf-8")
assert "connect-src 'self';" in html and "</head>" in html
html = html.replace("connect-src 'self';", "connect-src 'self'; manifest-src 'self'; worker-src 'self';", 1)
html = html.replace("</head>", """  <meta name="quizpocket-web" content="1">
  <meta name="theme-color" content="#eef3f7">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <link rel="manifest" href="manifest.webmanifest">
  <link rel="apple-touch-icon" href="icon-180.png">
  <script src="install.js" defer></script>
</head>""", 1)
html = html.replace("</header>", "</header>\n    <p id=\"offline-status\" role=\"status\"></p>", 1)
html = html.replace(
    "在微信或 QQ 收到题库时，可用「其他应用打开」或「分享」选择「掌上题库」，也可以先保存文件再导入。",
    "在微信或 QQ 收到题库时，先把文件保存到「文件」App，再点「导入题库」选取。",
    1,
)
files["index.html"] = html.encode("utf-8")
vocabulary = files["vocabulary.html"].decode("utf-8")
vocabulary = vocabulary.replace("style-src 'self';", "style-src 'self'; connect-src https://api.deepseek.com;", 1)
files["vocabulary.html"] = vocabulary.replace("</head>", '  <meta name="quizpocket-web" content="1">\n</head>', 1).encode("utf-8")
for name in ("install.js", "update.html", "update.js", "manifest.webmanifest", "icon-180.png", "icon-192.png", "icon-512.png"):
    files[name] = (web / name).read_bytes()

worker = (web / "sw.js").read_text(encoding="utf-8")
digest = hashlib.sha256(worker.encode("utf-8"))
for name, content in sorted(files.items()):
    digest.update(name.encode("utf-8") + b"\0" + hashlib.sha256(content).digest())
worker = worker.replace("__VERSION__", digest.hexdigest()[:16]).replace("__FILES__", json.dumps(sorted(files)))
files["sw.js"] = worker.encode("utf-8")

output.mkdir(parents=True, exist_ok=True)
for name, content in files.items():
    (output / name).write_bytes(content)
print(output)
