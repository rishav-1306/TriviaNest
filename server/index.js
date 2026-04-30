const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const express = require('express');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const cors = require('cors');
const fs = require('fs');
const xlsx = require('xlsx');
const helmet = require('helmet');
const compression = require('compression');
const mongoose = require('mongoose');

const app = express();

const PORT = process.env.PORT || 3000;
const SECRET_CODE = (process.env.SECRET_CODE || 'SECRET123').trim(); // Kept for Admin Access
const SESSION_SECRET = process.env.SESSION_SECRET || 'quiz-default-secret-key';

const ROUND_SECRET_CODES = {
    "1": process.env.ROUND_1_CODE || "GDG2026",
    "2": process.env.ROUND_2_CODE || "DCODE2026",
    "3": process.env.ROUND_3_CODE || "TECH2026"
};

// Connect to MongoDB
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/gdg_quiz';

if (!process.env.MONGODB_URI) {
    console.warn('⚠️  WARNING: MONGODB_URI not set in environment variables. Using local MongoDB.');
    console.warn('⚠️  If you are using MongoDB Atlas, please set MONGODB_URI in your .env file.');
}

mongoose.connect(MONGODB_URI)
    .then(() => {
        console.log('✅ Connected to MongoDB successfully');
        console.log(`📊 Database: ${mongoose.connection.name}`);
    })
    .catch(err => {
        console.error('❌ MongoDB connection error:', err.message);
        console.error('Please check your MONGODB_URI in the .env file');
        process.exit(1); // Exit if database connection fails
    });

// Handle MongoDB connection events
mongoose.connection.on('disconnected', () => {
    console.warn('⚠️  MongoDB disconnected');
});

mongoose.connection.on('error', (err) => {
    console.error('❌ MongoDB error:', err.message);
});

const resultSchema = new mongoose.Schema({
    teamName: String,
    participantName: String,
    roundNumber: Number,
    score: Number,
    timeTaken: Number,
    timestamp: { type: Date, default: Date.now }
});
const Result = mongoose.model('Result', resultSchema);

// Load questions
const questionsData = JSON.parse(fs.readFileSync(path.join(__dirname, 'questions.json'), 'utf-8'));

function transformResult(doc) {
    return {
        'Team Name': doc.teamName,
        'Participant Name': doc.participantName,
        'Round Number': doc.roundNumber,
        'Score': doc.score,
        'Time Taken (s)': doc.timeTaken,
        'Timestamp': doc.timestamp ? doc.timestamp.toISOString() : new Date().toISOString()
    };
}

// Middleware
app.use(compression()); // Compress all responses
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            ...helmet.contentSecurityPolicy.getDefaultDirectives(),
            "img-src": ["'self'", "data:", "*"], // Allow all images
            "script-src": ["'self'", "'unsafe-inline'"], // Allow inline scripts for simpler vanilla JS apps
        },
    },
}));
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));
app.use(cors());
app.use(session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({ mongoUrl: MONGODB_URI }),
    cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 } // 1 day
}));

// Utility: Shuffle array
function shuffle(array) {
    let currentIndex = array.length, randomIndex;
    while (currentIndex !== 0) {
        randomIndex = Math.floor(Math.random() * currentIndex);
        currentIndex--;
        [array[currentIndex], array[randomIndex]] = [array[randomIndex], array[currentIndex]];
    }
    return array;
}

// API Endpoints

// Login / Validate Code
app.post('/api/login', (req, res) => {
    const { teamName, participantName, secretCode, round } = req.body;

    const roundStr = String(round || 1);
    const expectedCode = ROUND_SECRET_CODES[roundStr];

    if (!questionsData[roundStr] || !expectedCode) {
        return res.status(400).json({ error: 'Invalid round' });
    }

    if (!secretCode || secretCode.trim() !== expectedCode) {
        console.log(`[Login] Failed login attempt for team: ${teamName}, Round: ${roundStr}`);
        return res.status(401).json({ error: `Invalid secret code for Round ${roundStr}` });
    }

    if (!teamName) {
        return res.status(400).json({ error: 'Team name is required' });
    }

    if (req.session.submittedRounds && req.session.submittedRounds.includes(roundStr)) {
        return res.status(403).json({ error: 'You have already submitted this round.' });
    }

    // Initialize session
    req.session.teamName = teamName;
    req.session.participantName = participantName || '';
    req.session.currentRound = roundStr;
    req.session.startTime = Date.now();
    req.session.submittedRounds = req.session.submittedRounds || [];

    // Shuffle questions and options for this session
    const roundQuestions = questionsData[roundStr];
    let shuffledQuestions = roundQuestions.map(q => {
        let options = [...q.options];
        if (q.options.length > 2) { // Shuffle only if more than 2 options (don't shuffle True/False)
             shuffle(options);
        }
        return {
            id: q.id,
            text: q.text,
            image: q.image,
            options: options,
            // DO NOT SEND 'correct' TO CLIENT
        };
    });
    
    shuffledQuestions = shuffle(shuffledQuestions);
    req.session.shuffledQuestions = shuffledQuestions;
    
    // Store correct answers mapping server-side to prevent cheating
    req.session.correctAnswers = {};
    roundQuestions.forEach(q => {
        req.session.correctAnswers[q.id] = q.correct;
    });

    res.json({ message: 'Login successful', round: roundStr });
});

