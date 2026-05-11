const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const express = require('express');
const session = require('express-session');
const MongoStore = require('connect-mongo').default;
const cors = require('cors');
const fs = require('fs');
const xlsx = require('xlsx');
const helmet = require('helmet');
const compression = require('compression');
const mongoose = require('mongoose');

const app = express();

const PORT = process.env.PORT || 3000;
const SECRET_CODE = (process.env.SECRET_CODE || 'RISHAV1306').trim(); // Admin dashboard (results / exports)
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

async function computeLeaderboard(roundQuery) {
    const roundNumber = parseInt(String(roundQuery), 10);
    if (roundQuery === undefined || roundQuery === null || String(roundQuery).trim() === '' ||
        Number.isNaN(roundNumber) || roundNumber < 1) {
        const err = new Error('Round number is required');
        err.statusCode = 400;
        throw err;
    }

    console.log(`[Leaderboard] Fetching leaderboard for round ${roundNumber}`);

    const results = await Result.find({ roundNumber: { $lte: roundNumber } }).lean();
    console.log(`[Leaderboard] Found ${results.length} results for rounds 1-${roundNumber}`);

    const teamStats = {};
    results.sort((a, b) => a.roundNumber - b.roundNumber);

    results.forEach(result => {
        const key = result.teamName;
        if (!teamStats[key]) {
            teamStats[key] = {
                teamName: result.teamName,
                participantName: result.participantName,
                totalScore: 0,
                totalTime: 0
            };
        }
        teamStats[key].totalScore += result.score;
        teamStats[key].totalTime += result.timeTaken;
        teamStats[key].participantName = result.participantName;
        console.log(`[Leaderboard] Team: ${result.teamName}, Participant: ${result.participantName}, Round: ${result.roundNumber}, Score: ${result.score}, Team Total Score: ${teamStats[key].totalScore}`);
    });

    const leaderboardArray = Object.values(teamStats);
    leaderboardArray.sort((a, b) => {
        if (b.totalScore !== a.totalScore) {
            return b.totalScore - a.totalScore;
        }
        return a.totalTime - b.totalTime;
    });

    const rankedResults = leaderboardArray.map((result, index) => ({
        rank: index + 1,
        teamName: result.teamName,
        participantName: result.participantName,
        score: result.totalScore,
        timeTaken: result.totalTime.toFixed(2)
    }));

    console.log(`[Leaderboard] Returning ${rankedResults.length} ranked results`);
    return { leaderboard: rankedResults, currentRound: roundNumber };
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

// Utility: Shuffle array with enhanced randomization
function shuffle(array, seed = null) {
    let currentIndex = array.length, randomIndex;
    
    // Use seed if provided for reproducible testing, otherwise use multiple entropy sources
    const getRandom = () => {
        if (seed !== null) {
            // Simple seeded random for testing
            seed = (seed * 9301 + 49297) % 233280;
            return seed / 233280;
        }
        // Combine multiple entropy sources for better randomness
        return Math.random();
    };
    
    while (currentIndex !== 0) {
        randomIndex = Math.floor(getRandom() * currentIndex);
        currentIndex--;
        [array[currentIndex], array[randomIndex]] = [array[randomIndex], array[currentIndex]];
    }
    return array;
}

// Rank-based eligibility cutoffs for each round
const ROUND_CUTOFFS = {
    "2": 0.80, // Top 80% of Round 1 participants qualify for Round 2
    "3": 0.50  // Top 50% of Round 2 participants qualify for Round 3
};

// Check if a team is eligible for a given round based on previous round rankings
async function checkEligibility(teamName, targetRound) {
    const targetRoundNum = parseInt(targetRound);
    
    // Round 1 is always open to everyone
    if (targetRoundNum === 1) return { eligible: true };

    const previousRound = targetRoundNum - 1;
    const cutoff = ROUND_CUTOFFS[targetRound];

    // Get all results from the previous round
    const previousResults = await Result.find({ roundNumber: previousRound }).lean();

    if (previousResults.length === 0) {
        return { eligible: false, reason: `No results found for Round ${previousRound}. Round ${previousRound} must be completed first.` };
    }

    // Check if this team has a result in the previous round
    const teamResult = previousResults.find(r => r.teamName === teamName);
    if (!teamResult) {
        return { eligible: false, reason: `Your team did not participate in Round ${previousRound}.` };
    }

    // For Round 3 eligibility, compute cumulative scores (Round 1 + Round 2)
    // For Round 2 eligibility, only use Round 1 scores
    let teamScores = {};
    
    if (targetRoundNum === 2) {
        // Rank by Round 1 score only
        previousResults.forEach(r => {
            if (!teamScores[r.teamName] || r.score > teamScores[r.teamName].score) {
                teamScores[r.teamName] = { score: r.score, timeTaken: r.timeTaken };
            }
        });
    } else if (targetRoundNum === 3) {
        // Rank by cumulative score (Round 1 + Round 2)
        const allResults = await Result.find({ roundNumber: { $lte: previousRound } }).lean();
        allResults.forEach(r => {
            if (!teamScores[r.teamName]) {
                teamScores[r.teamName] = { score: 0, timeTaken: 0 };
            }
            teamScores[r.teamName].score += r.score;
            teamScores[r.teamName].timeTaken += r.timeTaken;
        });

        // Only consider teams that actually completed Round 2
        const round2Teams = new Set(previousResults.map(r => r.teamName));
        Object.keys(teamScores).forEach(name => {
            if (!round2Teams.has(name)) {
                delete teamScores[name];
            }
        });
    }

    // Sort teams: higher score first, then lower time as tiebreaker
    const sortedTeams = Object.entries(teamScores)
        .map(([name, data]) => ({ teamName: name, ...data }))
        .sort((a, b) => {
            if (b.score !== a.score) return b.score - a.score;
            return a.timeTaken - b.timeTaken;
        });

    const totalTeams = sortedTeams.length;
    const qualifyingCount = Math.ceil(totalTeams * cutoff);

    // Find the team's rank
    const teamRank = sortedTeams.findIndex(t => t.teamName === teamName) + 1;

    if (teamRank === 0) {
        return { eligible: false, reason: `Your team was not found in the rankings.` };
    }

    if (teamRank <= qualifyingCount) {
        return { eligible: true, rank: teamRank, totalTeams, qualifyingCount };
    } else {
        return {
            eligible: false,
            rank: teamRank,
            totalTeams,
            qualifyingCount,
            reason: `Your team ranked ${teamRank} out of ${totalTeams}. Only the top ${Math.round(cutoff * 100)}% (${qualifyingCount} teams) qualify for Round ${targetRound}.`
        };
    }
}

// API Endpoints

// Login / Validate Code
app.post('/api/login', async (req, res) => {
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

    // Check rank-based eligibility for Rounds 2 and 3
    if (roundStr !== "1") {
        try {
            const eligibility = await checkEligibility(teamName, roundStr);
            if (!eligibility.eligible) {
                console.log(`[Login] Team "${teamName}" not eligible for Round ${roundStr}: ${eligibility.reason}`);
                return res.status(403).json({ error: eligibility.reason });
            }
            console.log(`[Login] Team "${teamName}" eligible for Round ${roundStr} (Rank ${eligibility.rank}/${eligibility.totalTeams}, Top ${eligibility.qualifyingCount} qualify)`);
        } catch (err) {
            console.error('[Login] Eligibility check error:', err);
            return res.status(500).json({ error: 'Failed to check eligibility. Please try again.' });
        }
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

    // Shuffle questions and options for this session with enhanced randomization
    const roundQuestions = questionsData[roundStr];
    
    // Create session-specific entropy using multiple sources
    const sessionSeed = Date.now() + Math.random() + (req.sessionID || '').split('').reduce((a, b) => a + b.charCodeAt(0), 0);
    
    let shuffledQuestions = roundQuestions.map((q, index) => {
        let options = [...q.options];
        if (q.options.length > 2) { // Shuffle only if more than 2 options (don't shuffle True/False)
             // Use question index + session seed for option shuffling
             shuffle(options, sessionSeed + index);
        }
        return {
            id: q.id,
            text: q.text,
            image: q.image,
            options: options,
            // DO NOT SEND 'correct' TO CLIENT
        };
    });
    
    // Final shuffle of all questions using session seed
    shuffledQuestions = shuffle(shuffledQuestions, sessionSeed);
    req.session.shuffledQuestions = shuffledQuestions;
    
    // Log the question order for verification (remove in production if needed)
    console.log(`[Randomization] Team: ${teamName}, Round: ${roundStr}, Question Order:`, 
        shuffledQuestions.map(q => q.id).join(' -> '));
    
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

    // Set different time limits for each round
    const roundTimeLimits = {
        "1": 20 * 60, // 20 minutes for round 1
        "2": 20 * 60, // 20 minutes for round 2
        "3": 25 * 60  // 25 minutes for round 3
    };
    
    const timeLimit = roundTimeLimits[req.session.currentRound] || 60;
    const elapsed = (Date.now() - req.session.startTime) / 1000;
    const remainingTime = Math.max(0, Math.floor(timeLimit - elapsed));

    res.json({
        questions: req.session.shuffledQuestions,
        remainingTime: remainingTime,
        timeLimit: timeLimit // 60 seconds per round
    });
});

// Get leaderboard for current round (cumulative across all completed rounds)
app.get('/api/leaderboard', async (req, res) => {
    try {
        const payload = await computeLeaderboard(req.query.round);
        res.json(payload);
    } catch (err) {
        if (err.statusCode === 400) {
            return res.status(400).json({ error: err.message });
        }
        console.error('Error fetching leaderboard:', err);
        res.status(500).json({ error: 'Database error' });
    }
});

// Check eligibility for a specific team and round
app.get('/api/check-eligibility', async (req, res) => {
    const { teamName, round } = req.query;
    if (!teamName || !round) {
        return res.status(400).json({ error: 'teamName and round query parameters are required' });
    }
    try {
        const eligibility = await checkEligibility(teamName, String(round));
        res.json(eligibility);
    } catch (err) {
        console.error('[Eligibility] Check error:', err);
        res.status(500).json({ error: 'Failed to check eligibility' });
    }
});

// Admin: same leaderboard data, requires admin secret
app.get('/api/admin/leaderboard', async (req, res) => {
    const { secret } = req.query;
    if (!secret || secret.trim() !== SECRET_CODE) {
        console.warn('[Admin] Unauthorized leaderboard access attempt');
        return res.status(401).json({ error: 'Unauthorized' });
    }
    try {
        const payload = await computeLeaderboard(req.query.round);
        res.json(payload);
    } catch (err) {
        if (err.statusCode === 400) {
            return res.status(400).json({ error: err.message });
        }
        console.error('Error fetching admin leaderboard:', err);
        res.status(500).json({ error: 'Database error' });
    }
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

    // Eligibility is now determined by rank-based cutoffs checked at next round login
    const totalQuestions = Object.keys(correctAnswers).length;
    const passed = true; // Eligibility for next round is checked when they attempt to login

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
        console.log(`[Submit] Saved result for team: ${req.session.teamName}, Round: ${currentRound}, Score: ${score}, Passed: ${passed}`);
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
        passed: passed,
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
        res.setHeader('Content-Disposition', 'attachment; filename="results.xlsx"');
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

        const columnOrder = ['Team Name', 'Participant Name', 'Round Number', 'Score', 'Time Taken (s)', 'Timestamp'];
        const headers = columnOrder.join(',');
        const rows = formattedResults.length === 0
            ? ''
            : formattedResults.map(row =>
                columnOrder.map(key => {
                    const val = row[key] != null ? String(row[key]) : '';
                    return `"${val.replace(/"/g, '""')}"`;
                }).join(',')
            ).join('\n');

        console.log(`[Admin] CSV download initiated. Rows: ${formattedResults.length}`);
        res.setHeader('Content-Type', 'text/csv; charset=utf-8');
        res.setHeader('Content-Disposition', 'attachment; filename="results.csv"');
        res.send(headers + (rows ? '\n' + rows : ''));
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
