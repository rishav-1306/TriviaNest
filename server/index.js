const express = require('express');
const session = require('express-session');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const xlsx = require('xlsx');
const helmet = require('helmet');
const compression = require('compression');

const app = express();
const PORT = process.env.PORT || 3000;
const SECRET_CODE = process.env.SECRET_CODE || 'SECRET123';
const SESSION_SECRET = process.env.SESSION_SECRET || 'quiz-default-secret-key';
const DATA_DIR = path.join(__dirname, '../data');
const EXCEL_FILE = path.join(DATA_DIR, 'results.xlsx');
const CSV_FILE = path.join(DATA_DIR, 'results.csv');

// In-memory cache for results to handle high concurrency
let allResults = [];

// Load questions
const questionsData = JSON.parse(fs.readFileSync(path.join(__dirname, 'questions.json'), 'utf-8'));

// Load existing results into memory at startup
if (fs.existsSync(EXCEL_FILE)) {
    try {
        const workbook = xlsx.readFile(EXCEL_FILE);
        const worksheet = workbook.Sheets[workbook.SheetNames[0]];
        allResults = xlsx.utils.sheet_to_json(worksheet);
        console.log(`Loaded ${allResults.length} existing results from Excel.`);
    } catch (e) {
        console.error("Failed to load existing Excel data:", e);
    }
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

// Queue for writing to Excel
const writeQueue = [];

// API Endpoints

// Login / Validate Code
app.post('/api/login', (req, res) => {
    const { teamName, participantName, secretCode, round } = req.body;

    if (secretCode !== SECRET_CODE) {
        return res.status(401).json({ error: 'Invalid secret code' });
    }
    if (!teamName) {
        return res.status(400).json({ error: 'Team name is required' });
    }
    
    const roundStr = String(round || 1);
    if (!questionsData[roundStr]) {
        return res.status(400).json({ error: 'Invalid round' });
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
app.post('/api/submit', (req, res) => {
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

    // Queue data for Excel
    writeQueue.push({
        'Team Name': req.session.teamName,
        'Participant Name': req.session.participantName,
        'Round Number': parseInt(currentRound),
        'Score': score,
        'Time Taken (s)': timeTaken.toFixed(2),
        'Timestamp': new Date().toISOString()
    });

    // Mark round as submitted
    req.session.submittedRounds.push(currentRound);
    req.session.currentRound = null;

    res.json({
        score: score,
        timeTaken: timeTaken.toFixed(2),
        message: 'Submission successful'
    });
});

// Background task to write queue to Excel and CSV safely
setInterval(() => {
    if (writeQueue.length === 0) return;

    // Drain current items from queue
    const itemsToWrite = writeQueue.splice(0, writeQueue.length);
    
    // Add to in-memory cache
    allResults.push(...itemsToWrite);
    
    try {
        if (!fs.existsSync(DATA_DIR)) {
            fs.mkdirSync(DATA_DIR, { recursive: true });
        }

        // 1. FAST PERSISTENCE: Append to CSV (Safe, even if Excel is open)
        const csvHeader = 'Team Name,Participant Name,Round Number,Score,Time Taken (s),Timestamp\n';
        const csvRows = itemsToWrite.map(item => 
            `"${item['Team Name']}","${item['Participant Name']}","${item['Round Number']}","${item['Score']}","${item['Time Taken (s)']}","${item['Timestamp']}"`
        ).join('\n') + '\n';
        
        if (!fs.existsSync(CSV_FILE)) {
            fs.writeFileSync(CSV_FILE, csvHeader + csvRows);
        } else {
            fs.appendFileSync(CSV_FILE, csvRows);
        }

        // 2. EXCEL SYNC: Update the Excel file
        const workbook = xlsx.utils.book_new();
        const newWorksheet = xlsx.utils.json_to_sheet(allResults);
        xlsx.utils.book_append_sheet(workbook, newWorksheet, 'Results');
        xlsx.writeFile(workbook, EXCEL_FILE);

        console.log(`Successfully persisted ${itemsToWrite.length} submission(s). Total: ${allResults.length}`);
    } catch (error) {
        console.error('Error during data persistence:', error);
        // Put items back in queue if write failed (except the CSV part which usually succeeds)
        writeQueue.unshift(...itemsToWrite);
    }
}, 5000); // Sync every 5 seconds

// Start server
app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
});