// Get session state to handle page refreshes
app.get('/api/session', (req, res) => {
    if (req.session.teamName && req.session.currentRound && req.session.submittedRounds && !req.session.submittedRounds.includes(req.session.currentRound)) {
        res.json({ active: true, teamName: req.session.teamName, participantName: req.session.participantName, round: req.session.currentRound, submittedRounds: req.session.submittedRounds });
    } else {
        res.json({ active: false, teamName: req.session.teamName, participantName: req.session.participantName, submittedRounds: req.session.submittedRounds });
    }
});

// Get questions for current round
app.get('/api/questions', (req, res) => {
    if (!req.session.teamName || !req.session.currentRound) {
        return res.status(401).json({ error: 'Not authenticated or round not started' });
    }
    
    if (req.session.submittedRounds && req.session.submittedRounds.includes(req.session.currentRound)) {
        return res.status(403).json({ error: 'Round already submitted' });
    }

    const timeLimit = 60;
    const elapsed = (Date.now() - req.session.startTime) / 1000;
    const remainingTime = Math.max(0, Math.floor(timeLimit - elapsed));

    res.json({
        questions: req.session.shuffledQuestions,
        remainingTime: remainingTime,
        timeLimit: timeLimit // 60 seconds per round
    });
});

// Submit answers
app.post('/api/submit', async (req, res) => {
    if (!req.session.teamName || !req.session.currentRound) {
        return res.status(401).json({ error: 'Not authenticated' });
    }

    const currentRound = req.session.currentRound;
    if (req.session.submittedRounds && req.session.submittedRounds.includes(currentRound)) {
        return res.status(403).json({ error: 'Round already submitted' });
    }

    const { answers } = req.body; // { q1_1: 'Option A', ... }
    
    const timeTaken = (Date.now() - req.session.startTime) / 1000;
    
    // Calculate score
    let score = 0;
    const correctAnswers = req.session.correctAnswers;
    if (answers && typeof answers === 'object') {
        for (const [qId, ans] of Object.entries(answers)) {
            if (correctAnswers[qId] === ans) {
                score++;
            }
        }
    }

    // Save to MongoDB
    const resultDoc = new Result({
        teamName: req.session.teamName,
        participantName: req.session.participantName,
        roundNumber: parseInt(currentRound),
        score: score,
        timeTaken: parseFloat(timeTaken.toFixed(2))
    });

    try {
        await resultDoc.save();
        console.log(`[Submit] Saved result for team: ${req.session.teamName}, Round: ${currentRound}, Score: ${score}`);
    } catch (err) {
        console.error('Error saving result to MongoDB:', err);
        return res.status(500).json({ error: 'Failed to save results. Please try again.' });
    }

    // Mark round as submitted
    req.session.submittedRounds.push(currentRound);
    req.session.currentRound = null;

    res.json({
        score: score,
        timeTaken: timeTaken.toFixed(2),
        message: 'Submission successful'
    });
});

// API Endpoints for Admin (Download Results)
app.get('/api/admin/results', async (req, res) => {
    const { secret } = req.query;
    if (!secret || secret.trim() !== SECRET_CODE) {
        console.warn(`[Admin] Unauthorized results access attempt with secret: ${secret}`);
        return res.status(401).json({ error: 'Unauthorized' });
    }
    try {
        const docs = await Result.find().sort({ timestamp: -1 }).lean();
        const formattedResults = docs.map(transformResult);
        res.json(formattedResults);
    } catch (err) {
        console.error('Error fetching admin results:', err);
        res.status(500).json({ error: 'Database error' });
    }
});

app.get('/api/admin/download-excel', async (req, res) => {
    const { secret } = req.query;
    if (!secret || secret.trim() !== SECRET_CODE) {
        console.warn(`[Admin] Unauthorized excel download attempt`);
        return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
        const docs = await Result.find().sort({ timestamp: 1 }).lean();
        const formattedResults = docs.map(transformResult);

        const workbook = xlsx.utils.book_new();
        // If empty, create a dummy row so the file isn't corrupted
        const dataToSheet = formattedResults.length > 0 ? formattedResults : [{ Message: 'No submissions yet' }];
        const worksheet = xlsx.utils.json_to_sheet(dataToSheet);
        xlsx.utils.book_append_sheet(workbook, worksheet, 'Results');
        const buffer = xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });
        
        console.log(`[Admin] Excel download initiated. Rows: ${formattedResults.length}`);
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename=results.xlsx');
        res.send(buffer);
    } catch (e) {
        console.error('[Admin] Excel generation error:', e);
        res.status(500).send('Error generating Excel file');
    }
});

app.get('/api/admin/download-csv', async (req, res) => {
    const { secret } = req.query;
    if (!secret || secret.trim() !== SECRET_CODE) {
        console.warn(`[Admin] Unauthorized csv download attempt`);
        return res.status(401).json({ error: 'Unauthorized' });
    }

    try {
        const docs = await Result.find().sort({ timestamp: 1 }).lean();
        const formattedResults = docs.map(transformResult);

        if (formattedResults.length === 0) {
            return res.status(404).send('No results yet');
        }

        const headers = Object.keys(formattedResults[0]).join(',');
        const rows = formattedResults.map(row => 
            Object.values(row).map(val => `"${val}"`).join(',')
        ).join('\n');
        
        console.log(`[Admin] CSV download initiated. Rows: ${formattedResults.length}`);
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename=results.csv');
        res.send(headers + '\n' + rows);
    } catch (e) {
        console.error('[Admin] CSV generation error:', e);
        res.status(500).send('Error generating CSV file');
    }
});


// Start server
app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
    console.log(`Admin Download URL: /api/admin/download-excel?secret=${SECRET_CODE}`);
});
