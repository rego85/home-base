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

  // Recycling: the date of any recycling pickup morning, and how often it comes.
  // Trash goes out every week; recycling joins it every `everyWeeks` weeks.
  recycling: { pickupDate: "2026-11-30", everyWeeks: 2 },

  // Optional: Google Calendar embed link (see SETUP.md, step 5).
  // Example: "https://calendar.google.com/calendar/embed?src=YOUR_CALENDAR_ID&ctz=America%2FDenver"
  calendarEmbedUrl: "",

  // Optional: read upcoming bills from Gmail (see SETUP.md, step 7).
  gmail: {
    clientId: "323623095430-bkjsi5o9618bt65qnuvais7af657c0gh.apps.googleusercontent.com",
    // Which emails count as possible bills. Uses Gmail search syntax.
    query: 'newer_than:45d -in:spam -in:trash (subject:(bill OR statement OR "payment due" OR "amount due" OR autopay OR "scheduled payment" OR "payment received" OR invoice OR "payment confirmation") OR "amount due" OR "payment due")',
    maxEmails: 25,
  },

  // Your Cloudflare Worker address (see SETUP.md, step 6). Powers news, traffic,
  // and the Claude features (voice commands and bill reading, which also need Firebase sync).
  // Example: "https://home-base-claude.YOUR-NAME.workers.dev"
  workerUrl: "https://home-base-api.zmueller1216.workers.dev",

  // Traffic panel: the drive to watch. Default is Ute Pass (US-24), Woodland Park to Colorado Springs.
  // Commute panel: drive times from home, flipped through with the arrows.
  // Only public places belong here (this file is public). Private addresses, like friends' homes,
  // are added in the app under Settings → Commute places, which saves them to your private database.
  traffic: {
    road: "US-24", // incidents are shown for this road
    from: { name: "Woodland Park", lat: 38.9939, lon: -105.0569 },
    destinations: [
      { name: "Colorado Springs", title: "Ute Pass", lat: 38.8339, lon: -104.8214 },
      { name: "Bear Creek Dog Park", lat: 38.8262, lon: -104.8617 },
      { name: "Denver", lat: 39.7392, lon: -104.9849 },
    ],
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
