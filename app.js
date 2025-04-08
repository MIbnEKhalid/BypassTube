import dotenv from 'dotenv';
import express from 'express';
import { engine } from 'express-handlebars';
import { google } from 'googleapis';
import { pool } from './routes/pool.js';
import validator from 'validator';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';

// Add at the top with other middleware
dotenv.config();

const app = express();
app.use(helmet());
const defaultQuery = process.env.DEFAULT_QUERY || 'computer science';
app.set('trust proxy', 1);
// Customize CSP based on your needs
app.use(helmet.contentSecurityPolicy({
  directives: {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'", "'unsafe-inline'", "https://cdnjs.cloudflare.com"],
    styleSrc: ["'self'", "'unsafe-inline'", "https://cdnjs.cloudflare.com"],
    imgSrc: ["'self'", "data:", "https://i.ytimg.com"],
    frameSrc: ["'self'", "https://www.youtube.com"],
    fontSrc: ["'self'", "https://cdnjs.cloudflare.com"]
  }
}));
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
      if (str && str.length > len) {
        return str.substring(0, len) + '...';
      }
      return str;
    },
    formatDate: function (dateString) {
      const date = new Date(dateString);
      return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });
    },
    formatNumber: function (num) {
      if (!num) return '0';
      return new Intl.NumberFormat('en-US').format(num);
    },
    // Add to your Handlebars helpers
    formatDuration: function (duration) {
      if (!duration) return '0:00';

      const match = duration.match(/PT(\d+H)?(\d+M)?(\d+S)?/);
      if (!match) return '0:00';

      const hours = (match[1] ? parseInt(match[1]) : 0);
      const minutes = (match[2] ? parseInt(match[2]) : 0);
      const seconds = (match[3] ? parseInt(match[3]) : 0);

      if (hours > 0) {
        return `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
      }
      return `${minutes}:${seconds.toString().padStart(2, '0')}`;
    }
  }
}));
app.set('view engine', 'hbs');
console.log('Views directory:', app.get('views'));
// Serve static files
app.use(express.static('public'));

// Routes

app.get('/', async (req, res) => {
  const searchQuery = req.query.q || '';
  let videos = [];

  if (!process.env.YT_API_KEY) {
    console.error('Error: YT_API_KEY is not set in the environment variables.');
    process.exit(1);
  }

  try {
    const youtube = google.youtube({
      version: 'v3',
      auth: process.env.YT_API_KEY,
    });

    // Common function to process videos
    const processVideos = async (searchResponse) => {
      // Extract video IDs for the videos.list API call
      const videoIds = searchResponse.data.items.map(item => item.id.videoId);

      // Get video details including statistics
      const videosResponse = await youtube.videos.list({
        part: 'snippet,statistics,contentDetails',
        id: videoIds.join(','),
        maxResults: 10,
      });

      // Get channel details
      const channelIds = searchResponse.data.items.map(item => item.snippet.channelId);
      const channelsResponse = await youtube.channels.list({
        part: 'snippet,statistics',
        id: channelIds.join(','),
        maxResults: 10,
      });

      const channels = {};
      channelsResponse.data.items.forEach(channel => {
        channels[channel.id] = {
          name: channel.snippet.title,
          thumbnail: channel.snippet.thumbnails.default.url,
          subscribers: channel.statistics.subscriberCount
        };
      });

      // Combine all data
      return searchResponse.data.items.map((video, index) => {
        const videoDetails = videosResponse.data.items[index];
        return {
          title: video.snippet.title,
          description: video.snippet.description,
          thumbnail: video.snippet.thumbnails.high.url,
          videoId: video.id.videoId,
          channelId: video.snippet.channelId,
          channelTitle: video.snippet.channelTitle,
          publishedAt: video.snippet.publishedAt,
          viewCount: videoDetails?.statistics?.viewCount || '0',
          likeCount: videoDetails?.statistics?.likeCount || '0',
          duration: videoDetails?.contentDetails?.duration || 'PT0M0S',
          channelThumbnail: channels[video.snippet.channelId]?.thumbnail || '',
          channelSubscribers: formatSubscribers(channels[video.snippet.channelId]?.subscribers || '0')
        };
      });
    };

    if (searchQuery) {
      // Fetch videos based on search query
      const searchResponse = await youtube.search.list({
        part: 'snippet',
        q: searchQuery,
        maxResults: 10,
        type: 'video',
      });

      videos = await processVideos(searchResponse);

      // Store search query in NeonDB
      if (searchQuery.trim() !== '') {
        try {
          const sanitizedQuery = validator.escape(searchQuery);
          await pool.query('INSERT INTO search_history (query) VALUES ($1)', [sanitizedQuery]);
        } catch (dbErr) {
          console.error('DB Error:', dbErr);
        }
      }
    } else {
      // Fetch default videos
      const searchResponse = await youtube.search.list({
        part: 'snippet',
        q: defaultQuery,
        maxResults: 10,
        type: 'video',
      });

      videos = await processVideos(searchResponse);
    }

    res.render('index.hbs', {
      videos,
      query: searchQuery,
      currentYear: new Date().getFullYear()
    });
  } catch (err) {
    console.error('YouTube API Error:', err);
    res.status(500).send('Error fetching videos');
  }
});

// Helper function to format subscriber count
function formatSubscribers(count) {
  if (count >= 1000000) {
    return (count / 1000000).toFixed(1) + 'M';
  }
  if (count >= 1000) {
    return (count / 1000).toFixed(1) + 'K';
  }
  return count;
}

app.get('/watch', async (req, res) => {
  const videoId = req.query.v;
  const searchQuery = req.query.q || '';

  if (!videoId) {
    return res.status(400).send('Invalid video ID');
  }

  const videoIdPattern = /^[a-zA-Z0-9_-]{11}$/;
  if (videoId && !videoIdPattern.test(videoId)) {
    return res.status(400).send('Invalid video ID.');
  }

  try {
    const youtube = google.youtube({
      version: 'v3',
      auth: process.env.YT_API_KEY,
    });

    // Get video details
    const videoResponse = await youtube.videos.list({
      part: 'snippet,statistics,contentDetails',
      id: videoId,
    });

    if (!videoResponse.data.items || videoResponse.data.items.length === 0) {
      return res.status(404).send('Video not found');
    }

    const videoData = videoResponse.data.items[0];

    // Get channel details
    const channelResponse = await youtube.channels.list({
      part: 'snippet,statistics',
      id: videoData.snippet.channelId,
    });

    const channelData = channelResponse.data.items[0];

    const video = {
      title: videoData.snippet.title,
      description: videoData.snippet.description,
      publishedAt: videoData.snippet.publishedAt,
      viewCount: videoData.statistics.viewCount,
      likeCount: videoData.statistics.likeCount,
      commentCount: videoData.statistics.commentCount,
      duration: videoData.contentDetails.duration,
      channelTitle: videoData.snippet.channelTitle,
      channelId: videoData.snippet.channelId,
      channelThumbnail: channelData.snippet.thumbnails.default.url,
      channelSubscribers: formatSubscribers(channelData.statistics.subscriberCount)
    };

    res.render('watch.hbs', {
      videoId,
      video,
      query: searchQuery,
      currentYear: new Date().getFullYear()
    });
  } catch (err) {
    console.error('YouTube API Error:', err);
    res.status(500).send('Error fetching video details');
  }
});

export default app;