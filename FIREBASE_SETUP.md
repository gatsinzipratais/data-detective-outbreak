# Firebase setup for cross-device rooms

Data Detective: Outbreak uses Firebase Realtime Database and Firebase Anonymous Authentication. Firebase configuration is intended to be public in a browser app; the database rules restrict rooms to signed-in guest players.

## Console setup

1. Create a Firebase project named data-detective-outbreak.
2. Register a Web app for the project.
3. Create a Realtime Database and choose **Locked mode**.
4. Open **Authentication**, choose **Sign-in method**, and enable **Anonymous**.
5. Open **Authentication > Settings > Authorized domains** and add gatsinzipratais.github.io.
6. Open **Realtime Database > Rules**, replace the rules with the contents of [firebase-rules.json](firebase-rules.json), then publish them.
7. Copy the Web app configuration into [firebase-config.js](firebase-config.js). The required values are apiKey, authDomain, databaseURL, projectId, and appId.

The included rules are deliberately lightweight for a friendly contest game. Any authenticated guest who knows a room code can participate in that room; do not store personal, medical, or sensitive information there.

## Verification

1. Publish the updated files to GitHub Pages.
2. Open the live game on two separate devices, or in two independent browser profiles.
3. Host a case on one device and send the copied invite to the other.
4. Claim different roles, start the case, reveal a clue, and verify the second device updates immediately.

The app uses anonymous guest accounts only. Do not store personal, medical, or sensitive information in the game rooms.
