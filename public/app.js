const API_BASE = '/api';

// State
let currentRound = 1;
let totalRounds = 3;
let teamName = '';
let participantName = '';
let questions = [];
let currentQuestionIndex = 0;
let userAnswers = {};
let timerInterval;
let timeLimit = 60;
let startTime;

// DOM Elements
const loginScreen = document.getElementById('login-screen');
const quizScreen = document.getElementById('quiz-screen');
const resultScreen = document.getElementById('result-screen');

const loginForm = document.getElementById('login-form');
const teamNameInput = document.getElementById('team-name');
const participantNameInput = document.getElementById('participant-name');
const secretCodeInput = document.getElementById('secret-code');
const loginError = document.getElementById('login-error');
const roundIndicator = document.getElementById('round-indicator');

const quizProgress = document.getElementById('quiz-progress');
const quizTimer = document.getElementById('quiz-timer');
const questionText = document.getElementById('question-text');
const questionImage = document.getElementById('question-image');
const optionsContainer = document.getElementById('options-container');
const nextBtn = document.getElementById('next-btn');

const resultScore = document.getElementById('result-score');
const resultTime = document.getElementById('result-time');
const nextRoundBtn = document.getElementById('next-round-btn');
const finishMsg = document.getElementById('finish-msg');

// Initialization
document.addEventListener('DOMContentLoaded', () => {
    checkSession();

    // Prevent back navigation to mess up state
    history.pushState(null, null, location.href);
    window.onpopstate = () => {
        history.go(1);
    };
});

async function checkSession() {
    try {
        const res = await fetch(`${API_BASE}/session`);
        const data = await res.json();
        
        if (data.active) {
            teamName = data.teamName;
            participantName = data.participantName || '';
            currentRound = parseInt(data.round);
            teamNameInput.value = teamName;
            teamNameInput.disabled = true; 
            participantNameInput.value = participantName;
            // participantNameInput stays enabled so it can be changed for the new round
            roundIndicator.textContent = `Round ${currentRound}`;
            
            // Try fetching questions to resume
            await fetchQuestions();
        } else {
            // Check if team name is in session and there's a submitted round, meaning we should advance currentRound on refresh
            if (data.teamName && data.submittedRounds && data.submittedRounds.length > 0) {
                 const highestSubmitted = Math.max(...data.submittedRounds.map(r => parseInt(r)));
                 if (highestSubmitted < totalRounds) {
                     currentRound = highestSubmitted + 1;
                     teamName = data.teamName;
                     participantName = data.participantName || '';
                     teamNameInput.value = teamName;
                     teamNameInput.disabled = true;
                     participantNameInput.value = participantName;
                     // participantNameInput stays enabled
                     roundIndicator.textContent = `Round ${currentRound}`;
                 } else {
                     finishMsg.classList.remove('hidden');
                     showScreen('result');
                     return;
                 }
            }
            showScreen('login');
        }
    } catch (e) {
        console.error("Failed to check session", e);
        showScreen('login');
    }
}

