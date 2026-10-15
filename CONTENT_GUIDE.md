# Writing content for Stack & Study — a guide for Sassa

Chapters 1-4 are done as a working example. This is the pattern to follow
for Chapters 5-10. You don't need to touch any code — just fill in two
JSON files per batch and Luthando can load them.

## The two files you're filling in

**1. Lesson text** — one file per batch, e.g. `content_seed_ch5.json`

```json
{
  "sections": {
    "5.0": "Your lesson text for section 5.0 goes here...",
    "5.1": "Your lesson text for section 5.1 goes here..."
  }
}
```

**2. Checkpoint questions** — e.g. `quiz_bank_seed_ch5.json`

```json
{
  "quizzes": [
    {
      "section_number": "5.1",
      "question": "Your question here?",
      "options": ["Option A", "Option B", "Option C"],
      "correct_index": 1,
      "difficulty": "core"
    }
  ]
}
```
`correct_index` counts from 0 — so `1` means the second option in the list
is correct. `difficulty` can be `"core"`, `"stretch"` (harder, optional
depth), or `"review"` (a simpler re-ask for a struggling student).

The exact section numbers to use (e.g. "5.1", "5.2.2") are listed in
`data/curriculum_seed.json` — that file has the full Chapter 5-10 structure
already loaded, you're just writing the content for it.

## Writing the lesson text itself

A few rules that matter:

- **Write it fresh, in your own words** — don't copy from the source
  workbook PDF directly. Explain the idea the way you'd actually say it to
  a student in the room, not the workbook's exact sentences. This matters
  both for copyright and because your voice is more useful to students
  than the original textbook phrasing anyway.
- **150-250 words per section** is about right. Long enough to actually
  teach the idea, short enough that a student reads it in one sitting on
  a workstation screen.
- **Localize where it helps** — Mossel Bay/Ekasi examples land better
  than generic ones. Look at how 2.1 uses "the taxi you took this
  morning" instead of a random example.
- **Use Satoshi's voice for framing, not the whole section** — the app
  already wraps each section with a short Satoshi intro automatically.
  Your `content_md` text is the actual lesson body underneath that.
- **It's fine to reference other chapters** — "we'll cover this properly
  in Chapter 8" is good, it sets expectations and stops students getting
  confused.
- **Flag activities in the text if relevant** — e.g. "Activity: try the
  Mempool exercise before reading on," matching the activity_title
  already loaded for that section.

## Writing checkpoint questions

- **2-3 questions per section is plenty** — not every single section
  needs one; pick the ones where a student's understanding is easy to
  check (skip pure discussion sections like "Class Discussion:...").
- **One clearly correct answer, two plausible wrong ones** — a wrong
  answer that's obviously silly doesn't test anything.
- Look at the Chapter 1-2 and 3-4 questions already written
  (`quiz_bank_seed.json` and `quiz_bank_seed_ch3_4.json`) as a model for
  tone and difficulty.

## Once a chapter's files are ready

Luthando runs (no code changes needed):

```bash
node scripts/seed_content.js content_seed_ch5.json
node scripts/seed_quiz.js quiz_bank_seed_ch5.json
```

(swap in whatever filename you used, and whichever chapter). These are
safe to re-run if you go back and edit something — it just overwrites the
same section with the latest text.

## Suggested order

Chapter 5 and 6 next — they're the bridge into Bitcoin itself, and
probably the sections where students will lean on Satoshi's chat the
most, so getting solid grounding text in early is worth prioritizing
over the more practical "how-to" chapters (7-9), which can lean more on
step-by-step instructions than deep explanation anyway.
