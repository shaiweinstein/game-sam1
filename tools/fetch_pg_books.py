#!/usr/bin/env python3
"""Project Gutenberg ingest — 10 public-domain Beatrix Potter storybooks.

Writes `library/books/{pg id}/` (book.json, thumb.jpg, page-NN.jpg) for the
POTTER shelf (shelfOrder 19..28) alongside the 18 StoryWeaver books, in the
SAME reader page model: the book is sliced at each illustration — a page is
that image plus the text paragraphs that follow it up to the next image
(text may be ""); a pure-text run with no image becomes its own text-only
page. Project Gutenberg boilerplate (header/license/footer blocks) never
lands in page text: the kept region starts at each book's story opening and
ends at its closing line (per-book open_re/end_re below).

Source per book (whichever carries the ORIGINAL Potter art):
  1. https://www.gutenberg.org/cache/epub/{id}/pg{id}.epub  (xhtml + images)
  2. https://www.gutenberg.org/files/{id}/{id}-h/{id}-h.htm + its images/
  3. https://www.gutenberg.org/cache/epub/{id}/pg{id}-images.html
The 2026-era epubs of these titles carry ONLY a cover scan; the illustrated
HTML route carries the 26 story plates each, so that route wins for all 10
(the "source route used" column of the run report shows the choice). Every
book's title/copyright matter must name Beatrix Potter — anything that does
not is skipped and flagged.

Images: the book's own embedded JPEGs/PNGs saved in reading order as
page-NN.jpg (2-digit; page-NN.png kept as .png when a PNG cannot be
converted with the stdlib and the `image` field matches the file name).
GIF odds-and-ends (publisher devices) are not page material and are dropped
from the stream. thumb.jpg prefers PG's small cover
(pg{id}.cover.medium.jpg / .small.jpg), else the first page JPEG.

Stdlib only. Polite UA, timeouts, one retry, disk cache in
/tmp/kilo/fetch-books-cache/ — same Fetcher as tools/fetch_books.py.

Per-book `level` (reading-difficulty estimate for the shelf badge):
  14838 Peter Rabbit        1  short, simple opening-reader vocabulary
  14407 Benjamin Bunny      1  short, simple; garden/farm words
  14872 Squirrel Nutkin     2  riddles and archaic diction ("succotash",
                               "impertinent", riddle chants)
  14814 Jemima Puddle-Duck  1  simple farmyard tale
  14837 Tom Kitten          1  short, simple; clothing words
  15077 Mr. Jeremy Fisher   1  simple; fishing/nature words
  15137 Mrs. Tiggy-Winkle   1  simple; laundry words
  14868 Tailor of Gloucester 2  longer/archaic vocabulary ("periwigs",
                               "lappets", "simnel", "ravelling")
  14220 Flopsy Bunnies      2  longer vocabulary ("soporific", "improvident",
                               "doleful")
  45264 Two Bad Mice        1  short, simple slapstick

Usage:
  python3 tools/fetch_pg_books.py            # ingest all ten
  python3 tools/fetch_pg_books.py 14838 45264
"""
import argparse
import io
import json
import re
import struct
import sys
import zipfile
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urljoin

from fetch_books import CACHE_DIR, Fetcher


def fetch_bytes(fetcher, url):
    """Tolerant get_bytes: b'' instead of raising (route probes 404 sometimes)."""
    try:
        return fetcher.get_bytes(url)
    except Exception:
        return b""

ROOT = Path(__file__).resolve().parent.parent
LIBRARY_BOOKS = ROOT / "library" / "books"

# Story plate budget (soft): aim <=1.5 MiB per book; a single scan over
# 300 KB should prefer a smaller variant from the same images/ set.
BOOK_BUDGET_BYTES = int(1.5 * 1024 * 1024)
SCAN_BUDGET_BYTES = 300 * 1024

# ---- text hygiene ---------------------------------------------------------

# Truncate a paragraph AT the first Project Gutenberg marker (a paragraph can
# carry story tail + "THE END" + the boilerplate opener in one blob).
BOILER_CUT_RE = re.compile(
    r"(?i)(\*\*\* ?(start|end) of|end of (the |this )?project gutenberg"
    r"|project gutenberg('s)? (ebook|literary)"
    r"|this ebook is for the use of anyone|gutenberg-tm"
    r"|the full project gutenberg license|this file should be named"
    r"|most people start at our web site|\*\*\* ?start: full license)")

