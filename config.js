// ===================================================================
//  SITE SETTINGS — this is the only file you should need to edit.
// ===================================================================

// Your existing Firebase project (copied from the original site).
export const FIREBASE_CONFIG = {
    apiKey: "AIzaSyBrfff-0wUtreuc9Pd27vvmsGip_fOhOEU",
    authDomain: "szabo-family-wishlists.firebaseapp.com",
    projectId: "szabo-family-wishlists",
    storageBucket: "szabo-family-wishlists.firebasestorage.app",
    messagingSenderId: "617406887208",
    appId: "1:617406887208:web:032586d88d62561d07cc1d",
    measurementId: "G-3E5FTNBKLL"
};

// The 4 family accounts: sign-in email (lowercase) -> name shown on their list.
// Keep the emails identical to the list in firestore.rules — the rules are
// what actually enforce who can edit.
export const FAMILY = {
    "kitteny99@gmail.com": "Jane",
    "zabe73@gmail.com": "Jason",
    "teri444@citlink.net": "Teri",
    "suzanne.szabo.9@gmail.com": "Suzanne",
};

export const SITE_TITLE = "Szabo Family Wishlists";

// A new, empty list "season" starts on the 1st of this month.
// 0 = January, 1 = February. With 1, lists stay on the current
// Christmas through January and a fresh year begins February 1.
export const SEASON_START_MONTH = 1;

// Lists from the original site live in this collection. They show up
// (read-only) in the archive, grouped by the year they were last edited.
export const LEGACY_COLLECTION = "christmasLists";
