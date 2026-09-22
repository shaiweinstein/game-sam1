#!/usr/bin/env python3
"""Page-narration audio generator for the library reader's "Read page" button.

Reads each book's ``library/books/{id}/book.json`` and synthesizes one narration
clip per page with non-empty ``text`` via Xiaomi MiMo TTS, writing::

    library/books/{id}/audio/page-NN.mp3   (NN = page ``n`` zero-padded,
                                            matching that page's ``page-NN.jpg``)

Two synthesis modes (``--mode``, default ``auto``):

``design``
    ``mimo-v2.5-tts-voicedesign`` per clip — the ``user`` message is the fixed
    VOICE DESIGN prompt, the ``assistant`` message is the page text. The voice
    is re-instantiated per clip, so timbre drifts slightly page to page.
``clone``
    ``mimo-v2.5-tts-voiceclone`` per clip, anchored to ONE base sample so the
    timbre stays constant across a whole book. Build the sample first:
    ``--make-base`` speaks the SPECIMEN text (our own text — deliberately NOT
    book content, so the clone is not word-biased) through voicedesign N times
    into ``tools/voice/candidate-{1..N}.mp3``; listen, then ``--use-base N``
    copies the winner to ``tools/voice/base.mp3`` and records the pick in
    ``tools/voice/voice.json`` (provenance). ``--voice-sample PATH`` overrides
    the sample file. The clone keeps style-instruction following, so each clip
    also carries a fixed style-director ``user`` message: the PERFORMANCE is
    held constant while the sample anchors the timbre.

``auto`` (the default) picks ``clone`` when the base sample exists (``tools/
voice/base.mp3`` or the ``--voice-sample`` override), else ``design``.

Resume-tolerant: an output clip already on disk is skipped unless ``--force``.
After a run, stamp the results into book.json with ``tools/fetch_books.py audio``.

TTS requests (verified against the Xiaomi MiMo docs / official
``mimo_tts_voicedesign.py`` and ``mimo_tts_voiceclone.py`` samples)::

    POST https://api.xiaomimimo.com/v1/chat/completions
    Authorization: Bearer <key>
    {"model": "mimo-v2.5-tts-voicedesign",
     "messages": [{"role": "user", "content": "<VOICE DESIGN>"},
                  {"role": "assistant", "content": "<TEXT TO SPEAK>"}],
     "audio": {"format": "mp3"}}
    {"model": "mimo-v2.5-tts-voiceclone",
     "messages": [{"role": "user", "content": "<STYLE DIRECTOR>"},
                  {"role": "assistant", "content": "<TEXT TO SPEAK>"}],
     "audio": {"format": "mp3",
               "voice": "data:audio/mpeg;base64,<b64 of ONE sample file>"}}

``user`` carries the voice description (design) or style director (clone);
``assistant`` carries the text to speak; ``choices[0].message.audio.data`` is
base64 audio. ``audio.voice`` (clone only) is a DataURL — ``data:{mime};base64,
{b64}``, mime ``audio/mpeg`` for .mp3 / ``audio/wav`` for .wav — of ONE sample
file, mp3 or wav, <= 10MB. Endpoint: 100 RPM rate limit; TTS currently free;
``audio.format`` supports wav/mp3/pcm/pcm16.

API key (never printed, logged or committed), first hit wins:
1. ``MIMO_API_KEY`` environment variable;
2. the ``mimo.key`` field in ``~/.local/share/kilo/auth.json`` (Kilo credential
   store). Missing in both places -> exit 2 pointing at
   https://platform.xiaomimimo.com -> API Keys.

CLI examples::

    python3 tools/fetch_audio.py --make-base --takes 3
    python3 tools/fetch_audio.py --use-base 2
    python3 tools/fetch_audio.py --book 14838
    python3 tools/fetch_audio.py --ids 14838,12294 --format wav
    python3 tools/fetch_audio.py --all --mode clone --voice-sample /tmp/base.mp3
    python3 tools/fetch_audio.py --all --dry-run
    python3 tools/fetch_audio.py --self-test

Network policy: sequential POSTs, 0.2 s sleep between calls, 60 s timeout, one
retry on failure, then the clip is recorded as failed and the run continues.
Every clip is validated (decoded size > 2KB, magic ID3 / FF Fx sync for mp3 and
RIFF for wav) before it is written. ``--self-test`` is fully offline (no
network, no key).
"""

