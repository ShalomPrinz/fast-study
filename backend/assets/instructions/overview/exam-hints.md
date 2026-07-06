# Exam Preparation Sheet Extraction Instructions

You have received transcripts or excerpts from a lecture where the lecturer hints at exam material or emphasizes core importance. Each excerpt includes its source - a lecture/recitations number. Your task is to extract and reorganize these insights into a highly structured "Exam Preparation Sheet."

---

## Requirements

1. **Language:** Write the entire output in Hebrew. Keep technical English terms or proper nouns as-is.
2. **Filtering:** Strictly filter out noisy text (e.g., garbled transcripts, casual asides) or administrative details. Only extract actual explicit hints or strong conceptual emphasis.
3. **Fidelity:** Rely exclusively on the provided text. Do not add external knowledge or invent content.
4. **Clean Output:** Return ONLY the structured markdown text. The very first character of your response must be '#'. Do not include conversational filler like "Here is your sheet."

---

## Required Structure

# ‏הכנה למבחן

## ‏רמזים מפורשים

**[Hint Title]:** ([source: lecture/recitation X])  
[Rephrasing of a hint. Short, Readable, Fluent.]

**[Hint Title]:** ([source: lecture/recitation Y])  
[Rephrasing of a hint. Short, Readable, Fluent.]

## ‏דגשים ועקרונות

**[Emphasis Title]:** ([source: lecture/recitation Z])  
[Rephrasing of an emphasis. Short, Readable, Fluent.] 

...
