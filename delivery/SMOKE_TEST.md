# Release smoke test — the manual half

`build.yml`'s smoke job covers everything that needs no account, key or human. This list is what a
runner cannot reach. Run it on a real Windows machine, against the `installer` artifact of the
commit's green `build.yml` run, before dispatching `publish.yml` — all but the last item, which
needs the release live. Download the artifact in a browser and extract it with Windows Explorer, so the `.exe` keeps
the Mark-of-the-Web the SmartScreen item needs.

- [ ] **SmartScreen.** Start the extracted installer: "More info → Run anyway" gets past "Windows
      protected your PC".
- [ ] **A clean machine.** Install on a Windows with no developer tools or extra VC++ runtimes; the
      app boots and renders a PDF.
- [ ] **Moodle connect.** Connect the account, completing MFA by hand.
- [ ] **Drive.** Turn Drive on, finish Google consent, and a lecture's PDF uploads.
- [ ] **Real keys.** One real lecture with real Groq and Gemini keys, video to PDF.
- [ ] **YouTube.** One YouTube download, which runs yt-dlp on Electron-as-node.
- [ ] **Split zoom recording.** One share reporting `Total 2 Recordings` downloads both parts, on
      Chrome, then again with Chrome uninstalled so it runs on Edge.
- [ ] **Open PDF.** A PDF opens in the machine's own viewer; a regenerated one does not refresh
      there until reopened.
- [ ] **The real update.** After publishing, an installed previous release picks this one up from
      GitHub Releases — the smoke job's update check uses a local generic feed instead.