from __future__ import annotations

import argparse
import base64
import io
import json
import math
import os
import struct
import sys
import time
import urllib.error
import urllib.request
import wave
from pathlib import Path

USER_AGENT = "lily-game-fetch-audio/1.0 (educational use; contact via lily.game)"
API_URL = "https://api.xiaomimimo.com/v1/chat/completions"
MODEL_DESIGN = "mimo-v2.5-tts-voicedesign"
MODEL_CLONE = "mimo-v2.5-tts-voiceclone"

# Verbatim voice-design `user` message used for EVERY design-mode clip and as
# the base-sample design prompt (do not paraphrase).
VOICE_DESIGN = (
    "A young woman in her twenties with a warm, friendly storybook-reading "
    "voice. Clear American (US) accent. Medium speaking pace. Gentle, "
    "expressive, patient, calm and clear - perfect for reading picture books "
    "aloud to young children."
)

# Verbatim SPECIMEN text spoken into the base sample (`--make-base`). Our own
# original text, deliberately NOT book content, so the cloned voice is not
# word-biased towards any story's vocabulary.
SPECIMEN = (
    "Good morning, little friend. Shall we spend a quiet hour with a story? "
    "Outside, the garden is bright and still, and somewhere a kettle is just "
    "beginning to hum. Take your time settling in. There is no hurry at all "
    "today."
)

# Verbatim style-director `user` message for every clone-mode clip. The sample
# anchors TIMBRE; this holds the PERFORMANCE constant page to page.
CLONE_STYLE = (
    "Warm storybook reading by a young woman in her twenties, friendly "
    "American voice, medium unhurried pace, gentle and expressive, calm and "
    "clear - the way a mother reads a picture book aloud to a young child."
)

TIMEOUT_S = 60
SLEEP_S = 0.2
MIN_BYTES = 2048  # a valid clip must be strictly larger than 2KB
MAX_SAMPLE_BYTES = 10 * 1024 * 1024  # API cap: ONE sample file, <= 10MB
LIBRARY_DEFAULT = Path(__file__).resolve().parent.parent / "library" / "books"
FIXTURE_PATH = Path("/tmp/kilo/fetch-audio-selftest/fixture.wav")
VOICE_DIR = Path(__file__).resolve().parent / "voice"
BASE_SAMPLE = VOICE_DIR / "base.mp3"
VOICE_JSON = VOICE_DIR / "voice.json"

FORMATS = ("mp3", "wav")
MODES = ("auto", "clone", "design")


# ---------------------------------------------------------------------------
# request / response / validation
# ---------------------------------------------------------------------------

def build_request(text: str, fmt: str, mode: str = "design",
                  voice: str | None = None) -> dict:
    """The exact JSON body sent to the MiMo chat-completions endpoint.

    ``design``: voicedesign envelope (VOICE DESIGN user message, no
    ``audio.voice``). ``clone``: voiceclone envelope (style-director user
    message, ``audio.voice`` = DataURL of the one base sample, encoded once
    per run and passed in as ``voice``).
    """
    if mode == "clone":
        if not voice:
            raise ValueError("clone mode needs the base-sample DataURL (voice)")
        return {
            "model": MODEL_CLONE,
            "messages": [
                {"role": "user", "content": CLONE_STYLE},
                {"role": "assistant", "content": text},
            ],
            "audio": {"format": fmt, "voice": voice},
        }
    return {
        "model": MODEL_DESIGN,
        "messages": [
            {"role": "user", "content": VOICE_DESIGN},
            {"role": "assistant", "content": text},
        ],
        "audio": {"format": fmt},
    }


def sample_mime(name: str | Path) -> str:
    """DataURL mime for a sample file name (.mp3 -> audio/mpeg, .wav -> audio/wav)."""
    ext = Path(name).suffix.lower()
    if ext == ".mp3":
        return "audio/mpeg"
    if ext == ".wav":
        return "audio/wav"
    raise ValueError(f"sample must be .mp3 or .wav, got: {name}")


