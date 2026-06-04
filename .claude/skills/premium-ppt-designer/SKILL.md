---
name: "Premium PPT Designer — AI-Powered Slides"
description: |
  Full-stack PowerPoint generation skill for creating premium, on-brand, classroom-ready,
  and data-anchored presentations. Uses python-pptx with Montserrat typography, a curated
  color system, and strict layout principles derived from professional templates. Covers
  AI explainability decks, classroom discussion/management integrations, interactive
  engagement designs, and any subject-matter content the system ingests.
triggers:
  - "create presentation"
  - "make slides"
  - "build pptx"
  - "design deck"
  - "classroom slides"
  - "ai explainability deck"
  - "premium ppt"
  - "data-driven slides"
---

# Premium PPT Designer — Complete Guide

## What This Skill Does

Generates `.pptx` files programmatically using **python-pptx** with a strict design
system inspired by three reference template families:

| Template Family | Color Anchor | Personality |
|---|---|---|
| Bold Startup (Brown/Ash) | `#292B2D` dark + `#F6F4F1` cream | Strong, editorial |
| Minimalist Pitch (Cream/Orange) | `#FFFDF4` + `#FE8213` orange | Clean, strategic |
| Company Profile (Blue/Yellow) | `#003E7F` navy + `#FFB300` amber | Corporate, trustworthy |

All output uses **Montserrat** as the primary typeface, enforces a consistent grid,
and anchors every content slide to data, evidence, or a learning objective.

---

## Design System

### Typography Scale (Montserrat)

| Role | Weight | Size (pt) | Usage |
|---|---|---|---|
| Hero Title | Black (900) | 72–96 | Cover slide only |
| Section Title | ExtraBold (800) | 40–52 | Chapter/divider slides |
| Slide Headline | Bold (700) | 28–36 | Every content slide |
| Sub-heading | SemiBold (600) | 18–22 | Labels, callouts, tags |
| Body Copy | Regular (400) | 13–16 | Paragraphs, bullets |
| Caption / Stat Label | Light (300) | 10–12 | Data footnotes, credits |
| Big Stat | ExtraBold (800) | 48–64 | KPI, metric callouts |

**Rule**: Never mix more than 2 weights on a single slide. Heading + Body is the safe pair.

### Color Palettes

#### Palette A — "Volt" (AI / Tech / Premium)
```
Background   #0D0D0D   (near-black)
Surface      #1A1A2E   (dark blue-navy)
Accent 1     #F5C518   (electric amber)  — Montserrat Black text on it
Accent 2     #00D4FF   (cyan)
Text Primary #FFFFFF
Text Muted   #9B9B9B
Border       #2A2A3E
```

#### Palette B — "Sunstroke" (Classroom / Engaging / Warm)
```
Background   #FDFAF4   (cream white)
Surface      #292B2D   (charcoal)
Accent 1     #F5A623   (amber)
Accent 2     #E03E3E   (coral red)
Accent 3     #3E7BFA   (blue)
Text Primary #1A1A1A
Text Muted   #6B6B6B
Border       #E0D9CF
```

#### Palette C — "Blueprint" (Corporate / Data / Academic)
```
Background   #FFFFFF
Surface      #003E7F   (deep blue)
Accent 1     #FFB300   (gold amber)
Accent 2     #00A878   (teal)
Text Primary #1C1C1C
Text Muted   #5A6472
Border       #D8E4F0
```

### Choose a palette when:
- AI / tech / innovation topics → **Palette A (Volt)**
- Classroom discussion, engagement, warm subjects → **Palette B (Sunstroke)**
- Data reports, corporate, academic → **Palette C (Blueprint)**

---

## Slide Architecture

