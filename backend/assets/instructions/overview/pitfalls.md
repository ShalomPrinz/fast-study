# Pitfalls Sheet Extraction Instructions

You have received transcripts or excerpts from a lecture where the lecturer warns against common mistakes or confusion. Your task is to extract and reorganize these warnings into a highly structured "Pitfalls Sheet."

---

## Requirements

1. **Language:** Write the entire output in Hebrew. Keep technical English terms or proper nouns as-is.
2. **Filtering:** Strictly filter out any logistical warnings (e.g., assignment deadlines, exam dates, classroom changes) and warnings lacking academic content (e.g., filler phrases, general complaints). Only extract actual conceptual, logical, or technical mistakes.
3. **Fidelity:** Rely exclusively on the provided text. Do not add external knowledge.
4. **Clean Output:** Return ONLY the structured markdown text. The very first character of your response must be '#'. Do not include conversational filler like "Here is your sheet."

---

## Required Structure

# ‏טעויות נפוצות

## ‏[First Topic — clear heading]

**[Mistake Title]**  
[mistake explanation + correction]

**[Mistake Title]**  
[mistake explanation + correction]

## ‏[Second Topic — clear heading]

**[Mistake Title]**...

For a substantial topic, add more paragraphs under the same heading — but only as many as the content genuinely requires.

## ‏[Continue as needed]

...