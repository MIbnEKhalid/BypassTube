import express from "express";
import { fileURLToPath } from "url";
import multer from "multer";
import dotenv from "dotenv";
import { google } from 'googleapis';
import { pool } from "./pool.js";
import { authenticate, validateSession, checkRolePermission, validateSessionAndRole, getUserData } from "mbkauth";

dotenv.config();
const router = express.Router();
const UserCredentialTable = process.env.UserCredentialTable;
const __filename = fileURLToPath(import.meta.url);
const storage = multer.memoryStorage();

router.use(express.json());
router.use(express.urlencoded({ extended: true }));
const defaultQuery = process.env.DEFAULT_QUERY || 'computer science';

router.get(["/login", "/signin"], (req, res) => {
  if (req.session && req.session.user) {
    return res.render("staticPage/login.handlebars", { userLoggedIn: true, UserName: req.session.user.username });
  }
  return res.render("staticPage/login.handlebars");
});

// Routes
router.get(['/home','/'], validateSessionAndRole("SuperAdmin"), async (req, res) => {
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