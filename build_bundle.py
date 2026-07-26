#!/usr/bin/env python3
"""
Regenerate web/app.bundle.js from the ES-module sources under web/*.js,
without needing esbuild/node. This is a purpose-built concatenator for this
project's specific (near-flat) module graph — not a general bundler.

How it works:
  1. Reads each source file in dependency-safe order.
  2. Strips every local relative import ("./x.js") — the named things they
     import become plain top-level declarations once concatenated, and
     function declarations hoist, so cross-file calls still resolve.
  3. Strips the "export " keyword from top-level const/function/let so
     declarations become plain module-scope bindings.
  4. Collects the CDN imports (preact/htm) used across all files, de-dupes
     them, and emits ONE import block at the top.
  5. Keeps only the first `const html = htm.bind(h);` (every file redeclares
     it; redeclaring a const in the same scope is a SyntaxError).

Order matters only for top-level *values* referenced at module-evaluation
time (not inside function bodies): utils.js's RAMP_*/PROF_STOPS constants
must exist before heatmap.js's top-level METRICS array literal reads them,
and state.js's createStore must exist before app.js calls it at the top
level to build `store`. Hence: utils, suitability, state, app, campus,
heatmap, sbd.

Run:  python3 build_bundle.py
Then: python3 build_standalone.py   (reads the regenerated web/app.bundle.js)
"""
import os
import re

ROOT = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.join(ROOT, "web")
OUT = os.path.join(WEB, "app.bundle.js")

ORDER = ["utils.js", "suitability.js", "state.js", "app.js", "campus.js", "heatmap.js", "sbd.js"]

LOCAL_IMPORT_RE = re.compile(r'^\s*import\s+.*?\bfrom\s+["\']\./[^"\']+["\'];?\s*$', re.MULTILINE)
CDN_IMPORT_RE = re.compile(r'^\s*import\s+(.*?)\s+from\s+["\'](https://esm\.sh/[^"\']+)["\'];?\s*$', re.MULTILINE)
EXPORT_RE = re.compile(r'^export\s+(?=(const|function|async function|let|class)\b)', re.MULTILINE)
HTML_BIND_RE = re.compile(r'^\s*const html = htm\.bind\(h\);\s*$', re.MULTILINE)


def main():
    cdn_imports = {}   # specifier text -> module url (first seen wins order)
    body_parts = []
    html_bind_kept = False

    for fname in ORDER:
        path = os.path.join(WEB, fname)
        with open(path, encoding="utf-8") as f:
            src = f.read()

        for m in CDN_IMPORT_RE.finditer(src):
            spec, url = m.group(1).strip(), m.group(2)
            cdn_imports.setdefault(url, set()).add(spec)

        src = CDN_IMPORT_RE.sub("", src)
        src = LOCAL_IMPORT_RE.sub("", src)
        src = EXPORT_RE.sub("", src)

        if HTML_BIND_RE.search(src):
            if html_bind_kept:
                src = HTML_BIND_RE.sub("", src)
            else:
                placeholder = "__KEEP_HTML_BIND__"
                src = HTML_BIND_RE.sub(placeholder, src, count=1)
                src = HTML_BIND_RE.sub("", src)  # strip any further dupes within the same file
                src = src.replace(placeholder, "const html = htm.bind(h);")
                html_bind_kept = True

        body_parts.append(f"// ==== {fname} ====\n{src.strip()}\n")

    # Build the de-duped CDN import header. Each entry in cdn_imports maps a
    # module URL to the set of specifier strings seen for it (e.g. two files
    # importing different hook subsets from the same hooks module).
    import_lines = []
    for url, specs in cdn_imports.items():
        if any(s.strip().startswith("{") is False and "," not in s for s in specs) and all(
            not s.strip().startswith("{") for s in specs
        ):
            # default import (e.g. `htm`) — just take one
            name = sorted(specs)[0]
            import_lines.append(f'import {name} from "{url}";')
            continue
        names = set()
        for s in specs:
            inner = s.strip().strip("{}").strip()
            for part in inner.split(","):
                part = part.strip()
                if part:
                    names.add(part)
        import_lines.append(f'import {{ {", ".join(sorted(names))} }} from "{url}";')

    bundle = "\n".join(import_lines) + "\n\n" + "\n".join(body_parts)

    with open(OUT, "w", encoding="utf-8") as f:
        f.write(bundle)
    print(f"[OK] wrote {OUT} ({len(bundle):,} chars, {bundle.count(chr(10)):,} lines)")


if __name__ == "__main__":
    main()