# Drop any paragraph that is still pure boilerplate after the cut.
BOILER_DROP_RE = re.compile(
    r"(?i)(project gutenberg|gutenberg\.org|gutenberg-tm|ebook is for the use"
    r"|transcriber|start: full license|end of this project)")

# Printer's-colophon / imprint stragglers (never story text).
STRIP_RE = re.compile(
    r"(?i)(^\s*printed by|printed and bound|william clowes|racquet court press"
    r"|all rights reserved|entered at stationers)")

PAGE_NUM_RE = re.compile(r"\[\d{1,3}\]")


def tidy_paragraph(text):
    """One paragraph: whitespace-collapsed, [N] scan markers removed."""
    text = PAGE_NUM_RE.sub(" ", text)
    return re.sub(r"\s+", " ", text).strip()


def clean_paragraphs(paras, strip_re=None):
    """Boilerplate-safe paragraph list (cut-at + drop), optional per-book strip."""
    out = []
    for para in paras:
        cut = BOILER_CUT_RE.search(para)
        if cut:
            para = para[:cut.start()].strip()
        if not para or BOILER_DROP_RE.search(para):
            continue
        if strip_re and strip_re.search(para):
            continue
        out.append(para)
    return out


# ---- html -> stream -------------------------------------------------------

BLOCK_TAGS = {"p", "div", "h1", "h2", "h3", "h4", "h5", "h6", "li",
              "blockquote", "pre", "td", "tr", "table", "section", "article"}


