const fs = require("fs");
const path = require("path");
const { google } = require("googleapis");
require("dotenv").config();

const SCOPES = [
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/calendar.events",
];

const TOKEN_PATH = path.join(__dirname, "tokens.json");

let oAuth2Client = null;

// Load OAuth client using ENV variables
function loadClient() {
  if (oAuth2Client) return oAuth2Client;

  const client_id = process.env.GOOGLE_CLIENT_ID;
  const client_secret = process.env.GOOGLE_CLIENT_SECRET;
  const redirect_uri = process.env.GOOGLE_REDIRECT_URI;

  if (!client_id || !client_secret || !redirect_uri) {
    throw new Error("Missing Google OAuth environment variables.");
  }

  oAuth2Client = new google.auth.OAuth2(client_id, client_secret, redirect_uri);

  // Load token if exists
  if (fs.existsSync(TOKEN_PATH)) {
    try {
      const token = JSON.parse(fs.readFileSync(TOKEN_PATH, "utf8"));
      oAuth2Client.setCredentials(token);
    } catch (err) {
      console.warn("Failed to parse tokens.json:", err.message);
    }
  }

  // Save refreshed tokens automatically
  oAuth2Client.on("tokens", (tokens) => {
    try {
      const existing = fs.existsSync(TOKEN_PATH)
        ? JSON.parse(fs.readFileSync(TOKEN_PATH, "utf8"))
        : {};
      const merged = { ...existing, ...tokens };
      fs.writeFileSync(TOKEN_PATH, JSON.stringify(merged, null, 2));
      console.log("Tokens saved.");
    } catch (err) {
      console.error("Failed saving token:", err.message);
    }
  });

  return oAuth2Client;
}

// Generate Google login URL
function getAuthUrl() {
  const client = loadClient();

  return client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: SCOPES,
  });
}

// Exchange code for tokens
async function authorize(code) {
  const client = loadClient();

  if (!code) throw new Error("Missing authorization code");

  const { tokens } = await client.getToken(code);
  client.setCredentials(tokens);

  fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));

  console.log("OAuth authorized successfully");
  return tokens;
}

// Convert date to RFC3339 format
function toRFC3339(dateInput) {
  const d = new Date(dateInput);
  return d.toISOString();
}

// Create Google Meet link
async function createGoogleMeet(title, description, startTime, endTime) {
  const client = loadClient();

  if (
    !client.credentials ||
    (!client.credentials.access_token && !client.credentials.refresh_token)
  ) {
    throw new Error("Please authorize Google first by visiting /auth/google");
  }

  const calendar = google.calendar({ version: "v3", auth: client });

  const event = {
    summary: title || "TutorConnect Session",
    description: description || "TutorConnect tutoring session",
    start: {
      dateTime: toRFC3339(startTime),
      timeZone: "Asia/Kolkata",
    },
    end: {
      dateTime: toRFC3339(endTime),
      timeZone: "Asia/Kolkata",
    },
    conferenceData: {
      createRequest: {
        requestId: `meet-${Date.now()}`,
        conferenceSolutionKey: { type: "hangoutsMeet" },
      },
    },
  };

  try {
    const response = await calendar.events.insert({
      calendarId: "primary",
      resource: event,
      conferenceDataVersion: 1,
    });

    const meetLink =
      response.data.hangoutLink ||
      response.data.conferenceData?.entryPoints?.[0]?.uri;

    console.log("Google Meet created:", meetLink);

    return meetLink;
  } catch (err) {
    console.error("Google Meet creation failed:", err.response?.data || err);
    throw err;
  }
}

module.exports = {
  getAuthUrl,
  authorize,
  createGoogleMeet,
};
