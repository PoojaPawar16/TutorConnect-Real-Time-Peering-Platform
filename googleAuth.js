// googleAuth.js (improved, safe, dev-friendly)
const fs = require("fs");
const path = require("path");
const { google } = require("googleapis");
require("dotenv").config();

const SCOPES = [
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/calendar.events",
];

const CREDENTIALS_PATH = path.join(__dirname, "credentials.json");
const TOKEN_PATH = path.join(__dirname, "tokens.json");

let oAuth2Client = null;

// load client credentials and tokens (safe)
function loadClient() {
  if (oAuth2Client) return oAuth2Client;

  if (!fs.existsSync(CREDENTIALS_PATH)) {
    throw new Error(
      `Missing credentials.json at ${CREDENTIALS_PATH}. Create credentials in Google Cloud Console and save file there.`
    );
  }

  let credentials;
  try {
    credentials = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, "utf8"));
  } catch (err) {
    throw new Error(`Invalid credentials.json: ${err.message}`);
  }

  const { client_secret, client_id, redirect_uris } = credentials.web || {};
  if (!client_id || !client_secret || !redirect_uris || !redirect_uris[0]) {
    throw new Error(
      "credentials.json is missing required fields (client_id/secret/redirect_uris)."
    );
  }

  oAuth2Client = new google.auth.OAuth2(
    client_id,
    client_secret,
    redirect_uris[0]
  );

  // load token if present
  if (fs.existsSync(TOKEN_PATH)) {
    try {
      const token = JSON.parse(fs.readFileSync(TOKEN_PATH, "utf8"));
      oAuth2Client.setCredentials(token);
    } catch (err) {
      console.warn("Warning: failed to parse tokens.json -", err.message);
      // do not throw — allow authorize() to create new tokens
    }
  }

  // persist refresh token when google client emits tokens
  oAuth2Client.on("tokens", (tokens) => {
    try {
      const existing = fs.existsSync(TOKEN_PATH)
        ? JSON.parse(fs.readFileSync(TOKEN_PATH, "utf8"))
        : {};
      const merged = Object.assign({}, existing, tokens);
      fs.writeFileSync(TOKEN_PATH, JSON.stringify(merged, null, 2));
      console.log("♻️ Tokens updated and saved to", TOKEN_PATH);
    } catch (err) {
      console.error("Failed to save token:", err.message);
    }
  });

  return oAuth2Client;
}

function getAuthUrl() {
  const client = loadClient();
  return client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: SCOPES,
  });
}

async function authorize(code) {
  const client = loadClient();
  if (!code) throw new Error("Missing authorization code.");
  const { tokens } = await client.getToken(code);
  client.setCredentials(tokens);
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
  console.log("✅ Tokens saved successfully!");
  return tokens;
}

function toRFC3339WithLocalOffset(dateInput) {
  // Accept Date object or parseable date string
  const d = dateInput instanceof Date ? dateInput : new Date(dateInput);
  // timezone offset in minutes (e.g., IST is -330)
  const tzOffsetMin = d.getTimezoneOffset();
  const absOffsetMin = Math.abs(tzOffsetMin);
  const hours = String(Math.floor(absOffsetMin / 60)).padStart(2, "0");
  const minutes = String(absOffsetMin % 60).padStart(2, "0");
  const sign = tzOffsetMin > 0 ? "-" : "+";
  // build YYYY-MM-DDTHH:mm:ss
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  const sec = String(d.getSeconds()).padStart(2, "0");

  return `${yyyy}-${mm}-${dd}T${hh}:${min}:${sec}${sign}${hours}:${minutes}`;
}

async function createGoogleMeet(title, description, startTime, endTime) {
  const client = loadClient();

  // ensure we have at least some credentials
  if (
    !client.credentials ||
    (!client.credentials.access_token && !client.credentials.refresh_token)
  ) {
    throw new Error(
      "No OAuth token available. Please visit /auth/google and complete the OAuth flow to authorize the app."
    );
  }

  const calendar = google.calendar({ version: "v3", auth: client });

  // convert incoming times to RFC3339/ISO style with offset
  // startTime and endTime may come in as local strings from <input type="datetime-local">
  // Use helper to format with local timezone offset (e.g. +05:30)
  const startRFC = toRFC3339WithLocalOffset(startTime);
  const endRFC = toRFC3339WithLocalOffset(endTime);

  const event = {
    summary: title || "TutorConnect Session",
    description: description || "TutorConnect tutoring session",
    start: { dateTime: startRFC, timeZone: "Asia/Kolkata" },
    end: { dateTime: endRFC, timeZone: "Asia/Kolkata" },
    conferenceData: {
      createRequest: {
        requestId: `meet-${Date.now()}`,
        conferenceSolutionKey: { type: "hangoutsMeet" },
      },
    },
  };

  // DEBUG: show event payload being sent to Google (helpful for 400 errors)
  console.log(
    "📅 Creating Google Meet with event data:",
    JSON.stringify(event, null, 2)
  );

  try {
    const response = await calendar.events.insert({
      calendarId: "primary",
      resource: event,
      conferenceDataVersion: 1,
    });

    // try to find a URI in entryPoints (robust)
    const entryPoints = response.data.conferenceData?.entryPoints || [];
    let meetLink = null;
    if (Array.isArray(entryPoints) && entryPoints.length) {
      const candidate = entryPoints.find(
        (ep) => ep.entryPointType === "video" || ep.entryPointType === "more"
      );
      meetLink = candidate?.uri || entryPoints[0]?.uri;
    }

    // fallback to hangoutLink or conferenceSolution name
    if (!meetLink) {
      meetLink =
        response.data.hangoutLink ||
        response.data.conferenceData?.conferenceSolution?.name ||
        null;
    }

    console.log("✅ Google Meet Created:", meetLink);
    return meetLink;
  } catch (err) {
    // include Google response body if available to aid debugging
    const googleErr = err.response?.data || err.message || err;
    console.error("❌ Google Meet creation failed:", googleErr);
    // rethrow an Error with the more helpful message
    throw new Error(
      typeof googleErr === "string" ? googleErr : JSON.stringify(googleErr)
    );
  }
}

module.exports = { getAuthUrl, authorize, createGoogleMeet };
