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
let currentPage = 0; // For Round 2 pagination
const questionsPerPage = 4;

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
const prevBtn = document.getElementById('prev-btn');
const paginationControls = document.getElementById('pagination-controls');
const pageIndicator = document.getElementById('page-indicator');

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
        const contentType = res.headers.get("content-type");
        if (!contentType || !contentType.includes("application/json")) {
            throw new Error('Server returned an invalid response (not JSON). Server might be down.');
        }
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
                 if (data.failed) {
                     nextRoundBtn.classList.add('hidden');
                     finishMsg.classList.remove('hidden');
                     finishMsg.textContent = "You did not score enough to proceed to the next round.";
                     showScreen('result');
                     return;
                 }
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
                     nextRoundBtn.classList.add('hidden');
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
        
        let data;
        const contentType = res.headers.get("content-type");
        if (contentType && contentType.includes("application/json")) {
            data = await res.json();
        } else {
            throw new Error('Server error: The server is down or database connection failed.');
        }
        
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
        const contentType = res.headers.get("content-type");
        if (!contentType || !contentType.includes("application/json")) {
            throw new Error('Server returned an invalid response. Cannot load questions.');
        }
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
        currentPage = 0; // Reset pagination for Round 2
        userAnswers = {};
        
        renderQuestion();
        showScreen('quiz');
        
    } catch (error) {
        loginError.textContent = error.message;
        showScreen('login');
    }
}

// Timer
function formatTime(seconds) {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`;
}

function startTimer(duration) {
    clearInterval(timerInterval);
    let timer = duration;
    quizTimer.textContent = `Time: ${formatTime(timer)}`;
    
    timerInterval = setInterval(() => {
        timer--;
        quizTimer.textContent = `Time: ${formatTime(timer)}`;
        
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
    if (currentRound === 2) {
        renderRound2Questions();
        return;
    }

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
    
    // Show/hide Previous button
    if (currentQuestionIndex > 0) {
        prevBtn.classList.remove('hidden');
    } else {
        prevBtn.classList.add('hidden');
    }
    
    // Hide pagination controls for rounds 1 and 3
    paginationControls.classList.add('hidden');
    
    nextBtn.disabled = !userAnswers[q.id];
}

function renderRound2Questions() {
    quizProgress.textContent = `Matching Round`;
    questionText.textContent = "Match the emojis to the correct application/tool.";
    questionImage.classList.add('hidden');
    
    optionsContainer.innerHTML = '';
    
    // Calculate pagination
    const totalPages = Math.ceil(questions.length / questionsPerPage);
    const startIndex = currentPage * questionsPerPage;
    const endIndex = Math.min(startIndex + questionsPerPage, questions.length);
    const currentPageQuestions = questions.slice(startIndex, endIndex);
    
    // Render only current page questions
    currentPageQuestions.forEach((q) => {
        const row = document.createElement('div');
        row.style.display = 'flex';
        row.style.flexDirection = 'column';
        row.style.marginBottom = '20px';
        row.style.padding = '15px';
        row.style.border = '2px solid var(--border-color)';
        row.style.borderRadius = '8px';
        row.style.background = '#fdfdfd';
        row.style.textAlign = 'left';
        
        const clueLabel = document.createElement('div');
        clueLabel.textContent = q.text;
        clueLabel.style.fontSize = '2.5rem';
        clueLabel.style.fontWeight = 'bold';
        clueLabel.style.marginBottom = '10px';
        
        const select = document.createElement('select');
        select.className = 'option-select';
        
        const defaultOpt = document.createElement('option');
        defaultOpt.value = '';
        defaultOpt.textContent = '-- Select an answer --';
        defaultOpt.disabled = true;
        defaultOpt.selected = !userAnswers[q.id];
        select.appendChild(defaultOpt);
        
        q.options.forEach(opt => {
            const option = document.createElement('option');
            option.value = opt;
            option.textContent = opt;
            if (userAnswers[q.id] === opt) {
                option.selected = true;
            }
            select.appendChild(option);
        });
        
        select.onchange = (e) => {
            userAnswers[q.id] = e.target.value;
            // Re-render to update button state (only affects last page)
            if (currentPage === Math.ceil(questions.length / questionsPerPage) - 1) {
                renderRound2Questions();
            }
        };
        
        row.appendChild(clueLabel);
        row.appendChild(select);
        optionsContainer.appendChild(row);
    });
    
    // Update pagination controls
    paginationControls.classList.remove('hidden');
    pageIndicator.textContent = `Page ${currentPage + 1}/${totalPages}`;
    
    // Show/hide Previous button for pagination
    if (currentPage > 0) {
        prevBtn.classList.remove('hidden');
        prevBtn.textContent = 'Previous Page';
    } else {
        prevBtn.classList.add('hidden');
    }
    
    // Update Next button text
    if (currentPage === totalPages - 1) {
        nextBtn.textContent = 'Submit';
        nextBtn.className = 'btn btn-red';
        // Only check completion on the last page
        const allAnswered = questions.every(q => userAnswers[q.id]);
        nextBtn.disabled = !allAnswered;
    } else {
        nextBtn.textContent = 'Next Page';
        nextBtn.className = 'btn btn-green';
        nextBtn.disabled = false; // Allow free navigation between pages
    }
}

function checkRound2Completion() {
    const allAnswered = questions.every(q => userAnswers[q.id]);
    nextBtn.disabled = !allAnswered;
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
    if (currentRound === 2) {
        const totalPages = Math.ceil(questions.length / questionsPerPage);
        if (currentPage < totalPages - 1) {
            currentPage++;
            renderRound2Questions();
        } else {
            submitQuiz();
        }
    } else if (currentQuestionIndex < questions.length - 1) {
        currentQuestionIndex++;
        renderQuestion();
    } else {
        submitQuiz();
    }
});

prevBtn.addEventListener('click', () => {
    if (currentRound === 2) {
        if (currentPage > 0) {
            currentPage--;
            renderRound2Questions();
        }
    } else {
        if (currentQuestionIndex > 0) {
            currentQuestionIndex--;
            renderQuestion();
        }
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
        
        const contentType = res.headers.get("content-type");
        if (!contentType || !contentType.includes("application/json")) {
            throw new Error('Server returned an invalid response. Submission may not have been saved.');
        }
        
        const data = await res.json();
        
        if (!res.ok) {
            throw new Error(data.error || 'Submission failed');
        }

        resultScore.textContent = data.score;
        resultTime.textContent = data.timeTaken;
        
        if (!data.passed) {
            nextRoundBtn.classList.add('hidden');
            finishMsg.classList.remove('hidden');
            finishMsg.textContent = "You did not score enough to proceed to the next round.";
        } else if (currentRound >= totalRounds) {
            nextRoundBtn.classList.add('hidden');
            finishMsg.classList.remove('hidden');
            finishMsg.textContent = "Congratulations! You have completed all rounds.";
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
