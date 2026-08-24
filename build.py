#!/usr/bin/env python3
"""Inline the CSS and JS from src/ into single self-contained pages.

Outputs:
  dist/yozakura.html the build — open it, mail it, drop it on a USB stick
  dist/index.html    the same bytes under the name a web host expects
  dist/artifact.html the same page as body content only, for Claude Artifacts
"""
import os
import re
import sys

ROOT = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(ROOT, "src")
DIST = os.path.join(ROOT, "dist")


def read(*parts):
    with open(os.path.join(SRC, *parts), encoding="utf-8") as fh:
        return fh.read()


def guard(text):
    """Stop a literal </script> inside JS from closing the tag early."""
    return text.replace("</script>", "<\\/script>")


def inline(html):
    def css_sub(match):
        return "<style>\n%s\n</style>" % read(*match.group(1).split("/"))

    def js_sub(match):
        return "<script>\n%s\n</script>" % guard(read(*match.group(1).split("/")))

    # Only local paths get inlined; the Google Fonts stylesheet stays a link.
    html = re.sub(r'<link rel="stylesheet" href="(?!https?://)([^"]+)">', css_sub, html)
    html = re.sub(r'<script src="(?!https?://)([^"]+)"></script>', js_sub, html)
    return html


def to_artifact(html):
    """Strip the document shell — Artifacts supply their own <head> and <body>.

    The content is emitted unwrapped so #stage and .panel stay direct children
    of <body>; the layout is a flex column on <body> itself.
    """
    body = re.search(r"<body[^>]*>(.*)</body>", html, re.S).group(1)
    title = re.search(r"<title>(.*?)</title>", html, re.S).group(1)
    style = re.search(r"<style>(.*?)</style>", html, re.S).group(1)

    # <head> is stripped along with its font <link>, so the webfont is pulled in
    # as an @import instead — it has to lead the stylesheet to be honoured.
    fonts = re.findall(r'<link rel="stylesheet" href="(https://fonts\.googleapis\.com/[^"]+)">', html)
    # No entity-escaping: <style> is raw text in HTML, so "&amp;" would survive
    # literally into the URL and break it.
    imports = "".join('@import url("%s");\n' % href for href in fonts)
    return "<title>%s</title>\n<style>\n%s%s</style>\n%s" % (
        title, imports, style, body.strip())


def main():
    html = inline(read("index.html"))
    os.makedirs(DIST, exist_ok=True)

    # The named build is the one to hand to somebody; index.html is the same
    # bytes under the filename a static host will look for by default.
    out = os.path.join(DIST, "yozakura.html")
    with open(out, "w", encoding="utf-8") as fh:
        fh.write(html)

    hosted = os.path.join(DIST, "index.html")
    with open(hosted, "w", encoding="utf-8") as fh:
        fh.write(html)

    art = os.path.join(DIST, "artifact.html")
    artifact_html = to_artifact(html)
    with open(art, "w", encoding="utf-8") as fh:
        fh.write(artifact_html)

    # A stand-in for the wrapper the Artifacts viewer supplies, so the stripped
    # build can be opened and checked locally before publishing.
    preview = os.path.join(ROOT, "test", "artifact-preview.html")
    with open(preview, "w", encoding="utf-8") as fh:
        fh.write("<!doctype html>\n<html lang=\"en\"><head><meta charset=\"utf-8\">"
                 "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">"
                 "</head><body>\n%s\n</body></html>\n" % artifact_html)

    for path in (out, hosted, art):
        print("%-24s %6.1f KB" % (os.path.relpath(path, ROOT), os.path.getsize(path) / 1024))

    leftovers = re.findall(r'<(?:link[^>]*href|script[^>]*src)="(?!https://fonts\.)([^"]+)"', html)
    if leftovers:
        sys.exit("build failed: local references survived inlining: %s" % leftovers)


if __name__ == "__main__":
    main()