### Slide Canvas
- **Dimensions**: 20" × 11.25" (widescreen 16:9, 1920×1080 equivalent at 96 DPI)
- **Safe zone margins**: 1.0" all sides (leave as breathing room)
- **Column grid**: 2-column (9.5" + 9.5") or 3-column (6.0" + 6.0" + 6.0") with 0.25" gutter
- **Baseline grid**: 0.5" vertical rhythm increments

### Slide Types & Layout Rules

#### 1. Cover Slide
```
┌─────────────────────────────────────────┐
│  [Full-bleed background color/image]    │
│                                         │
│  [Brand mark top-left 1.5"×0.75"]      │
│                                         │
│  [Hero title — left-aligned, bottom     │
│   third, Montserrat Black, 72–96pt]    │
│                                         │
│  [Sub-title 18–22pt, muted color]      │
│  [Presenter name / date line 12pt]     │
│                                         │
│  [Accent color bar 0.08" × full width  │
│   at very bottom]                       │
└─────────────────────────────────────────┘
```

#### 2. Section Divider
```
┌──────────┬──────────────────────────────┐
│          │                              │
│ [Accent  │  SECTION 01                  │
│  block   │                              │
│  ~35%]   │  Section Title               │
│          │  (Montserrat ExtraBold 48pt) │
│          │                              │
│          │  One-sentence descriptor     │
└──────────┴──────────────────────────────┘
```

#### 3. Content — Text + Visual (50/50)
```
┌──────────────────┬──────────────────────┐
│  Headline 28pt   │                      │
│  ─────────────   │  [Image / Chart /    │
│  Body text 14pt  │   Diagram]           │
│  • Bullet 1      │                      │
│  • Bullet 2      │                      │
│  • Bullet 3      │                      │
│                  │                      │
│  [Data anchor]   │                      │
└──────────────────┴──────────────────────┘
```

#### 4. Big Stat / KPI
```
┌─────────────────────────────────────────┐
│  Slide Headline (top)                   │
│                                         │
│     ┌────────┐  ┌────────┐  ┌────────┐ │
│     │  74%   │  │  $12B  │  │ 18–40  │ │
│     │ label  │  │ label  │  │ label  │ │
│     │ detail │  │ detail │  │ detail │ │
│     └────────┘  └────────┘  └────────┘ │
│                                         │
│  Source / data anchor (12pt, muted)    │
└─────────────────────────────────────────┘
```

#### 5. Classroom Discussion Slide
```
┌─────────────────────────────────────────┐
│  [Discussion icon / badge top-right]    │
│                                         │
│  DISCUSSION PROMPT (label, accent)     │
│                                         │
│  "Central question in large bold text" │
│                                         │
│  ┌──────────┐ ┌──────────┐ ┌─────────┐ │
│  │ Think    │ │ Pair     │ │ Share   │ │
│  │ (30 sec) │ │ (1 min)  │ │ (group) │ │
│  └──────────┘ └──────────┘ └─────────┘ │
│                                         │
│  Learning Objective: LO #N             │
└─────────────────────────────────────────┘
```

#### 6. Data Anchor Slide
```
┌─────────────────────────────────────────┐
│  Headline                               │
│                                         │
│  [Chart / Infographic — 60% of canvas] │
│                                         │
│  ─────────────────────────────────────  │
│  Key Insight (16pt, accent color)      │
│  Source: [citation] | Date: [year]     │
└─────────────────────────────────────────┘
```

---

## Data Anchoring Rules

Every slide that makes a claim **must** carry a data anchor. The anchor lives in a
bottom strip (0.3" height, muted text 10–11pt):

```
Source: [Author/Org, Year] | n=[sample] | CI=[confidence] | Updated: [YYYY-MM]
```

When no external source is available, anchor to the prompt/brief that generated the
content:

```
Generated from: [topic keyword] | Session: [date] | Validated by: AI reasoning
```

**Anchor types by slide purpose:**

| Slide Purpose | Anchor Type |
|---|---|
| Market data, statistics | Citation (author, year, URL) |
| AI-generated insight | Model inference label + topic tag |
| Classroom content | Curriculum standard (e.g., CEFR B2, Bloom's L3) |
| Case study | Company + year + metric |
| Process / framework | Standard or framework name (ISO, ADDIE, etc.) |

---

## On-Brand Color Application Rules

1. **60–30–10 rule**: 60% background, 30% surface/neutral, 10% accent
2. **Accent color** is used ONLY on: headline underlines, stat callout boxes, icon fills, CTA buttons, data bars
3. **Never** put accent on large background areas except cover and divider slides
4. **Contrast**: All text must meet WCAG AA (4.5:1 for body, 3:1 for large text)
5. **Dark slides** (Palette A): use white for primary text, muted for secondary
6. **Light slides** (Palette B/C): use near-black `#1A1A1A` for primary text

---

## Classroom & Educational Design Patterns

### Think–Pair–Share Layout
Place three equal-width cards (accent border) with labels: **Think**, **Pair**, **Share**.
Each card contains a time indicator (e.g., "2 min") and a micro-prompt.

### Learning Objective Badge
Top-right corner: small rounded rectangle, accent fill, white text:
`LO #N` or `Bloom's: [Level]`

### Engagement Indicators
Use colored left-border bars on bullet items to signal interaction type:
- Amber border → individual reflection
- Blue border → group activity
- Red border → debate / challenge point
- Green border → application / hands-on

### Classroom Management Integration
Include a persistent footer band (0.25" height) across instructional slides with:
- Slide number
- Time allocation (e.g., "3 min")
- Interaction mode icon (lecture / discussion / activity / assessment)

---

## Interactive / Engagement Design

### Animation-Ready Indicators
Even in static PPTX, structure shapes with `_anim_` prefix in alt-text to signal
to facilitators which elements should animate on click.

### Clickable Zones (Hyperlink Targets)
For interactive decks, define named shapes with hyperlinks using `AddHyperlink`
pointing to other slides (navigation hub pattern):

```
[Overview] → Slide 1
[Topic A]  → Slide 5
[Topic B]  → Slide 10
[Quiz]     → Slide 18
[Summary]  → Slide 22
```

### Gamification Elements
- Progress bar (thin accent strip at bottom, width scales per section)
- Star / badge shapes on recap slides
- Score placeholder boxes for live polling results

---

## python-pptx Implementation Guide

### Setup

```bash
pip install python-pptx Pillow requests
```

### Base Template Builder

```python
from pptx import Presentation
from pptx.util import Inches, Pt, Emu
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN
from pptx.util import Inches, Pt

# Canvas: 20" × 11.25" (standard widescreen)
SLIDE_W = Inches(20)
SLIDE_H = Inches(11.25)

# Palette A — Volt (AI / Tech)
PALETTE_A = {
    "bg":       RGBColor(0x0D, 0x0D, 0x0D),
    "surface":  RGBColor(0x1A, 0x1A, 0x2E),
    "accent1":  RGBColor(0xF5, 0xC5, 0x18),
    "accent2":  RGBColor(0x00, 0xD4, 0xFF),
    "text":     RGBColor(0xFF, 0xFF, 0xFF),
    "muted":    RGBColor(0x9B, 0x9B, 0x9B),
}

# Palette B — Sunstroke (Classroom)
PALETTE_B = {
    "bg":       RGBColor(0xFD, 0xFA, 0xF4),
    "surface":  RGBColor(0x29, 0x2B, 0x2D),
    "accent1":  RGBColor(0xF5, 0xA6, 0x23),
    "accent2":  RGBColor(0xE0, 0x3E, 0x3E),
    "accent3":  RGBColor(0x3E, 0x7B, 0xFA),
    "text":     RGBColor(0x1A, 0x1A, 0x1A),
    "muted":    RGBColor(0x6B, 0x6B, 0x6B),
}

# Palette C — Blueprint (Corporate / Academic)
PALETTE_C = {
    "bg":       RGBColor(0xFF, 0xFF, 0xFF),
    "surface":  RGBColor(0x00, 0x3E, 0x7F),
    "accent1":  RGBColor(0xFF, 0xB3, 0x00),
    "accent2":  RGBColor(0x00, 0xA8, 0x78),
    "text":     RGBColor(0x1C, 0x1C, 0x1C),
    "muted":    RGBColor(0x5A, 0x64, 0x72),
}

def new_deck(palette=PALETTE_A):
    prs = Presentation()
    prs.slide_width = SLIDE_W
    prs.slide_height = SLIDE_H
    return prs, palette

def add_bg(slide, color: RGBColor, prs):
    """Fill slide background with solid color."""
    from pptx.util import Inches
    bg = slide.background
    fill = bg.fill
    fill.solid()
    fill.fore_color.rgb = color

def add_rect(slide, left, top, width, height, fill_color, alpha=None):
    """Add a filled rectangle shape."""
    from pptx.util import Inches
    shape = slide.shapes.add_shape(
        1,  # MSO_SHAPE_TYPE.RECTANGLE
        Inches(left), Inches(top), Inches(width), Inches(height)
    )
    shape.fill.solid()
    shape.fill.fore_color.rgb = fill_color
    shape.line.fill.background()
    return shape

def add_text(slide, text, left, top, width, height,
             font_name="Montserrat", font_size=24, bold=False,
             color=RGBColor(0xFF, 0xFF, 0xFF), align=PP_ALIGN.LEFT,
             italic=False, wrap=True):
    """Add a text box with Montserrat styling."""
    txBox = slide.shapes.add_textbox(
        Inches(left), Inches(top), Inches(width), Inches(height)
    )
    tf = txBox.text_frame
    tf.word_wrap = wrap
    p = tf.paragraphs[0]
    p.alignment = align
    run = p.add_run()
    run.text = text
    run.font.name = font_name
    run.font.size = Pt(font_size)
    run.font.bold = bold
    run.font.italic = italic
    run.font.color.rgb = color
    return txBox

def add_accent_bar(slide, prs, palette, height_in=0.06):
    """Add accent color bar at the very bottom of the slide."""
    w = prs.slide_width.inches
    h = prs.slide_height.inches
    add_rect(slide, 0, h - height_in, w, height_in, palette["accent1"])

def add_slide_number(slide, prs, num, palette):
    """Add slide number bottom-right."""
    w = prs.slide_width.inches
    h = prs.slide_height.inches
    add_text(slide, str(num),
             left=w - 1.2, top=h - 0.55, width=0.8, height=0.35,
             font_size=11, color=palette["muted"], align=PP_ALIGN.RIGHT)

def add_data_anchor(slide, prs, source_text, palette):
    """Add data source anchor strip at bottom."""
    w = prs.slide_width.inches
    h = prs.slide_height.inches
    add_text(slide, f"Source: {source_text}",
             left=1.0, top=h - 0.55, width=w - 2.5, height=0.35,
             font_size=10, color=palette["muted"])

def add_lo_badge(slide, prs, lo_text, palette):
    """Add Learning Objective badge top-right."""
    w = prs.slide_width.inches
    badge = add_rect(slide, w - 2.8, 0.3, 2.5, 0.45,
                     fill_color=palette["accent1"])
    add_text(slide, lo_text,
             left=w - 2.75, top=0.33, width=2.4, height=0.38,
             font_size=11, bold=True,
             color=RGBColor(0x1A, 0x1A, 0x1A), align=PP_ALIGN.CENTER)
```

### Cover Slide Builder

```python
def make_cover(prs, palette, title, subtitle="", presenter="", date=""):
    blank_layout = prs.slide_layouts[6]
    slide = prs.slides.add_slide(blank_layout)
    add_bg(slide, palette["bg"], prs)

    W = prs.slide_width.inches
    H = prs.slide_height.inches

    # Accent left-edge vertical bar
    add_rect(slide, 0, 0, 0.35, H, palette["accent1"])

    # Hero title
    add_text(slide, title,
             left=1.1, top=H * 0.42, width=W * 0.72, height=H * 0.3,
             font_size=72, bold=True, color=palette["text"])

    # Subtitle
    if subtitle:
        add_text(slide, subtitle,
                 left=1.1, top=H * 0.72, width=W * 0.65, height=0.7,
                 font_size=20, color=palette["muted"])

    # Presenter + date
    line = " | ".join(filter(None, [presenter, date]))
    if line:
        add_text(slide, line,
                 left=1.1, top=H - 1.0, width=W * 0.5, height=0.45,
                 font_size=12, color=palette["muted"])

    add_accent_bar(slide, prs, palette)
    return slide
```

### Section Divider Builder

```python
def make_divider(prs, palette, section_num, section_title, descriptor=""):
    blank_layout = prs.slide_layouts[6]
    slide = prs.slides.add_slide(blank_layout)
    add_bg(slide, palette["bg"], prs)

    W = prs.slide_width.inches
    H = prs.slide_height.inches

    # Left accent block (35% width)
    add_rect(slide, 0, 0, W * 0.35, H, palette["accent1"])

    # Section number on accent block
    add_text(slide, f"{section_num:02d}",
             left=0.4, top=H * 0.35, width=W * 0.28, height=H * 0.3,
             font_size=96, bold=True,
             color=RGBColor(0xFF, 0xFF, 0xFF) if palette == PALETTE_A
             else RGBColor(0x1A, 0x1A, 0x1A),
             align=PP_ALIGN.CENTER)

    # Section title on right
    add_text(slide, f"SECTION {section_num:02d}",
             left=W * 0.38, top=H * 0.28, width=W * 0.58, height=0.5,
             font_size=13, bold=True, color=palette["muted"])

    add_text(slide, section_title,
             left=W * 0.38, top=H * 0.38, width=W * 0.58, height=H * 0.3,
             font_size=46, bold=True, color=palette["text"])

    if descriptor:
        add_text(slide, descriptor,
                 left=W * 0.38, top=H * 0.68, width=W * 0.56, height=0.6,
                 font_size=16, color=palette["muted"])

    add_accent_bar(slide, prs, palette)
    return slide
```

### Content Slide Builder (Text + Visual)

```python
def make_content_slide(prs, palette, headline, bullets, data_source="",
                       slide_num=None, lo_badge=None, time_alloc=None):
    blank_layout = prs.slide_layouts[6]
    slide = prs.slides.add_slide(blank_layout)
    add_bg(slide, palette["bg"], prs)

    W = prs.slide_width.inches
    H = prs.slide_height.inches

    # Headline
    add_text(slide, headline,
             left=1.0, top=0.55, width=W - 2.0, height=0.9,
             font_size=30, bold=True, color=palette["text"])

    # Accent underline for headline
    add_rect(slide, 1.0, 1.4, 2.5, 0.055, palette["accent1"])

    # Bullet content
    y = 1.7
    for bullet in bullets:
        icon = "▸ "
        add_text(slide, icon + bullet,
                 left=1.2, top=y, width=W - 2.5, height=0.5,
                 font_size=15, color=palette["text"])
        y += 0.6

    if lo_badge:
        add_lo_badge(slide, prs, lo_badge, palette)

    # Footer: time allocation + slide number + data anchor
    footer_y = H - 0.55
    if time_alloc:
        add_text(slide, f"⏱ {time_alloc}",
                 left=1.0, top=footer_y, width=1.8, height=0.35,
                 font_size=10, color=palette["accent1"])

    if data_source:
        add_data_anchor(slide, prs, data_source, palette)

    if slide_num:
        add_slide_number(slide, prs, slide_num, palette)

    add_accent_bar(slide, prs, palette)
    return slide
```

### KPI / Big Stat Slide Builder

```python
def make_kpi_slide(prs, palette, headline, stats, data_source="", slide_num=None):
    """
    stats = [{"value": "74%", "label": "Remote workers", "detail": "seek focus environments"}]
    """
    blank_layout = prs.slide_layouts[6]
    slide = prs.slides.add_slide(blank_layout)
    add_bg(slide, palette["bg"], prs)

    W = prs.slide_width.inches
    H = prs.slide_height.inches

    add_text(slide, headline,
             left=1.0, top=0.5, width=W - 2.0, height=0.8,
             font_size=28, bold=True, color=palette["text"])
    add_rect(slide, 1.0, 1.25, 1.8, 0.055, palette["accent1"])

    # Stat cards — auto-distribute horizontally
    n = len(stats)
    card_w = (W - 2.5) / n
    gutter = 0.25
    x = 1.0
    for stat in stats:
        # Card background
        add_rect(slide, x, 2.0, card_w - gutter, H * 0.52, palette["surface"])
        # Big value
        add_text(slide, stat["value"],
                 left=x + 0.2, top=2.2, width=card_w - gutter - 0.4, height=1.4,
                 font_size=56, bold=True, color=palette["accent1"],
                 align=PP_ALIGN.CENTER)
        # Label
        add_text(slide, stat["label"],
                 left=x + 0.15, top=3.7, width=card_w - gutter - 0.3, height=0.5,
                 font_size=13, bold=True, color=palette["text"],
                 align=PP_ALIGN.CENTER)
        # Detail
        if stat.get("detail"):
            add_text(slide, stat["detail"],
                     left=x + 0.15, top=4.25, width=card_w - gutter - 0.3, height=0.8,
                     font_size=11, color=palette["muted"],
                     align=PP_ALIGN.CENTER)
        x += card_w

    if data_source:
        add_data_anchor(slide, prs, data_source, palette)
    if slide_num:
        add_slide_number(slide, prs, slide_num, palette)

    add_accent_bar(slide, prs, palette)
    return slide
```

### Classroom Discussion Slide Builder

```python
def make_discussion_slide(prs, palette, prompt, tps_times=("30 sec","1 min","2 min"),
                          lo_badge=None, slide_num=None):
    blank_layout = prs.slide_layouts[6]
    slide = prs.slides.add_slide(blank_layout)
    add_bg(slide, palette["bg"], prs)

    W = prs.slide_width.inches
    H = prs.slide_height.inches

    # DISCUSSION label badge
    add_rect(slide, 1.0, 0.5, 3.2, 0.5, palette["accent2"])
    add_text(slide, "DISCUSSION PROMPT",
             left=1.05, top=0.52, width=3.1, height=0.42,
             font_size=12, bold=True,
             color=RGBColor(0xFF, 0xFF, 0xFF), align=PP_ALIGN.CENTER)

    # Central question
    add_text(slide, f'"{prompt}"',
             left=1.0, top=1.3, width=W - 2.0, height=2.2,
             font_size=32, bold=True, color=palette["text"],
             italic=True)

    # Think–Pair–Share cards
    labels = ["Think", "Pair", "Share"]
    card_colors = [palette["accent1"], palette["accent2"],
                   palette.get("accent3", palette["accent1"])]
    card_w = (W - 2.5) / 3
    x = 1.0
    for label, t, c in zip(labels, tps_times, card_colors):
        add_rect(slide, x, 4.0, card_w - 0.25, 1.8, c)
        add_text(slide, label,
                 left=x + 0.1, top=4.1, width=card_w - 0.45, height=0.55,
                 font_size=20, bold=True,
                 color=RGBColor(0x1A, 0x1A, 0x1A), align=PP_ALIGN.CENTER)
        add_text(slide, t,
                 left=x + 0.1, top=4.7, width=card_w - 0.45, height=0.4,
                 font_size=13,
                 color=RGBColor(0x1A, 0x1A, 0x1A), align=PP_ALIGN.CENTER)
        x += card_w

    if lo_badge:
        add_lo_badge(slide, prs, lo_badge, palette)
    if slide_num:
        add_slide_number(slide, prs, slide_num, palette)

    add_accent_bar(slide, prs, palette)
    return slide
```

---

## AI Explainability Deck — Standard Structure

Use this 10-slide arc when the subject is **how AI thinks, creates, and builds premium content**:

| # | Slide Type | Title | Data Anchor |
|---|---|---|---|
| 1 | Cover | [Topic]: Powered by AI | — |
| 2 | Divider | Section 01 — What AI Sees | — |
| 3 | Content (text+visual) | Tokens: How AI Reads the World | NLP research citation |
| 4 | KPI | AI by the Numbers | Benchmark dataset |
| 5 | Content | Pattern Recognition → Creativity | Model architecture ref |
| 6 | Divider | Section 02 — How AI Creates | — |
| 7 | Content | From Prompt to Output: The Pipeline | System prompt provenance |
| 8 | Discussion | "What does 'creativity' mean for a machine?" | Bloom's L4 |
| 9 | Content | Premium Output: AI Design Principles | Template standards |
| 10 | Cover (outro) | Key Takeaways + Next Steps | Session date |

---

## Classroom Subject Deck — Standard Structure

| # | Slide Type | Content | Engagement Mode |
|---|---|---|---|
| 1 | Cover | Subject + Grade Level | — |
| 2 | Content | Learning Objectives (LO 1–3) | Lecture |
| 3 | Content | Concept Activation — Prior Knowledge | Individual |
| 4–N | Content | Core instruction (one concept per slide) | Lecture/Activity |
| N+1 | Discussion | Think–Pair–Share on central concept | Group |
| N+2 | KPI | Key Facts / Data from Topic | Lecture |
| N+3 | Content | Application Activity | Hands-on |
| N+4 | Content | Summary — Connect back to LOs | Lecture |
| N+5 | Content | Assessment / Exit Ticket | Individual |

---

## Full Deck Generation — End-to-End Example

```python
import os
from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN

# (paste all helper functions above here)

def build_ai_deck(output_path="ai_premium_slides.pptx"):
    prs, pal = new_deck(PALETTE_A)

    # 1. Cover
    make_cover(prs, pal,
               title="HOW AI THINKS\nAND CREATES",
               subtitle="From token patterns to premium slide design",
               presenter="AI Design System", date="2026")

    # 2. Section divider
    make_divider(prs, pal, 1, "What AI Sees",
                 "Perception, tokens, and pattern recognition")

    # 3. Content
    make_content_slide(prs, pal,
        headline="Tokens: The Building Blocks of AI Understanding",
        bullets=[
            "Every word is split into sub-word tokens (avg. 0.75 words/token)",
            "GPT-4 processes up to 128,000 tokens per context window",
            "Attention mechanisms score each token's relationship to every other",
            "High-attention pairs form the semantic 'meaning layer'",
        ],
        data_source="OpenAI Technical Report, 2024 | Transformer Architecture, Vaswani et al. 2017",
        slide_num=3, lo_badge="LO #1 — Recall", time_alloc="4 min")

    # 4. KPI
    make_kpi_slide(prs, pal,
        headline="AI by the Numbers",
        stats=[
            {"value": "1.8T", "label": "Parameters", "detail": "GPT-4 estimated scale"},
            {"value": "45TB", "label": "Training Data", "detail": "Deduplicated text corpus"},
            {"value": "0.3s", "label": "Inference", "detail": "Avg. response latency"},
            {"value": "96.4%", "label": "Accuracy", "detail": "MMLU benchmark (5-shot)"},
        ],
        data_source="Epoch AI, 2024 | MMLU Benchmark, Hendrycks et al.",
        slide_num=4)

    # 5. Discussion
    make_discussion_slide(prs, pal,
        prompt="If an AI never experienced the world, how can it generate original ideas?",
        tps_times=("30 sec", "1 min", "2 min"),
        lo_badge="LO #3 — Analyze", slide_num=5)

    prs.save(output_path)
    print(f"Saved: {output_path}")
    return output_path

if __name__ == "__main__":
    build_ai_deck()
```

---

## Quick Commands

```bash
# Generate AI explainability deck (Palette A — Volt)
python3 -c "
import sys; sys.path.insert(0, 'src')
from ppt_designer import build_ai_deck
build_ai_deck('output/ai_thinks_creates.pptx')
"

# Generate classroom deck (Palette B — Sunstroke)
python3 src/ppt_designer.py --subject "Climate Change" --grade 10 \
  --palette sunstroke --los 3 --out output/climate_deck.pptx

# Generate data-driven corporate deck (Palette C — Blueprint)
python3 src/ppt_designer.py --subject "Q2 Performance" \
  --palette blueprint --kpi-file data/q2_kpis.json --out output/q2_report.pptx
```

---

## Quality Checklist

Before saving any deck, verify:

- [ ] Every slide has a headline in Montserrat Bold ≥ 28pt
- [ ] Accent color used only on ≤ 10% of slide area (except cover/divider)
- [ ] Every data claim has a source anchor
- [ ] No more than 5 bullet points per slide
- [ ] Slide numbers present on all content slides
- [ ] LO badges present on all instructional slides
- [ ] Time allocations set on all classroom slides
- [ ] WCAG AA contrast check passed (use `check_contrast(fg, bg)` helper)
- [ ] Font is Montserrat (fallback: Arial if Montserrat unavailable)
- [ ] File saved to `/output/` not root

---

## File Layout Convention

```
project/
├── src/
│   └── ppt_designer.py      # All builder functions
├── output/                  # Generated .pptx files
├── data/                    # JSON data feeds for KPI slides
└── assets/
    └── images/              # Photos/charts inserted into slides
```

---

**Category**: Design / Education / AI Communication
**Palette Options**: Volt (AI), Sunstroke (Classroom), Blueprint (Corporate)
**Font**: Montserrat (all weights)
**Output**: `.pptx` via python-pptx
**Estimated Setup**: 5 min | Deck generation: 30 sec per 10 slides