class StreamParser(HTMLParser):
    """Ordered stream of (\"img\", src) / (\"paras\", [str, ...]) items."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.items = []
        self._buf = []
        self._paras = []

    def _flush_para(self):
        text = tidy_paragraph("".join(self._buf))
        self._buf = []
        if text:
            self._paras.append(text)

    def _flush_paras(self):
        self._flush_para()
        if self._paras:
            self.items.append(("paras", self._paras))
            self._paras = []

    def handle_starttag(self, tag, attrs):
        if tag == "img":
            self._flush_paras()
            src = dict(attrs).get("src")
            if src:
                self.items.append(("img", src))
        elif tag in BLOCK_TAGS:
            self._flush_para()

    def handle_endtag(self, tag):
        if tag in BLOCK_TAGS:
            self._flush_para()

    def handle_data(self, data):
        self._buf.append(data)

    def close(self):
        super().close()
        self._flush_paras()


def parse_stream(html_text):
    parser = StreamParser()
    parser.feed(html_text)
    parser.close()
    return parser.items


def full_text(items):
    return " ".join(p for kind, payload in items if kind == "paras" for p in payload)


# ---- image formats --------------------------------------------------------

def image_ext(data):
    if data[:2] == b"\xff\xd8":
        return ".jpg"
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return ".png"
    if data[:3] == b"GIF":
        return ".gif"
    return ""


def jpeg_size(data):
    i = 2
    while i < len(data) - 9:
        if data[i] != 0xFF:
            i += 1
            continue
        marker = data[i + 1]
        if marker in (0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9,
                      0xCA, 0xCB, 0xCD, 0xCE, 0xCF):
            h, w = struct.unpack(">HH", data[i + 5:i + 9])
            return w, h
        if marker in (0xD8, 0x01) or 0xD0 <= marker <= 0xD7:
            i += 2
            continue
        i += 2 + struct.unpack(">H", data[i + 2:i + 4])[0]
    return None


def png_size(data):
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return struct.unpack(">II", data[16:24])
    return None


def gif_size(data):
    if data[:3] == b"GIF":
        return struct.unpack("<HH", data[6:10])
    return None


def image_size(data):
    return jpeg_size(data) or png_size(data) or gif_size(data)


# ---- the shelf ------------------------------------------------------------

# open_re: the book's story-opening region (title matter before it is cut).
# first_img_re: first illustration kept (name stem); earlier scans are front
# matter (covers, endpapers, title-page devices) and are cut.
# end_re: the closing story paragraph; everything after it is cut.
PG_BOOKS = [
    {
        "pg_id": 14838,
        "title": "The Tale of Peter Rabbit",
        "year": "1902",
        "level": 1,
        "publisher": "Frederick Warne & Co.",
        "open_re": r"Once upon a time there were four little Rabbits",
        "first_img_re": r"peter04",   # title plate (the GIF device after it drops)
        "end_re": r"bread and milk and blackberries for supper",
    },
    {
        "pg_id": 14407,
        "title": "The Tale of Benjamin Bunny",
        "year": "1904",
        "level": 1,
        "publisher": "Frederick Warne & Co.",
        "open_re": r"One morning a little rabbit sat on a bank",
        "first_img_re": r"^08-tb",
        "end_re": r"When Peter got home his mother forgave him",
    },
    {
        "pg_id": 14872,
        "title": "The Tale of Squirrel Nutkin",
        "year": "1903",
        "level": 2,
        "publisher": "Frederick Warne & Co.",
        "open_re": r"This is a Tale about a tail",
        "first_img_re": r"^8-tb",
        "end_re": r"And to this day, if you meet Nutkin",
    },
    {
        "pg_id": 14814,
        "title": "The Tale of Jemima Puddle-Duck",
        "year": "1908",
        "level": 1,
        "publisher": "Frederick Warne & Co.",
        "open_re": r"What a funny sight it is to see a brood of ducklings",
        "first_img_re": r"^8-tb",
        "end_re": r"always been a bad sitter",
    },
    {
        "pg_id": 14837,
        "title": "The Tale of Tom Kitten",
        "year": "1907",
        "level": 1,
        "publisher": "Frederick Warne & Co.",
        "open_re": r"Once upon a time there were three little kittens",
        "first_img_re": r"^tom08",
        "end_re": r"have been looking for them ever since",
    },
    {
        "pg_id": 15077,
        "title": "The Tale of Mr. Jeremy Fisher",
        "year": "1906",
        "level": 1,
        "publisher": "Frederick Warne & Co.",
        "open_re": r"Once upon a time there was a frog called Mr\.\s*Jeremy Fisher",
        "first_img_re": r"^jf04",
        "end_re": r"roasted grasshopper with lady-bird sauce",
    },
    {
        "pg_id": 15137,
        "title": "The Tale of Mrs. Tiggy-Winkle",
        "year": "1905",
        "level": 1,
        "publisher": "Frederick Warne & Co.",
        "open_re": r"Once upon a time there was a little girl called Lucie",
        "first_img_re": r"^8-tb",
        "end_re": r"nothing but a HEDGEHOG",
    },
    {
        "pg_id": 14868,
        "title": "The Tailor of Gloucester",
        "year": "1903",
        "level": 2,
        "publisher": "Frederick Warne & Co.",
        "open_re": r"In the time of swords and periwigs",
        "first_img_re": r"^4-tb",
        "end_re": r"most wonderful waistcoats",
    },
    {
        "pg_id": 14220,
        "title": "The Tale of the Flopsy Bunnies",
        "year": "1909",
        "level": 2,
        "publisher": "Frederick Warne & Co.",
        "open_re": r"It is said that the effect of eating too much lettuce",
        "first_img_re": r"^image004",
        "end_re": r"rabbit-wool to make herself a cloak",
    },
    {
        "pg_id": 45264,
        "title": "The Tale of Two Bad Mice",
        "year": "1904",
        "level": 1,
        # title page reads "LONDON FREDERICK WARNE AND CO. AND NEW YORK 1904"
        "publisher": "Frederick Warne and Co.",
        "open_re": r"(?i)ONCE upon a time there was a very beautiful",
        "first_img_re": r"^illus19",
        "end_re": r"(?i)with her dust-pan and her broom",
    },
]

SHELF_ORDER_BASE = 18  # after the 18 StoryWeaver books


# ---- source routes --------------------------------------------------------

class Source:
    """One fetched route: html docs + resolver from img src to bytes+url."""

    def __init__(self, route, docs, resolver):
        self.route = route          # "epub" | "illustrated-html" | "images-html"
        self.docs = docs            # [(base_url, html_text), ...] in reading order
        self.resolver = resolver    # (base_url, src) -> (abs_url, bytes)

    def stream(self):
        items = []
        for _, html_text in self.docs:
            for item in parse_stream(html_text):
                if items and item[0] == "paras" and items[-1][0] == "paras":
                    items[-1][1].extend(item[1])
                else:
                    items.append(item)
        return items


def route_epub(fetcher, pg_id):
    """pg{id}.epub — xhtml spine + embedded images. None unless it carries art."""
    url = f"https://www.gutenberg.org/cache/epub/{pg_id}/pg{pg_id}.epub"
    blob = fetch_bytes(fetcher, url)
    if not blob.startswith(b"PK"):
        return None
    try:
        zf = zipfile.ZipFile(io.BytesIO(blob))
    except zipfile.BadZipFile:
        return None
    names = set(zf.namelist())
    # container.xml -> package opf -> spine order
    try:
        import xml.etree.ElementTree as ET
        container = ET.fromstring(zf.read("META-INF/container.xml"))
        opf_path = None
        for el in container.iter():
            if el.tag.endswith("rootfile"):
                opf_path = el.get("full-path")
                break
        if not opf_path or opf_path not in names:
            return None
        opf_dir = opf_path.rsplit("/", 1)[0] if "/" in opf_path else ""
        opf = ET.fromstring(zf.read(opf_path))
        manifest = {}
        spine = []
        for el in opf.iter():
            if el.tag.endswith("item") and el.get("id"):
                manifest[el.get("id")] = el.get("href")
            elif el.tag.endswith("itemref") and el.get("idref"):
                spine.append(el.get("idref"))
        docs = []
        for idref in spine:
            href = manifest.get(idref)
            if not href:
                continue
            member = f"{opf_dir}/{href}" if opf_dir else href
            member = member.lstrip("./")
            if member in names:
                base = f"epub://{pg_id}/{member}"
                docs.append((base, zf.read(member).decode("utf-8", "replace")))
    except Exception:
        return None
    if not docs:
        return None

    def resolve(base, src):
        # base is epub://{id}/{zip/member}; resolve src against the member dir
        base_path = base.split("/", 3)[-1]
        rel = urljoin("https://x/" + base_path, src).split("/", 3)[-1]
        rel = rel.split("?", 1)[0]
        if rel not in names:
            return None, None
        return f"epub://{pg_id}/{rel}", zf.read(rel)

    return Source("epub", docs, resolve)


def route_html(fetcher, pg_id):
    """files/{id}/{id}-h/{id}-h.htm + its images/ (the illustrated HTML)."""
    base = f"https://www.gutenberg.org/files/{pg_id}/{pg_id}-h/"
    url = base + f"{pg_id}-h.htm"
    blob = fetch_bytes(fetcher, url)
    if not blob or b"<html" not in blob[:2000].lower():
        return None
    html_text = blob.decode("utf-8", "replace")

    def resolve(doc_base, src):
        abs_url = urljoin(doc_base, src)
        return abs_url, fetch_bytes(fetcher, abs_url)

    return Source("illustrated-html", [(base, html_text)], resolve)


def route_images_html(fetcher, pg_id):
    """cache/epub/{id}/pg{id}-images.html fallback (also tries dotted form)."""
    for name in (f"pg{pg_id}-images.html", f"pg{pg_id}.images.html"):
        base = f"https://www.gutenberg.org/cache/epub/{pg_id}/"
        blob = fetch_bytes(fetcher, base + name)
        if not blob or b"<html" not in blob[:2000].lower():
            continue
        html_text = blob.decode("utf-8", "replace")

        def resolve(doc_base, src):
            abs_url = urljoin(doc_base, src)
            return abs_url, fetch_bytes(fetcher, abs_url)

        return Source("images-html", [(base, html_text)], resolve)
    return None


def pick_source(fetcher, pg_id):
    """First route that carries the original Potter art (many plates + credit)."""
    for loader in (route_epub, route_html, route_images_html):
        source = loader(fetcher, pg_id)
        if not source:
            continue
        stream = source.stream()
        n_imgs = sum(1 for kind, _ in stream if kind == "img")
        text = full_text(stream)
        if n_imgs >= 20 and re.search(r"(?i)beatrix potter", text):
            return source
    return None


# ---- cuts + page model ----------------------------------------------------

def cut_stream(items, cfg, img_lookup):
    """Apply the per-book kept region; return ordered page-model items."""
    open_re = re.compile(cfg["open_re"])
    end_re = re.compile(cfg["end_re"])
    first_img_re = re.compile(cfg["first_img_re"])
    strip_re = STRIP_RE

    cleaned = []
    for kind, payload in items:
        if kind == "paras":
            paras = clean_paragraphs(payload, strip_re)
            if paras:
                cleaned.append(("paras", paras))
        else:
            if cfg.get("keep_gif") or img_lookup.get(payload, b"")[:3] != b"GIF":
                cleaned.append(("img", payload))

    # text: keep from the story opening (open_re) through the closing line.
    # Images ride along untouched here — the first_img_re filter below owns
    # the front-matter image cut (title plates sit BEFORE the opening text).
    kept, started, ended = [], False, False
    for kind, payload in cleaned:
        if ended:
            break
        if kind == "img":
            kept.append((kind, payload))
            continue
        if not started:
            idx = next((i for i, p in enumerate(payload) if open_re.search(p)), None)
            if idx is None:
                continue
            payload = payload[idx:]
            started = True
        hit = next((i for i, p in enumerate(payload) if end_re.search(p)), None)
        if hit is not None:
            payload = payload[:hit + 1]
            ended = True
        kept.append((kind, payload))
    if not started or not ended:
        raise SystemExit(f"{cfg['pg_id']}: kept region not found "
                         f"(open matched={started}, end matched={ended})")

    # images: keep from the first story plate onward (within the text region)
    first = None
    for i, (kind, payload) in enumerate(kept):
        if kind == "img" and first_img_re.search(payload.rsplit("/", 1)[-1]):
            first = i
            break
    if first is None:
        raise SystemExit(f"{cfg['pg_id']}: first_img_re matched no image: "
                         f"{cfg['first_img_re']!r}")
    kept = [item for i, item in enumerate(kept) if i >= first or item[0] != "img"]

    # title/byline heads page 1 when it is not already in the text
    for i, (kind, payload) in enumerate(kept):
        if kind == "paras":
            if cfg["title"].lower() not in payload[0].lower():
                kept[i] = ("paras", [cfg["title"] + " — by Beatrix Potter."] + list(payload))
            break
    return kept


def build_pages(items):
    """Slice at each illustration: image + following paragraphs (text may be '')."""
    pages = []
    leading = []
    i = 0
    while i < len(items) and items[i][0] == "paras":
        leading.extend(items[i][1])
        i += 1
    if leading:
        pages.append({"image": "", "text": " ".join(leading)})
    while i < len(items):
        kind, payload = items[i]
        assert kind == "img"
        text_paras = []
        i += 1
        while i < len(items) and items[i][0] == "paras":
            text_paras.extend(items[i][1])
            i += 1
        pages.append({"image": payload, "text": " ".join(text_paras)})
    return pages


# ---- per-book ingest ------------------------------------------------------

def attribution_of(cfg, pg_id):
    return (f"{cfg['title']} (English), written and illustrated by Beatrix Potter, "
            f"first published {cfg['year']}. This text and its illustrations are "
            f"in the public domain in the USA. Source: Project Gutenberg, "
            f"eBook #{pg_id} (https://www.gutenberg.org/ebooks/{pg_id}).")


def ingest_book(fetcher, cfg, shelf_order, reports):
    pg_id = cfg["pg_id"]
    tag = f"{pg_id} {cfg['title']}"
    source = pick_source(fetcher, pg_id)
    if not source:
        raise SystemExit(f"SKIP/FLAG {tag}: no route carries original Potter art "
                         f"(or no Beatrix Potter credit) — nothing written")
    stream = source.stream()
    if not re.search(r"(?i)beatrix potter", full_text(stream)):
        raise SystemExit(f"FLAG {tag}: title/copyright matter does not name "
                         f"Beatrix Potter — nothing written")

    # fetch every stream image once (cache) so format cuts are informed
    img_lookup, img_url = {}, {}
    for kind, payload in stream:
        if kind != "img" or payload in img_lookup:
            continue
        # resolve against each doc base until bytes come back (multi-doc epubs)
        data = b""
        for doc_base, _ in source.docs:
            url, data = source.resolver(doc_base, payload)
            if data:
                break
        img_lookup[payload] = data or b""
        img_url[payload] = url

    kept = cut_stream(stream, cfg, img_lookup)
    raw_pages = build_pages(kept)

    # materialise page files (page-NN.ext) in reading order
    book_dir = LIBRARY_BOOKS / str(pg_id)
    book_dir.mkdir(parents=True, exist_ok=True)
    for stale in book_dir.glob("page-*"):
        stale.unlink()
    pages, image_bytes, dims = [], [], []
    portrait_votes = 0
    for n, page in enumerate(raw_pages, start=1):
        image = page["image"]
        if image:
            data = img_lookup[image]
            ext = image_ext(data)
            if ext == ".gif":
                raise SystemExit(f"{tag}: GIF page image survived the cut: {image}")
            if ext not in (".jpg", ".png"):
                raise SystemExit(f"{tag}: unknown image format: {image}")
            name = f"page-{n:02d}{ext}"
            (book_dir / name).write_bytes(data)
            image_bytes.append(data)
            size = image_size(data)
            if size:
                dims.append(size)
                if size[1] > size[0]:
                    portrait_votes += 1
            image = name
        pages.append({"n": n, "image": image, "text": page["text"]})

    # hard hygiene: no Gutenberg boilerplate inside page text
    for page in pages:
        if re.search(r"(?i)gutenberg", page["text"]):
            raise SystemExit(f"{tag}: boilerplate leaked into page {page['n']} text")

    # thumb.jpg: PG small cover, else the first page JPEG
    thumb = fetch_bytes(
        fetcher, f"https://www.gutenberg.org/cache/epub/{pg_id}/pg{pg_id}.cover.medium.jpg")
    if image_ext(thumb) != ".jpg":
        thumb = fetch_bytes(
            fetcher, f"https://www.gutenberg.org/cache/epub/{pg_id}/pg{pg_id}.cover.small.jpg")
    if image_ext(thumb) != ".jpg":
        thumb = next((b for b in image_bytes if image_ext(b) == ".jpg"), b"")
    if image_ext(thumb) != ".jpg" or len(thumb) <= 2048:
        raise SystemExit(f"{tag}: no usable JPEG thumb")
    (book_dir / "thumb.jpg").write_bytes(thumb)

    orientation = "portrait" if portrait_votes * 2 > len(dims) else "landscape"
    book = {
        "id": pg_id,
        "title": cfg["title"],
        "slug": f"pg-{pg_id}",
        "sourceUrl": f"https://www.gutenberg.org/ebooks/{pg_id}",
        "language": "English",
        "level": cfg["level"],
        "orientation": orientation,
        "pageCount": len(pages),
        "license": "Public Domain",
        "licenseUrl": f"https://www.gutenberg.org/ebooks/{pg_id}",
        "attribution": attribution_of(cfg, pg_id),
        "copyrightNotice": f"Public domain in the USA. First published {cfg['year']}.",
        "publisher": cfg["publisher"],
        "publishedYear": cfg["year"],
        "authors": ["Beatrix Potter"],
        "illustrators": ["Beatrix Potter"],
        "shelfOrder": shelf_order,
        "pages": pages,
    }
    (book_dir / "book.json").write_bytes(
        (json.dumps(book, indent=2, ensure_ascii=False) + "\n").encode("utf-8"))

    n_images = sum(1 for p in pages if p["image"])
    mib = sum(f.stat().st_size for f in book_dir.iterdir() if f.is_file()) / 1024 / 1024
    over = [len(b) for b in image_bytes if len(b) > SCAN_BUDGET_BYTES]
    reports.append({
        "id": pg_id, "title": cfg["title"], "pages": len(pages),
        "images": n_images, "mib": round(mib, 2), "level": cfg["level"],
        "route": source.route, "orientation": orientation,
        "over_scans": len(over), "over_budget": mib * 1024 * 1024 > BOOK_BUDGET_BYTES,
    })
    print(f"OK  {tag}: {len(pages)} pages, {n_images} images, {mib:.2f} MiB, "
          f"level {cfg['level']}, {source.route}", flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("ids", nargs="*", type=int,
                        help="Project Gutenberg ids (default: all ten)")
    args = parser.parse_args()
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    wanted = set(args.ids) if args.ids else None
    fetcher = Fetcher(use_cache=True)
    reports = []
    for offset, cfg in enumerate(PG_BOOKS):
        if wanted is not None and cfg["pg_id"] not in wanted:
            continue
        ingest_book(fetcher, cfg, SHELF_ORDER_BASE + 1 + offset, reports)
    print("\npg ingest summary:")
    for r in reports:
        flags = []
        if r["over_scans"]:
            flags.append(f"{r['over_scans']} scan(s) >300KB kept (no smaller variant)")
        if r["over_budget"]:
            flags.append("over 1.5MiB soft budget")
        print(f"  {r['id']} | {r['title']} | {r['pages']}p | {r['images']} img | "
              f"{r['mib']} MiB | level {r['level']} | {r['route']}"
              + (" | " + "; ".join(flags) if flags else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main())
