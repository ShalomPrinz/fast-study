# FAQ Sheet Extraction Instructions

You have received transcripts or excerpts around student questions, including moments where the lecturer quieted the class to hear a question. Your task is to reconstruct and reorganize these interactions into a highly structured "FAQ Sheet."

---

## Requirements

1. **Language:** Write the entire output in Hebrew. Keep technical English terms or proper nouns as-is.
2. **Filtering:** Strictly filter out any logistical questions (e.g., deadlines, homework assignments, grades). Only extract actual conceptual, logical, or theoretical questions.
3. **Fidelity:** Rely exclusively on the provided text. Do not add external knowledge.
4. **Scope Limitation:** Strictly ignore non-academic or administrative queries, including tactical or logistical questions (e.g., questions regarding "when," "where," schedule adjustments). Only process core course material and academic content.
5. **Clean Output:** Return ONLY the structured markdown text. The very first character of your response must be '#'. Do not include conversational filler like "Here is your sheet."

---

## Required Structure

# ‏שאלות ותשובות

## ‏[First Topic — clear heading]

**שאלה: [shortened question]**  
[proffesor answer + main takeaways]

**שאלה: [shortened question]**  
[proffesor answer + main takeaways]

## ‏[Second Topic — clear heading]

**שאלה: [shortened question]**  
[proffesor answer + main takeaways]

...
