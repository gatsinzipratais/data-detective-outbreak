# Data Detective: Outbreak

A browser-based cooperative investigation game built with OpenAI. Players open the app in separate tabs, join the same room, take distinct specialist roles, reveal their private evidence, and agree on shared investigative actions.

![Data Detective: Outbreak cover](assets/data-detective-outbreak-cover.png)

## Run it locally

From this folder, serve the files with any local web server. For example:

```powershell
python -m http.server 8080
```

Then open `http://localhost:8080` in two or more browser tabs. The same-room state synchronizes through the browser, so it is designed for a local, same-browser prototype.

## Case flow

1. Host a case and share the room code.
2. In each additional tab, enter that code using **Join case**, then select a different role.
3. Start once two or more players have joined.
4. Share private clues, choose three team actions, and make the final containment call.

This is a fictional experience and does not provide health advice.

