import express from "express";
import crypto from "crypto";
import path from "path";
import { fileURLToPath } from "url";
import session from "express-session";
import pgSession from "connect-pg-simple";
import fs from "fs";
import { promisify } from "util";
const PgSession = pgSession(session);
import multer from "multer";
import { timeStamp } from "console";
import { exec } from "child_process";
import speakeasy from "speakeasy";
import dotenv from "dotenv";
import { engine } from "express-handlebars"; // Import Handlebars
import Handlebars from "handlebars";
import { google } from 'googleapis';

import { marked, use } from 'marked';

import { pool } from "./pool.js";
import { authenticate } from "./auth.js";
import { validateSession, checkRolePermission, validateSessionAndRole, getUserData } from "./validateSessionAndRole.js";
import fetch from 'node-fetch';

dotenv.config();
const router = express.Router();
const UserCredentialTable = process.env.UserCredentialTable;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const storage = multer.memoryStorage();
const upload = multer({ storage });
const cookieExpireTime = 2 * 24 * 60 * 60 * 1000; // 12 hours
// cookieExpireTime: 2 * 24 * 60 * 60 * 1000, 2 day
// cookieExpireTime:  1* 60 * 1000, 1 min 
router.use(express.json());
router.use(express.urlencoded({ extended: true }));
const defaultQuery = process.env.DEFAULT_QUERY || 'computer science';

router.use(
  session({
    store: new PgSession({
      pool: pool, // Connection pool
      tableName: "session", // Use another table-name than the default "session" one
    }),
    secret: process.env.session_seceret_key, // Replace with your secret key
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: cookieExpireTime,
    },
  })
);

router.use((req, res, next) => {
  if (req.session && req.session.user) {
    const userAgent = req.headers["user-agent"];
    const userIp =
      req.headers["x-forwarded-for"] || req.connection.remoteAddress;
    const formattedIp = userIp === "::1" ? "127.0.0.1" : userIp;

    req.session.otherInfo = {
      ip: formattedIp,
      browser: userAgent,
    };

    next();
  } else {
    next();
  }
});

// Save the username in a cookie, the cookie user name is use
// for displaying user name in profile menu. This cookie is not use anyelse where.
// So it is safe to use.
router.use(async (req, res, next) => {
  if (req.session && req.session.user) {
    res.cookie("username", req.session.user.username, {
      maxAge: cookieExpireTime,
    });
    const query = `SELECT "Role" FROM "${UserCredentialTable}" WHERE "UserName" = $1`;
    const result = await pool.query(query, [req.session.user.username]);
    if (result.rows.length > 0) {
      req.session.user.role = result.rows[0].Role;
      res.cookie("userRole", req.session.user.role, {
        maxAge: cookieExpireTime,
      });
    } else {
      req.session.user.role = null;
    }
  }
  next();
});

router.get(["/login", "/signin"], (req, res) => {
  if (req.session && req.session.user) {
    return res.render("staticPage/login.handlebars", { userLoggedIn: true, UserName: req.session.user.username });
  }
  return res.render("staticPage/login.handlebars");
});

//Invoke-RestMethod -Uri http://localhost:3030/terminateAllSessions -Method POST
// Terminate all sessions route
router.post("/terminateAllSessions", authenticate(process.env.Main_SECRET_TOKEN), async (req, res) => {
  try {
    await pool.query(`UPDATE "${UserCredentialTable}" SET "SessionId" = NULL`);

    // Clear the session table
    await pool.query('DELETE FROM "session"');

    // Destroy all sessions on the server
    req.session.destroy((err) => {
      if (err) {
        console.error("Error destroying session:", err);
        return res
          .status(500)
          .json({ success: false, message: "Failed to terminate sessions" });
      }
      console.log("All sessions terminated successfully");
      res.status(200).json({
        success: true,
        message: "All sessions terminated successfully",
      });
    });
  } catch (err) {
    console.error("Database query error during session termination:", err);
    res
      .status(500)
      .json({ success: false, message: "Internal Server Error" });
  }
}
);

