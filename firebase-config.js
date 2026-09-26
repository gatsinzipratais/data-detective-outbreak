/*
 * Firebase web configuration for Data Detective: Outbreak.
 *
 * Replace the blank values with the configuration object shown by
 * Firebase Console after registering this GitHub Pages site as a Web app.
 * This configuration is designed to be public in a browser app; database
 * rules and anonymous authentication protect the game rooms.
 */
export const firebaseConfig = {
  apiKey: "AIzaSyA39KxATylRQ6Q_tWlcuRG17jHx_baMNSA",
  authDomain: "data-detective-outbreak.firebaseapp.com",
  databaseURL: "https://data-detective-outbreak-default-rtdb.firebaseio.com",
  projectId: "data-detective-outbreak",
  appId: "1:497536551918:web:b06396dbbba30639ea9cff"
};

export const firebaseConfigured = Object.values(firebaseConfig).every(Boolean);
