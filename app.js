import dotenv from 'dotenv';
import express from 'express';
import { engine } from 'express-handlebars';
import { google } from 'googleapis';
import { pool } from './routes/pool.js';
import validator from 'validator';
import rateLimit from 'express-rate-limit';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const defaultQuery = process.env.DEFAULT_QUERY || 'computer science';


const limiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: 'Too many requests, please try again later.',
});

app.use(limiter);

// Configure Handlebars
// Add this when setting up Handlebars
app.engine('hbs', engine({
  extname: '.hbs',
  defaultLayout: 'main',
  helpers: {
    truncate: function (str, len) {
      if (str.length > len) {
        return str.substring(0, len) + '...';
      }
      return str;
    }
  }
})); app.set('view engine', 'hbs');

// Serve static files
app.use(express.static('public'));

// Routes

app.get('/', async (req, res) => {
  const searchQuery = req.query.q || ''; // Default to empty if no query
  let videos = [];
  if (!process.env.YT_API_KEY) {
    console.error('Error: YT_API_KEY is not set in the environment variables.');
    process.exit(1);
  }
  try {
    const youtube = google.youtube({
      version: 'v3',
      auth: process.env.YT_API_KEY, // Your API key
    });

    if (searchQuery) {
      // Fetch videos based on search query
      const response = await youtube.search.list({
        part: 'snippet',
        q: searchQuery,
        maxResults: 10,
        type: 'video',
      });

      videos = response.data.items.map(video => ({
        title: video.snippet.title,
        description: video.snippet.description,
        thumbnail: video.snippet.thumbnails.high.url, // Use high-quality thumbnails
        videoId: video.id.videoId,
      }));

      // Store search query in NeonDB only if user searched
      if (searchQuery.trim() !== '') {
        try {
          const sanitizedQuery = validator.escape(searchQuery);
          await pool.query('INSERT INTO search_history (query) VALUES ($1)', [sanitizedQuery]);
        } catch (dbErr) {
          console.error('DB Error:', dbErr);
        }
      }
    } else {
      // Fetch some default videos when no search query is provided
      const response = await youtube.search.list({
        part: 'snippet',
        q: defaultQuery,
        maxResults: 10,
        type: 'video',
      });

      videos = response.data.items.map(video => ({
        title: video.snippet.title,
        description: video.snippet.description,
        thumbnail: video.snippet.thumbnails.high.url, // Use high-quality thumbnails
        videoId: video.id.videoId,
      }));
    }

    // Render videos
    res.render('index', { videos, query: searchQuery, currentYear: new Date().getFullYear() });
  } catch (err) {
    console.error('YouTube API Error:', err);
    res.status(500).send('Error fetching videos');
  }
});

app.get('/watch', (req, res) => {
  const videoId = req.query.v;

  if (!videoId) {
    return res.status(400).send('Invalid video ID');
  }
  const videoIdPattern = /^[a-zA-Z0-9_-]{11}$/; // YouTube video IDs are 11 characters long and can include a-z, A-Z, 0-9, - and _
  if (videoId && !videoIdPattern.test(videoId)) {
    return res.status(400).send('Invalid video ID.');
  }
  res.render('watch', { videoId, currentYear: new Date().getFullYear() });
});

// Start server
app.listen(PORT, () => {
  console.log(`Server is running at http://localhost:${PORT}`);
});