def check_sample_size(nbytes: int) -> None:
    """The API accepts ONE sample file of at most 10MB."""
    if nbytes > MAX_SAMPLE_BYTES:
        raise ValueError(f"sample is {nbytes} bytes, cap is {MAX_SAMPLE_BYTES} (10MB)")


def sample_data_url(blob: bytes, name: str | Path) -> str:
    """``data:{mime};base64,{b64}`` — bytes encoded as-is, mime from the name."""
    check_sample_size(len(blob))
    return f"data:{sample_mime(name)};base64," + base64.b64encode(blob).decode("ascii")


def load_sample_data_url(path: Path) -> str:
    """Read the sample file and encode it as the clone request's ``audio.voice``."""
    try:
        blob = path.read_bytes()
    except OSError as err:
        raise ValueError(f"voice sample unreadable: {path}: {err}") from err
    return sample_data_url(blob, path.name)


def mp3_duration_s(blob: bytes) -> float | None:
    """Cheap MPEG frame-header walk -> seconds (optional provenance), else None.

    Best-effort: skips an ID3v2 tag, then sums per-frame durations until the
    frame chain stops making sense. Never raises.
    """
    bitrates_v1l3 = (0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 0)
    bitrates_v2l3 = (0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160, 0)
    rates = {3: (44100, 48000, 32000), 2: (22050, 24000, 16000), 0: (11025, 12000, 8000)}
    n = len(blob)
    i = 0
    if blob[:3] == b"ID3" and n >= 10:  # ID3v2 tag: 10-byte header, syncsafe size
        i = 10 + ((blob[6] & 0x7F) << 21 | (blob[7] & 0x7F) << 14
                  | (blob[8] & 0x7F) << 7 | (blob[9] & 0x7F))
    total = 0.0
    frames = 0
    while i + 4 <= n:
        h1, h2 = blob[i + 1], blob[i + 2]
        if blob[i] != 0xFF or (h1 & 0xE0) != 0xE0:
            i += 1  # resync (trailing junk ends the walk)
            continue
        version = (h1 >> 3) & 0x03  # 3 = MPEG1, 2 = MPEG2, 0 = MPEG2.5, 1 = reserved
        layer = (h1 >> 1) & 0x03    # 1 = Layer III, 2 = Layer II, 3 = Layer I
        br_idx, sr_idx = (h2 >> 4) & 0x0F, (h2 >> 2) & 0x03
        pad = (h2 >> 1) & 0x01
        if version == 1 or layer == 0 or br_idx in (0, 15) or sr_idx == 3:
            i += 1
            continue
        rate = rates[version][sr_idx]
        kbps = (bitrates_v1l3 if version == 3 else bitrates_v2l3)[br_idx]
        if layer == 3:  # Layer I
            frame_len = (12 * kbps * 1000 // rate + pad) * 4
            samples = 384
        else:  # Layer II / III
            frame_len = (144 if layer == 2 or version == 3 else 72) * kbps * 1000 // rate + pad
            samples = 576 if (layer == 1 and version != 3) else 1152
        if frame_len <= 4:
            i += 1
            continue
        total += samples / rate
        frames += 1
        i += frame_len
    return round(total, 3) if frames else None


def parse_audio_data(payload: dict) -> bytes:
    """Decode ``choices[0].message.audio.data`` (base64) from a 200 response."""
    try:
        data = payload["choices"][0]["message"]["audio"]["data"]
    except (KeyError, IndexError, TypeError) as err:
        raise ValueError(f"response missing choices[0].message.audio.data: {err}") from err
    if not isinstance(data, str) or not data.strip():
        raise ValueError("response audio.data is empty")
    return base64.b64decode(data)


def validate_clip(blob: bytes, fmt: str) -> str | None:
    """Return an error string when a decoded clip is not usable audio."""
    if len(blob) <= MIN_BYTES:
        return f"decoded {len(blob)} bytes, need > {MIN_BYTES}"
    if fmt == "wav":
        if blob[:4] != b"RIFF":
            return f"wav magic is {blob[:4]!r}, expected RIFF"
        return None
    if blob[:3] == b"ID3":
        return None
    # mp3 frame sync: FF Fx (11 sync bits; top nibble of byte 1 is F)
    if blob[0] == 0xFF and (blob[1] & 0xF0) == 0xF0:
        return None
    return f"mp3 magic is {blob[:2].hex()}, expected ID3 or FF Fx sync"


def resolve_api_key() -> str | None:
    """``MIMO_API_KEY`` first, then ``mimo.key`` in the Kilo credential store."""
    key = os.environ.get("MIMO_API_KEY", "").strip()
    if key:
        return key
    auth_path = Path.home() / ".local" / "share" / "kilo" / "auth.json"
    try:
        data = json.loads(auth_path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    key = str(((data or {}).get("mimo") or {}).get("key") or "").strip()
    return key or None


def no_key_message() -> str:
    return (
        "error: no MiMo API key found (checked MIMO_API_KEY and the mimo.key "
        "field in ~/.local/share/kilo/auth.json).\n"
        "  Create a key at https://platform.xiaomimimo.com -> API Keys and "
        "export MIMO_API_KEY or store it in the Kilo credential store."
    )


def synthesize(key: str, request: dict, fmt: str) -> bytes:
    """One TTS call: POST the request envelope, return decoded audio bytes.

    Never logs the key. Raises on any HTTP/API/parse/validation error (the
    caller retries once, then records the failure).
    """
    body = json.dumps(request, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        API_URL,
        data=body,
        method="POST",
        headers={
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            "User-Agent": USER_AGENT,
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT_S) as resp:
            raw = resp.read()
    except urllib.error.HTTPError as err:
        detail = err.read(200).decode("utf-8", "replace") if err.fp else ""
        raise RuntimeError(f"HTTP {err.code} {err.reason}: {detail[:200]}") from err
    except urllib.error.URLError as err:
        raise RuntimeError(f"network error: {err.reason}") from err
    try:
        payload = json.loads(raw.decode("utf-8"))
    except ValueError as err:
        raise ValueError(f"non-JSON response: {err}") from err
    if isinstance(payload, dict) and payload.get("error"):
        raise ValueError(f"API error: {json.dumps(payload['error'])[:200]}")
    blob = parse_audio_data(payload)
    problem = validate_clip(blob, fmt)
    if problem:
        raise ValueError(f"invalid clip: {problem}")
    return blob


def synthesize_clip(key: str, request: dict, fmt: str) -> bytes:
    """``synthesize`` with exactly one retry; sleep 0.2 s between calls."""
    last: Exception | None = None
    for _attempt in (1, 2):
        try:
            blob = synthesize(key, request, fmt)
            time.sleep(SLEEP_S)
            return blob
        except Exception as err:  # API error -> one retry, then give up
            last = err
            time.sleep(SLEEP_S)
    raise RuntimeError(f"after 2 attempts: {last}")


# ---------------------------------------------------------------------------
# book iteration
# ---------------------------------------------------------------------------

def page_clip_name(page: dict, fmt: str) -> str:
    """``page-NN.{fmt}`` -- zero-padded page ``n``, matching ``page-NN.jpg``."""
    n = int(page.get("n") or 0)
    return f"page-{n:02d}.{fmt}"


def load_book(book_dir: Path) -> dict:
    return json.loads((book_dir / "book.json").read_text(encoding="utf-8"))


def resolve_targets(args: argparse.Namespace) -> tuple[list[Path], list[str]]:
    """Selected book dirs + errors for explicitly requested but missing books."""
    root = Path(args.out)
    errors: list[str] = []
    if args.book:
        ids = [args.book.strip()] if args.book.strip() else []
    elif args.ids:
        ids = [part.strip() for part in args.ids.split(",") if part.strip()]
    else:  # --all
        if not root.is_dir():
            return [], [f"library books dir not found: {root}"]
        dirs = [d for d in root.iterdir() if d.is_dir() and (d / "book.json").is_file()]

        def sort_key(d: Path):
            return (0, int(d.name)) if d.name.isdigit() else (1, d.name)

        return sorted(dirs, key=sort_key), errors

    dirs = []
    for book_id in ids:
        book_dir = root / book_id
        if (book_dir / "book.json").is_file():
            dirs.append(book_dir)
        else:
            errors.append(f"book {book_id}: no book.json under {book_dir}")
    return dirs, errors


REPORT_HEADER = f"  {'STATUS':<8}  {'MODE':<6}  {'PATH':<24}  DETAIL"


def report_row(status: str, mode: str, rel: str, detail: str) -> str:
    """One final-report table row; ``mode`` is the synthesis-mode column."""
    return f"  {status:<8}  {mode:<6}  {rel:<24}  {detail}"


def process_book(
    book_dir: Path,
    fmt: str,
    key: str | None,
    force: bool,
    dry_run: bool,
    mode: str,
    voice: str | None,
) -> tuple[dict, list[str], list[str]]:
    """Generate (or skip) every page clip of one book, in the given mode.

    Returns (stats, per-clip rows, failure detail lines). Rows are the final
    report table: STATUS / MODE / PATH / DETAIL columns.
    """
    stats = {"ok": 0, "failed": 0, "skipped": 0, "bytes": 0}
    rows: list[str] = []
    failures: list[str] = []
    book = load_book(book_dir)
    title = str(book.get("title") or book_dir.name)
    pages = book.get("pages") or []
    with_text = 0
    for page in pages:
        text = str(page.get("text") or "").strip()
        if not text:
            continue  # image-only page: nothing to narrate
        with_text += 1
        rel = f"audio/{page_clip_name(page, fmt)}"
        dest = book_dir / rel
        if dry_run and with_text == 1:  # one envelope sample per book
            sample = build_request(text, fmt, mode=mode, voice=voice)
            rows.append(f"  envelope sample: {json.dumps(sample, ensure_ascii=False)}")
        if dest.is_file() and not force:
            stats["skipped"] += 1
            rows.append(report_row("skipped", mode, rel,
                                   f"exists, {dest.stat().st_size} B"))
            continue
        if dry_run:
            rows.append(report_row("generate", mode, rel, f"text {len(text)} chars"))
            continue
        try:
            blob = synthesize_clip(key or "", build_request(text, fmt, mode=mode,
                                                           voice=voice), fmt)
        except Exception as err:
            stats["failed"] += 1
            rows.append(report_row("failed", mode, rel, str(err)))
            failures.append(f"{book_dir.name}/{rel}: {err}")
            continue
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(blob)
        stats["ok"] += 1
        stats["bytes"] += len(blob)
        rows.append(report_row("ok", mode, rel, f"{len(blob)} B"))
    header = f"book {book_dir.name} ({title}): {len(pages)} pages, {with_text} with text"
    return stats, [header] + rows, failures


# ---------------------------------------------------------------------------
# offline self-test (no network, no key)
# ---------------------------------------------------------------------------

def build_fixture_wav() -> bytes:
    """Tiny valid WAV: 24 kHz mono 16-bit, 0.25 s of a 440 Hz sine."""
    rate = 24000
    nframes = rate // 4  # 0.25 s
    frames = b"".join(
        struct.pack("<h", int(0.4 * 32767 * math.sin(2 * math.pi * 440 * i / rate)))
        for i in range(nframes)
    )
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(frames)
    return buf.getvalue()


def run_self_test() -> int:
    """Prove DataURL voice encoding + request shapes + parse + write, offline."""
    print("== fetch_audio.py self-test (offline: no network, no key) ==")
    text = "Once upon a time, a little red raincoat waited by the door."
    fmt = "wav"  # the fixture payload is a WAV; validation is format-aware

    req = build_request(text, fmt)
    assert req == {
        "model": MODEL_DESIGN,
        "messages": [
            {"role": "user", "content": VOICE_DESIGN},
            {"role": "assistant", "content": text},
        ],
        "audio": {"format": fmt},
    }, req
    print(f"request  : {json.dumps(req, ensure_ascii=False)}")

    wav = build_fixture_wav()
    expected_len = 44 + (24000 // 4) * 2  # RIFF header + 0.25 s of s16 mono
    assert len(wav) == expected_len, (len(wav), expected_len)

    # ---- DataURL voice encoding (clone mode's audio.voice) -----------------
    assert sample_mime("sample.mp3") == "audio/mpeg", sample_mime("sample.mp3")
    assert sample_mime("sample.MP3") == "audio/mpeg", sample_mime("sample.MP3")
    assert sample_mime("sample.wav") == "audio/wav", sample_mime("sample.wav")
    try:
        sample_mime("sample.ogg")
    except ValueError:
        pass
    else:
        raise AssertionError("sample_mime must reject non-mp3/wav extensions")
    check_sample_size(MAX_SAMPLE_BYTES)  # exactly at the 10MB cap is fine
    try:
        check_sample_size(MAX_SAMPLE_BYTES + 1)  # one byte over the cap
    except ValueError:
        pass
    else:
        raise AssertionError("10MB sample cap not enforced")
    voice = sample_data_url(wav, "fixture.wav")  # stdlib wave fixture as sample
    assert voice.startswith("data:audio/wav;base64,"), voice[:32]
    assert base64.b64decode(voice.split(",", 1)[1]) == wav
    assert sample_data_url(wav, "fixture.mp3").startswith("data:audio/mpeg;base64,")

    creq = build_request(text, "mp3", mode="clone", voice=voice)
    assert creq == {
        "model": MODEL_CLONE,
        "messages": [
            {"role": "user", "content": CLONE_STYLE},
            {"role": "assistant", "content": text},
        ],
        "audio": {"format": "mp3", "voice": voice},
    }, creq
    assert creq["audio"]["voice"].startswith("data:audio/wav;base64,"), \
        "clone envelope must carry the DataURL voice prefix"
    try:
        build_request(text, "mp3", mode="clone")  # clone without a sample
    except ValueError:
        pass
    else:
        raise AssertionError("clone mode without voice must raise")
    print(f"voice    : mime per extension, 10MB cap check, clone envelope voice "
          f"prefix OK ({voice[:28]}..., {len(voice)} chars)")

    fake = {
        "choices": [{"message": {"audio": {"data": base64.b64encode(wav).decode("ascii")}}}]
    }
    print(
        "response : fake choices[0].message.audio.data "
        f"(base64 WAV 24 kHz mono 0.25 s sine -> {len(wav)} B)"
    )

    blob = parse_audio_data(fake)
    assert blob == wav, (len(blob), len(wav))
    problem = validate_clip(blob, fmt)
    assert problem is None, problem

    FIXTURE_PATH.parent.mkdir(parents=True, exist_ok=True)
    FIXTURE_PATH.write_bytes(blob)
    out = FIXTURE_PATH.read_bytes()
    assert out[:4] == b"RIFF", out[:4]  # RIFF magic
    assert out[8:12] == b"WAVE", out[8:12]
    assert len(out) == expected_len, (len(out), expected_len)  # byte length
    assert len(out) > MIN_BYTES, len(out)

    print(f"fixture  : {FIXTURE_PATH} ({len(out)} bytes)")
    print(f"PASS self-test: DataURL voice encoding, design+clone request shape, "
          f"response parse, write, RIFF magic, byte length {len(out)}")
    return 0


# ---------------------------------------------------------------------------
# base-sample workflow (--make-base / --use-base)
# ---------------------------------------------------------------------------

def run_make_base(takes: int, dry_run: bool) -> int:
    """Speak the fixed SPECIMEN through voicedesign ``takes`` times.

    Each take lands in ``tools/voice/candidate-{i}.mp3`` (1-based, overwritten
    on re-runs) for auditioning; the winner is then pinned with ``--use-base``.
    """
    if takes < 1:
        print("error: --takes must be >= 1", file=sys.stderr)
        return 2
    key: str | None = None
    if not dry_run:
        key = resolve_api_key()
        if not key:
            print(no_key_message(), file=sys.stderr)
            return 2
    fmt = "mp3"  # base samples are always mp3 -> tools/voice/base.mp3
    envelope = build_request(SPECIMEN, fmt)  # design mode, SPECIMEN as speech
    print(f"== fetch_audio.py --make-base --takes {takes} "
          f"{'--dry-run' if dry_run else 'run'} ==")
    print(f"  design prompt (user)      : {VOICE_DESIGN}")
    print(f"  specimen (assistant)      : {SPECIMEN}")
    print(f"  envelope sample           : {json.dumps(envelope, ensure_ascii=False)}")
    ok = failed = 0
    for i in range(1, takes + 1):
        dest = VOICE_DIR / f"candidate-{i}.mp3"
        if dry_run:
            print(f"  generate {dest}")
            continue
        try:
            blob = synthesize_clip(key or "", build_request(SPECIMEN, fmt), fmt)
        except Exception as err:
            failed += 1
            print(f"  failed   {dest} ({err})")
            continue
        VOICE_DIR.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(blob)
        ok += 1
        print(f"  ok       {dest} ({len(blob)} B)")
    if dry_run:
        print(f"totals: would generate {takes} candidate take(s); nothing written")
        return 0
    print(f"totals: ok {ok}, failed {failed} (audition, then --use-base N)")
    return 1 if failed else 0


def run_use_base(n: int) -> int:
    """Pin candidate take ``n`` as the clone anchor + write the provenance."""
    src = VOICE_DIR / f"candidate-{n}.mp3"
    if n < 1 or not src.is_file():
        have = sorted(p.name for p in VOICE_DIR.glob("candidate-*.mp3")) \
            if VOICE_DIR.is_dir() else []
        print(
            f"error: no candidate take {n}: {src} missing"
            + (f" (have: {', '.join(have)})" if have else " (run --make-base first)"),
            file=sys.stderr,
        )
        return 2
    blob = src.read_bytes()
    try:
        check_sample_size(len(blob))  # the API cap applies to the pinned sample
    except ValueError as err:
        print(f"error: {err}", file=sys.stderr)
        return 2
    n_takes = sum(1 for p in VOICE_DIR.glob("candidate-*.mp3") if p.is_file())
    VOICE_DIR.mkdir(parents=True, exist_ok=True)
    BASE_SAMPLE.write_bytes(blob)  # candidate-N.mp3 -> base.mp3
    record = {
        "designPrompt": VOICE_DESIGN,
        "specimen": SPECIMEN,
        "modelDesign": MODEL_DESIGN,
        "modelClone": MODEL_CLONE,
        "takes": n_takes,
        "chosenTake": n,
        "date": time.strftime("%Y-%m-%d"),
        "bytes": len(blob),
    }
    VOICE_JSON.write_text(
        json.dumps(record, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    duration = mp3_duration_s(blob)
    print("== fetch_audio.py --use-base ==")
    print(f"  base sample: {BASE_SAMPLE} <- {src.name} "
          f"({len(blob)} bytes{f', {duration} s' if duration else ''})")
    print(f"  provenance : {VOICE_JSON} (takes {n_takes}, chosen {n}, "
          f"date {record['date']})")
    print("  clone mode is now the auto default; run tools/fetch_books.py audio "
          "afterwards to stamp the voiceclone credit line")
    return 0


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="fetch_audio.py",
        description="Generate page-narration audio (Xiaomi MiMo TTS) into "
                    "library/books/{id}/audio/page-NN.{mp3,wav}.",
    )
    sel = parser.add_mutually_exclusive_group()
    sel.add_argument("--book", metavar="ID", help="one book id (e.g. 14838)")
    sel.add_argument(
        "--ids", metavar="ID,ID", help="comma-separated book ids (e.g. 14838,12294)"
    )
    sel.add_argument(
        "--all", action="store_true", help="every book dir under the library"
    )
    sel.add_argument(
        "--make-base",
        action="store_true",
        help="speak the fixed SPECIMEN through voicedesign --takes N times into "
             "tools/voice/candidate-N.mp3 for auditioning (overwrites takes)",
    )
    sel.add_argument(
        "--use-base",
        metavar="N",
        type=int,
        help="pin tools/voice/candidate-N.mp3 as tools/voice/base.mp3 and record "
             "the pick in tools/voice/voice.json",
    )
    parser.add_argument(
        "--takes",
        type=int,
        default=3,
        metavar="N",
        help="candidate takes for --make-base (default 3)",
    )
    parser.add_argument(
        "--mode",
        choices=MODES,
        default="auto",
        help="synthesis mode: clone (voiceclone anchored to the base sample), "
             "design (voicedesign per clip) or auto = clone when the base "
             "sample exists, else design (default auto)",
    )
    parser.add_argument(
        "--voice-sample",
        metavar="PATH",
        help="clone-mode base sample override (default tools/voice/base.mp3)",
    )
    parser.add_argument(
        "--format",
        choices=FORMATS,
        default="mp3",
        help="audio container for the clips (default mp3)",
    )
    parser.add_argument(
        "--force", action="store_true", help="regenerate clips that already exist"
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="print what would be generated; no network, no key needed",
    )
    parser.add_argument(
        "--self-test",
        action="store_true",
        help="offline fixture test of the request/response/write path "
             "(no network, no key)",
    )
    parser.add_argument(
        "--out",
        default=str(LIBRARY_DEFAULT),
        help=f"library books dir (default {LIBRARY_DEFAULT})",
    )
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    if args.self_test:
        return run_self_test()
    if args.make_base:
        return run_make_base(args.takes, args.dry_run)
    if args.use_base is not None:
        return run_use_base(args.use_base)

    if not (args.book or args.ids or args.all):
        print(
            "error: pick books with --book ID, --ids A,B or --all "
            "(or --self-test / --make-base / --use-base N)",
            file=sys.stderr,
        )
        return 2

    # Resolve the synthesis mode and encode the clone sample ONCE per run.
    sample = Path(args.voice_sample) if args.voice_sample else BASE_SAMPLE
    if args.voice_sample and not sample.is_file():
        print(f"error: voice sample not found: {sample}", file=sys.stderr)
        return 2
    mode = args.mode
    if mode == "auto":
        mode = "clone" if sample.is_file() else "design"
    voice: str | None = None
    if mode == "clone":
        if not sample.is_file():
            print(
                f"error: clone mode needs a base sample ({sample} missing) — "
                "build one with --make-base / --use-base or pass --voice-sample",
                file=sys.stderr,
            )
            return 2
        try:
            voice = load_sample_data_url(sample)  # encoded once per run
        except ValueError as err:
            print(f"error: {err}", file=sys.stderr)
            return 2

    books, errors = resolve_targets(args)
    if errors and not books:
        for err in errors:
            print(f"error: {err}", file=sys.stderr)
        return 2

    key: str | None = None
    if not args.dry_run:
        key = resolve_api_key()
        if not key:
            print(no_key_message(), file=sys.stderr)
            return 2

    fmt = args.format
    total = {"ok": 0, "failed": 0, "skipped": 0, "bytes": 0}
    failure_lines: list[str] = []
    blocks: list[str] = []
    for book_dir in books:
        try:
            stats, rows, failures = process_book(
                book_dir, fmt, key, args.force, args.dry_run, mode, voice
            )
        except (OSError, ValueError) as err:
            errors.append(f"book {book_dir.name}: {err}")
            continue
        for slot in total:
            total[slot] += stats[slot]
        failure_lines.extend(failures)
        blocks.extend(rows)
        blocks.append(
            f"  -> {book_dir / 'audio'}: ok {stats['ok']}, failed {stats['failed']}, "
            f"skipped {stats['skipped']}, {stats['bytes']} bytes"
        )

    print(f"== fetch_audio.py {'--dry-run' if args.dry_run else 'run'} -- final report ==")
    print(f"mode: {mode}" + (f" (voice sample: {sample})" if mode == "clone" else ""))
    print(REPORT_HEADER)
    for block in blocks:
        print(block)
    for err in errors:
        print(f"  ! {err}")
    for failure in failure_lines:
        print(f"  ! {failure}")
    print(
        f"totals ({fmt}, {mode}): ok {total['ok']}, failed {total['failed']}, "
        f"skipped {total['skipped']}, {total['bytes']} bytes"
    )
    return 1 if (errors or total["failed"]) else 0


if __name__ == "__main__":
    sys.exit(main())
