# Deployment handoff

## Public game

The game is hosted at:

https://gatsinzipratais.github.io/data-detective-outbreak/

GitHub Pages publishes the root files on the main branch.

## Before publishing the cross-device update

1. Confirm firebase-config.js contains the active Firebase web configuration.
2. Confirm Firebase Realtime Database rules match firebase-rules.json.
3. Push the updated root files and assets to the main branch.

## Required verification

1. Open the live URL on two separate devices, or in two independent browser profiles.
2. Host a case on one device and send the copied invite to the other device.
3. Select different roles and confirm that both appear in the lobby.
4. Start the case, share a clue, save a theory, choose an action, and confirm both devices update.
5. Complete the final decision and confirm the shared debrief appears on both devices.

The game uses anonymous Firebase guest accounts and stores only fictional game-room data.
