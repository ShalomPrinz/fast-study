1. **Implement**
Read the prompt file passed as argument. If it contains a "Depends on" section, verify those dependencies are already implemented — if not, inform the user and ask whether to implement them now or stop and handle them manually. Then implement everything described in the prompt file.

2. **Verify**
Review the User Raw Description and the modified files to execute a combined verification: trace the UI "happy path", test related edge cases, and check for regression risks from docs/ERRORS.md; then, list every specific user requirement from the prompt, marking each as ✅ or ❌, and do not declare the task complete until all ❌ items are fixed and any missing tests are written.

Tell the user (in your response, not in any file) shortly about any instructions or requirements you decided to defer or ignore.