router.post("/login", async (req, res) => {

  const { username, password, token, recaptcha } = req.body;
  const secretKey = process.env.RECAPTCHA_SECRET_KEY;
  const verificationUrl = `https://www.google.com/recaptcha/api/siteverify?secret=${secretKey}&response=${recaptcha}`;

  //bypass recaptcha for specific users
  if (username !== "ibnekhalid" && username !== "maaz.waheed" && username !== "support") {
    const response = await fetch(verificationUrl, { method: 'POST' });
    const body = await response.json();

    if (!body.success) {
      return res.status(400).json({ success: false, message: `Failed reCAPTCHA verification` });
    }
  }

  if (!username || !password) {
    console.log("Login attempt with missing username or password");
    return res.status(400).json({
      success: false,
      message: "Username and password are required",
    });
  }

  try {
    // Query to check if the username exists
    const userQuery = `SELECT * FROM "${UserCredentialTable}" WHERE "UserName" = $1`;
    const userResult = await pool.query(userQuery, [username]);

    if (userResult.rows.length === 0) {
      console.log(`Login attempt with non-existent username: \"${username}\"`);
      return res
        .status(404)
        .json({ success: false, message: "Username does not exist" });
    }

    const user = userResult.rows[0];

    // Check if the password matches
    if (user.Password !== password) {
      console.log(`Incorrect password attempt for username: \"${username}\"`);
      return res
        .status(401)
        .json({ success: false, message: "Incorrect password" });
    }

    // Check if the account is inactive
    if (!user.Active) {
      console.log(
        `Inactive account login attempt for username: \"${username}\"`
      );
      return res
        .status(403)
        .json({ success: false, message: "Account is inactive" });
    } 
    // Generate session ID
    const sessionId = crypto.randomBytes(256).toString("hex"); // Generate a secure random session ID
    await pool.query(`UPDATE "${UserCredentialTable}" SET "SessionId" = $1 WHERE "id" = $2`, [
      sessionId,
      user.id,
    ]);

    // Store session ID in session
    req.session.user = {
      id: user.id,
      username: user.UserName,
      sessionId,
    };

    console.log(`User \"${username}\" logged in successfully`);
    res.status(200).json({
      success: true,
      message: "Login successful",
      sessionId,
    });
  } catch (err) {
    console.error("Database query error:", err);
    res.status(500).json({ success: false, message: "Internal Server Error" });
  }
});

router.post("/logout", async (req, res) => {
  if (req.session.user) {
    try {
      const { id, username } = req.session.user;
      const query = `SELECT "Active" FROM "${UserCredentialTable}" WHERE "id" = $1`;
      const result = await pool.query(query, [id]);

      if (result.rows.length > 0 && !result.rows[0].Active) {
        console.log("Account is inactive during logout");
      }

      req.session.destroy((err) => {
        if (err) {
          console.error("Error destroying session:", err);
          return res
            .status(500)
            .json({ success: false, message: "Logout failed" });

        }
        res.clearCookie("connect.sid");
        console.log(`User \"${username}\" logged out successfully`);
        res.status(200).json({ success: true, message: "Logout successful" });
      });
    } catch (err) {
      console.error("Database query error during logout:", err);
      res
        .status(500)
        .json({ success: false, message: "Internal Server Error" });
      return res.render('templates/Error/500', { error: err }); // Assuming you have an error template
    }
  } else {
    res.status(400).json({ success: false, message: "Not logged in" });
  }
}); 







// Routes
router.get('/chatbot', validateSessionAndRole("SuperAdmin"), async (req, res) => {
  const searchQuery = req.query.q || '';
  let videos = [];

  if (!process.env.YT_API_KEY) {
    console.error('YT_API_KEY is missing');
    return res.status(500).send('Server configuration error');
  }

  try {
    const youtube = google.youtube({ version: 'v3', auth: process.env.YT_API_KEY });
    const response = await youtube.search.list({
      part: 'snippet',
      q: searchQuery || defaultQuery,
      maxResults: 10,
      type: 'video',
      safeSearch: 'moderate'
    });

    videos = response.data.items.map(video => ({
      title: video.snippet.title,
      thumbnail: video.snippet.thumbnails.medium.url,
      videoId: video.id.videoId
    }));

    res.render('index', { videos, query: searchQuery });
  } catch (err) {
    console.error('YouTube API Error:', err);
    res.status(500).send('Error fetching videos');
  }
});

router.get('/watch', validateSessionAndRole("SuperAdmin"), async (req, res) => {
  const videoId = req.query.v;
  const searchQuery = req.query.q || '';

  if (!videoId || !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
    return res.status(400).send('Invalid video ID');
  }

  try {
    const youtube = google.youtube({ version: 'v3', auth: process.env.YT_API_KEY });
    
    // Get video details (title only) and channel info
    const [videoResponse, channelResponse] = await Promise.all([
      youtube.videos.list({
        part: 'snippet',
        id: videoId,
        fields: 'items(snippet(title,channelId))'
      }),
      youtube.channels.list({
        part: 'snippet',
        id: req.query.channelId || '', // Will be filled from video response
        fields: 'items(snippet(title))'
      })
    ]);

    if (!videoResponse.data.items?.length) {
      return res.status(404).send('Video not found');
    }

    const videoData = videoResponse.data.items[0].snippet;
    const channelData = channelResponse.data.items?.[0]?.snippet || { title: 'Unknown Channel' };

    res.render('watch', {
      videoId,
      title: videoData.title,
      channelTitle: channelData.title,
      query: searchQuery
    });
  } catch (err) {
    console.error('YouTube API Error:', err);
    res.status(500).send('Error fetching video details');
  }
});

export default router;