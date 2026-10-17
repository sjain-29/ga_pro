/**
 * Firebase Web SDK configuration.
 *
 * The Realtime Database URL alone is NOT enough: Firebase Authentication needs
 * the full web-app config (apiKey, authDomain, projectId, appId …).
 * Get it from: Firebase Console → Project settings → General → Your apps →
 * (Web app) → SDK setup and configuration → "Config".
 *
 * These values are public identifiers, not secrets — security comes from
 * Firebase Authentication + the Realtime Database / Storage Security Rules.
 * Never put passwords or service-account keys in this file.
 *
 * While apiKey still contains "REPLACE_WITH", the app runs in DEMO MODE
 * (in-browser sample data, no Firebase calls) so you can explore it safely.
 */
export const firebaseConfig = {
  apiKey: 'REPLACE_WITH_YOUR_WEB_API_KEY',
  authDomain: 'garuda-pro-d3022.firebaseapp.com',
  databaseURL: 'https://garuda-pro-d3022-default-rtdb.europe-west1.firebasedatabase.app',
  projectId: 'garuda-pro-d3022',
  storageBucket: 'garuda-pro-d3022.firebasestorage.app',
  messagingSenderId: 'REPLACE_WITH_SENDER_ID',
  appId: 'REPLACE_WITH_APP_ID',
};

/** Firebase JS SDK version loaded from gstatic. */
export const FIREBASE_SDK_VERSION = '10.12.2';

/**
 * Optional: set to true after deploying the Cloud Functions in /functions.
 * When true, profit summaries + trusted audit trail are produced server-side
 * and admin browsers stop recomputing summaries.
 */
export const CLOUD_FUNCTIONS_DEPLOYED = false;

/**
 * First-administrator bootstrap (see README → "Create the first administrator").
 * Create this email in Firebase Console → Authentication with the initial
 * password there (never in this repository). The same email must appear in
 * firebase/database.rules.json (BOOTSTRAP rule). Signing in as username
 * "garuda" resolves to this email until the admin profile is claimed.
 */
export const BOOTSTRAP_ADMIN_USERNAME = 'garuda';
export const BOOTSTRAP_ADMIN_EMAIL = 'admin@garudaaerospace.com';

/** Region used when calling callable Cloud Functions. */
export const FUNCTIONS_REGION = 'europe-west1';

export const isConfigured = () => !String(firebaseConfig.apiKey).includes('REPLACE_WITH') && !String(firebaseConfig.appId).includes('REPLACE_WITH');
