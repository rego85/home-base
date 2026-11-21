// Home Base settings. Edit this file, then reload the page.
window.DASH_CONFIG = {
  // Shown in the header.
  householdName: "Home Base",

  // Fallback location when the device won't share its location.
  homeLocation: { name: "Woodland Park, CO", lat: 38.9939, lon: -105.0569 },

  // true = ask the device for its location first, then fall back to homeLocation.
  useDeviceLocation: true,

  // Garbage night. 0 = Sunday, 1 = Monday ... 6 = Saturday. Pickup is the next morning.
  binsNight: 0,

  // Optional: Google Calendar embed link (see SETUP.md, step 5).
  // Example: "https://calendar.google.com/calendar/embed?src=YOUR_CALENDAR_ID&ctz=America%2FDenver"
  calendarEmbedUrl: "",

  // Optional: read upcoming bills from Gmail (see SETUP.md, step 7).
  gmail: {
    clientId: "", // e.g. "1234567890-abc123.apps.googleusercontent.com"
    // Which emails count as possible bills. Uses Gmail search syntax.
    query: 'newer_than:45d -in:spam -in:trash (subject:(bill OR statement OR "payment due" OR "amount due" OR autopay OR "scheduled payment" OR "payment received" OR invoice OR "payment confirmation") OR "amount due" OR "payment due")',
    maxEmails: 25,
  },

  // Your Cloudflare Worker address (see SETUP.md, step 6). Powers news, traffic,
  // and the Claude features (voice commands and bill reading, which also need Firebase sync).
  // Example: "https://home-base-claude.YOUR-NAME.workers.dev"
  workerUrl: "",

  // Traffic panel: the drive to watch. Default is Ute Pass (US-24), Woodland Park to Colorado Springs.
  traffic: {
    name: "Ute Pass",
    road: "US-24",
    from: { name: "Woodland Park", lat: 38.9939, lon: -105.0569 },
    to: { name: "Colorado Springs", lat: 38.8339, lon: -104.8214 },
  },

  // Optional: paste your Firebase web config here to sync between devices (see SETUP.md).
  // Leave as null to keep everything on this device only.
  // These values identify the project; they aren't secret. Access is limited by the Firestore rules.
  firebase: {
    apiKey: "AIzaSyAXbvpDvsUaymERspzGIVlA9rWnB1U2ih0",
    authDomain: "home-base-ba90e.firebaseapp.com",
    projectId: "home-base-ba90e",
    storageBucket: "home-base-ba90e.firebasestorage.app",
    messagingSenderId: "323623095430",
    appId: "1:323623095430:web:05ee1054288d9ccb559507",
  },
};
