const express = require('express');
const cors = require('cors');
const { getTopProducersFromYouTube, getArtistsFromSoundCloud } = require('./artist_lead_scraper');

const app = express();
const port = 3001;

// Enable CORS for your dashboard and local development
app.use(cors({
  origin: ['https://agent-dashboard-drab.vercel.app', 'http://localhost:3000'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());

// Root endpoint
app.get('/', (req, res) => {
    res.json({
        message: 'Welcome to the Artist Lead Scraper API',
        endpoints: {
            root: 'GET /',
            health: 'GET /health',
            scrape: 'POST /scrape'
        },
        usage: {
            scrape: {
                method: 'POST',
                url: '/scrape',
                body: {
                    searchTerm: 'string (required)'
                },
                example: {
                    searchTerm: 'Drake'
                }
            }
        }
    });
});

// Endpoint to trigger the scraping process
app.post('/scrape', async (req, res) => {
    try {
        const { searchTerm } = req.body;
        
        if (!searchTerm) {
            return res.status(400).json({ error: 'Search term is required' });
        }

        console.log(`Searching YouTube for "${searchTerm} type beat" producers...`);
        const producers = await getTopProducersFromYouTube(searchTerm, 3);
        console.log('Found producers:', producers);

        let allArtists = [];
        for (const producer of producers) {
            console.log(`\nSearching SoundCloud for artists using beats from ${producer}...`);
            const artists = await getArtistsFromSoundCloud(producer, 5);
            allArtists = allArtists.concat(artists);
            console.log(`Found ${artists.length} artists for producer ${producer}.`);
        }

        const leadsWithInstagram = allArtists.filter(
            artist =>
                artist.instagram &&
                typeof artist.instagram === 'string' &&
                artist.instagram.trim() !== '' &&
                artist.instagram.toLowerCase().includes('instagram.com')
        );

        res.json({
            success: true,
            data: leadsWithInstagram,
            count: leadsWithInstagram.length
        });

    } catch (error) {
        console.error('Error during scraping:', error);
        res.status(500).json({ error: 'An error occurred during scraping' });
    }
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
    });
});

app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
});