// Login
loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    loginError.textContent = '';
    const code = secretCodeInput.value;
    const name = teamNameInput.value;
    const pName = participantNameInput.value;

    try {
        const res = await fetch(`${API_BASE}/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ teamName: name, participantName: pName, secretCode: code, round: currentRound })
        });
        
        const data = await res.json();
        
        if (!res.ok) {
            throw new Error(data.error || 'Login failed');
        }

        teamName = name;
        participantName = pName;
        teamNameInput.disabled = true;
        secretCodeInput.value = '';
        
        await fetchQuestions();

    } catch (error) {
        loginError.textContent = error.message;
    }
});

// Fetch Questions
async function fetchQuestions() {
    try {
        const res = await fetch(`${API_BASE}/questions`);
        const data = await res.json();
        
        if (!res.ok) {
            throw new Error(data.error || 'Failed to fetch questions');
        }

        questions = data.questions;
        timeLimit = data.timeLimit || 60;
        
        // Calculate remaining time using server calculated remainingTime to prevent clock skew
        let remaining = data.remainingTime;
        
        if (remaining <= 0) {
            submitQuiz(); // Time is already up
            return;
        }
        
        startTimer(remaining);
        
        currentQuestionIndex = 0;
        userAnswers = {};
        
        renderQuestion();
        showScreen('quiz');
        
    } catch (error) {
        loginError.textContent = error.message;
        showScreen('login');
    }
}

// Timer
function startTimer(duration) {
    clearInterval(timerInterval);
    let timer = duration;
    quizTimer.textContent = `Time: ${timer}s`;
    
    timerInterval = setInterval(() => {
        timer--;
        quizTimer.textContent = `Time: ${timer}s`;
        
        if (timer <= 10) {
            quizTimer.style.color = 'var(--google-red)';
        } else {
            quizTimer.style.color = 'inherit';
        }
        
        if (timer <= 0) {
            clearInterval(timerInterval);
            submitQuiz();
        }
    }, 1000);
}

// Render Question
function renderQuestion() {
    const q = questions[currentQuestionIndex];
    quizProgress.textContent = `Question ${currentQuestionIndex + 1}/${questions.length}`;
    questionText.textContent = q.text;
    
    if (q.image) {
        questionImage.src = q.image;
        questionImage.classList.remove('hidden');
    } else {
        questionImage.classList.add('hidden');
    }

    optionsContainer.innerHTML = '';
    
    q.options.forEach(opt => {
        const btn = document.createElement('button');
        btn.className = 'option-btn';
        btn.textContent = opt;
        
        // Restore selected answer if any
        if (userAnswers[q.id] === opt) {
            btn.classList.add('selected');
        }
        
        btn.onclick = () => selectOption(q.id, opt);
        optionsContainer.appendChild(btn);
    });

    if (currentQuestionIndex === questions.length - 1) {
        nextBtn.textContent = 'Submit';
        nextBtn.className = 'btn btn-red';
    } else {
        nextBtn.textContent = 'Next';
        nextBtn.className = 'btn btn-green';
    }
    
    nextBtn.disabled = !userAnswers[q.id];
}

function selectOption(qId, opt) {
    userAnswers[qId] = opt;
    
    // Update UI
    const buttons = optionsContainer.querySelectorAll('.option-btn');
    buttons.forEach(b => {
        if (b.textContent === opt) {
            b.classList.add('selected');
        } else {
            b.classList.remove('selected');
        }
    });
    
    nextBtn.disabled = false;
}

nextBtn.addEventListener('click', () => {
    if (currentQuestionIndex < questions.length - 1) {
        currentQuestionIndex++;
        renderQuestion();
    } else {
        submitQuiz();
    }
});

// Submit Quiz
async function submitQuiz() {
    clearInterval(timerInterval);
    nextBtn.disabled = true;
    nextBtn.textContent = 'Submitting...';

    try {
        const res = await fetch(`${API_BASE}/submit`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ answers: userAnswers })
        });
        
        const data = await res.json();
        
        if (!res.ok) {
            throw new Error(data.error || 'Submission failed');
        }

        resultScore.textContent = data.score;
        resultTime.textContent = data.timeTaken;
        
        if (currentRound >= totalRounds) {
            nextRoundBtn.classList.add('hidden');
            finishMsg.classList.remove('hidden');
        } else {
            nextRoundBtn.classList.remove('hidden');
            finishMsg.classList.add('hidden');
            nextRoundBtn.textContent = `Start Round ${currentRound + 1}`;
        }

        showScreen('result');

    } catch (error) {
        alert(error.message);
        nextBtn.disabled = false;
        nextBtn.textContent = 'Submit';
    }
}

nextRoundBtn.addEventListener('click', () => {
    currentRound++;
    roundIndicator.textContent = `Round ${currentRound}`;
    loginError.textContent = '';
    showScreen('login');
});

// Screen Management
function showScreen(screenName) {
    loginScreen.classList.add('hidden');
    quizScreen.classList.add('hidden');
    resultScreen.classList.add('hidden');

    if (screenName === 'login') loginScreen.classList.remove('hidden');
    if (screenName === 'quiz') quizScreen.classList.remove('hidden');
    if (screenName === 'result') resultScreen.classList.remove('hidden');
}
