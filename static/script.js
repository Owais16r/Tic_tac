const BACKEND_URL = window.location.origin;
const socket = io();

const symbols = ["X", "O", "△", "□", "★", "♥"];
let board = [];
let currentPlayerIndex = 0;
let gameMode = 'ai';
let playerCount = 2;
let BOARD_SIZE = 3;
let WIN = 3;
let gameActive = false;
let gamePaused = false;
let roomCode = '';
let currentUser = null;
let authToken = null;
let isSpectator = false;
let moveHistoryLog = [];
let soundEnabled = true;
let heatmapActive = false;
let myPlayerIndex = 0;

const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

function playSound(type) {
    if (!soundEnabled) return;
    if (audioCtx.state === 'suspended') { audioCtx.resume(); }
    const osc = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();
    osc.connect(gainNode);
    gainNode.connect(audioCtx.destination);
    const now = audioCtx.currentTime;

    if (type === 'move') {
        osc.type = 'sine'; osc.frequency.setValueAtTime(450, now); osc.frequency.exponentialRampToValueAtTime(800, now + 0.08);
        gainNode.gain.setValueAtTime(0.15, now); gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.08);
        osc.start(now); osc.stop(now + 0.08);
    } else if (type === 'win') {
        osc.type = 'triangle'; osc.frequency.setValueAtTime(523.25, now); osc.frequency.setValueAtTime(659.25, now + 0.1);
        gainNode.gain.setValueAtTime(0.2, now); gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.6);
        osc.start(now); osc.stop(now + 0.6);
    } else if (type === 'draw') {
        osc.type = 'sawtooth'; osc.frequency.setValueAtTime(300, now); osc.frequency.linearRampToValueAtTime(150, now + 0.3);
        gainNode.gain.setValueAtTime(0.15, now); gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.3);
        osc.start(now); osc.stop(now + 0.3);
    }
}

let turnTimer = null;
let timeLeft = 10;

const winAuth = document.getElementById('window-auth');
const winSetup = document.getElementById('window-setup');
const winGame = document.getElementById('window-game');
const winLeaderboard = document.getElementById('window-leaderboard');

const loginBtn = document.getElementById('login-btn');
const registerBtn = document.getElementById('register-btn');
const authUsernameInput = document.getElementById('auth-username');
const authPasswordInput = document.getElementById('auth-password');
const authStatus = document.getElementById('auth-status');
const displayUsername = document.getElementById('display-username');
const soundToggleBtn = document.getElementById('sound-toggle-btn');

soundToggleBtn.addEventListener('click', () => {
    soundEnabled = !soundEnabled;
    soundToggleBtn.innerHTML = soundEnabled ? '<i class="fas fa-volume-up"></i> SFX: ON' : '<i class="fas fa-volume-mute"></i> SFX: OFF';
});

const startMatchBtn = document.getElementById('start-match-btn');
const pauseResumeBtn = document.getElementById('pause-resume-btn');
const endMatchBtn = document.getElementById('end-match-btn');
const backToSetupBtn = document.getElementById('back-to-setup-btn');

const gameModeSelect = document.getElementById('game-mode');
const playerCountSelect = document.getElementById('player-count');
const winLengthContainer = document.getElementById('win-length-container');
const winLengthSelect = document.getElementById('win-length-select');
const rulesBox = document.getElementById('rules-box');
const boardElement = document.getElementById('board');
const statusMessage = document.getElementById('status-message');
const participantsList = document.getElementById('participants-list');

const createRoomBtn = document.getElementById('create-room-btn');
const joinRoomBtn = document.getElementById('join-btn');
const spectateBtn = document.getElementById('spectate-btn');
const roomCodeInput = document.getElementById('room-code');
const roomDisplay = document.getElementById('room-display');

const chatInput = document.getElementById('chat-input');
const sendChatBtn = document.getElementById('send-chat-btn');
const chatBox = document.getElementById('chat-box');
const timerDisplay = document.getElementById('timer-display');
const timeRemainingSpan = document.getElementById('time-remaining');

const heatmapBtn = document.getElementById('heatmap-btn');
const getHintBtn = document.getElementById('get-hint-btn');
const aiProbBar = document.getElementById('ai-prob-bar');
const probText = document.getElementById('prob-text');

const matchResultSummary = document.getElementById('match-result-summary');

function switchWindow(targetWin) {
    [winAuth, winSetup, winGame, winLeaderboard].forEach(w => w.classList.add('hidden'));
    targetWin.classList.remove('hidden');
}

playerCountSelect.addEventListener('change', () => {
    const pCount = parseInt(playerCountSelect.value);
    winLengthSelect.innerHTML = '';
    if (pCount === 2) {
        winLengthContainer.classList.add('hidden');
        BOARD_SIZE = 3; WIN = 3;
        rulesBox.innerHTML = `<strong>Rules to Win (2 Players - 3x3):</strong> Align 3 consecutive symbols horizontally, vertically, or diagonally.`;
    } else if (pCount <= 4) {
        winLengthContainer.classList.remove('hidden');
        BOARD_SIZE = 5;
        [4, 5].forEach(val => {
            const opt = document.createElement('option');
            opt.value = val; opt.innerText = `${val} consecutive symbols`;
            winLengthSelect.appendChild(opt);
        });
        rulesBox.innerHTML = `<strong>Rules to Win (${pCount} Players - 5x5):</strong> Align ${winLengthSelect.value || 4} consecutive symbols to win!`;
    } else {
        winLengthContainer.classList.remove('hidden');
        BOARD_SIZE = 7;
        [4, 5, 6].forEach(val => {
            const opt = document.createElement('option');
            opt.value = val; opt.innerText = `${val} consecutive symbols`;
            winLengthSelect.appendChild(opt);
        });
        rulesBox.innerHTML = `<strong>Rules to Win (${pCount} Players - 7x7):</strong> Align ${winLengthSelect.value || 5} consecutive symbols to win!`;
    }
});

winLengthSelect.addEventListener('change', () => {
    WIN = parseInt(winLengthSelect.value);
    rulesBox.innerHTML = `<strong>Rules to Win:</strong> Align ${WIN} consecutive matching symbols on the ${BOARD_SIZE}x${BOARD_SIZE} grid.`;
});

async function handleAuth(endpoint) {
    const username = authUsernameInput.value.trim();
    const password = authPasswordInput.value.trim();
    if (!username || !password || username.length < 3 || password.length < 6) {
        authStatus.innerText = "Error: Username ≥ 3 chars, Password ≥ 6 chars.";
        authStatus.style.color = "#ff0055"; return;
    }
    try {
        const response = await fetch(`${BACKEND_URL}/${endpoint}`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        const data = await response.json();
        if (response.ok && data.success) {
            currentUser = username;
            if (data.access_token) authToken = data.access_token;
            displayUsername.innerText = currentUser;
            switchWindow(winSetup);
            fetchMatchHistory();
        } else {
            authStatus.innerText = data.message || "Authentication failed.";
            authStatus.style.color = "#ff0055";
        }
    } catch (e) {
        authStatus.innerText = "Server offline."; authStatus.style.color = "#ff0055";
    }
}

loginBtn.addEventListener('click', () => handleAuth('login'));
registerBtn.addEventListener('click', () => handleAuth('register'));

createRoomBtn.addEventListener('click', () => {
    roomCode = Math.random().toString(36).substring(2, 7).toUpperCase();
    gameMode = 'online'; isSpectator = false; myPlayerIndex = 0;
    socket.emit('join_room', { room: roomCode, username: currentUser || 'Guest', spectator: false });
    roomDisplay.innerText = `Room Created! Code: ${roomCode}`;
    roomDisplay.classList.remove('hidden');
    startOnlineMatch();
});

joinRoomBtn.addEventListener('click', () => {
    const code = roomCodeInput.value.trim().toUpperCase();
    if (code) {
        roomCode = code; gameMode = 'online'; isSpectator = false; myPlayerIndex = 1;
        socket.emit('join_room', { room: roomCode, username: currentUser || 'Guest', spectator: false });
        roomDisplay.innerText = `Joined Arena: ${roomCode}`;
        roomDisplay.classList.remove('hidden');
        startOnlineMatch();
    } else { alert("Enter room code."); }
});

spectateBtn.addEventListener('click', () => {
    const code = roomCodeInput.value.trim().toUpperCase();
    if (code) {
        roomCode = code; gameMode = 'online'; isSpectator = true; myPlayerIndex = -1;
        socket.emit('join_room', { room: roomCode, username: currentUser || 'Guest', spectator: true });
        roomDisplay.innerText = `Spectating Room: ${roomCode}`;
        roomDisplay.classList.remove('hidden');
        startOnlineMatch();
    } else { alert("Enter room code to spectate."); }
});

function startOnlineMatch() {
    BOARD_SIZE = 3; WIN = 3; playerCount = 2;
    switchWindow(winGame);
    boardElement.style.setProperty('--grid-size', BOARD_SIZE);
    boardElement.innerHTML = '';
    
    board = Array(BOARD_SIZE * BOARD_SIZE).fill(' ');
    currentPlayerIndex = 0; gameActive = true; gamePaused = false; moveHistoryLog = []; heatmapActive = false;
    
    renderParticipantsSidebar();
    statusMessage.innerText = `Online Match Live! Player 1 (X) turn.`;
    updateWinProbability();

    for (let i = 0; i < BOARD_SIZE * BOARD_SIZE; i++) {
        const cell = document.createElement('div');
        cell.classList.add('cell');
        cell.dataset.index = i;
        cell.addEventListener('click', () => handleCellClick(i, cell));
        boardElement.appendChild(cell);
    }
    startTimer();
}

startMatchBtn.addEventListener('click', () => {
    gameMode = gameModeSelect.value;
    if (gameMode === 'online') {
        alert("Please use 'Create Room' or 'Join' for online multiplayer mode.");
        return;
    }
    playerCount = parseInt(playerCountSelect.value);
    if (gameMode === 'ai') { playerCount = 2; BOARD_SIZE = 3; WIN = 3; }
    else if (playerCount === 2) { BOARD_SIZE = 3; WIN = 3; }
    else if (playerCount <= 4) { BOARD_SIZE = 5; WIN = parseInt(winLengthSelect.value) || 4; }
    else { BOARD_SIZE = 7; WIN = parseInt(winLengthSelect.value) || 5; }

    switchWindow(winGame);
    boardElement.style.setProperty('--grid-size', BOARD_SIZE);
    boardElement.innerHTML = '';
    
    board = Array(BOARD_SIZE * BOARD_SIZE).fill(' ');
    currentPlayerIndex = 0; gameActive = true; gamePaused = false; moveHistoryLog = []; heatmapActive = false;
    pauseResumeBtn.innerHTML = '<i class="fas fa-pause"></i> Pause Game';
    
    renderParticipantsSidebar();
    const players = symbols.slice(0, playerCount);
    statusMessage.innerText = `Match Live! Player 1 (${players[0]}) turn.`;
    updateWinProbability();

    for (let i = 0; i < BOARD_SIZE * BOARD_SIZE; i++) {
        const cell = document.createElement('div');
        cell.classList.add('cell');
        cell.dataset.index = i;
        cell.addEventListener('click', () => handleCellClick(i, cell));
        boardElement.appendChild(cell);
    }
    startTimer();
});

function renderParticipantsSidebar() {
    participantsList.innerHTML = '';
    const players = symbols.slice(0, playerCount);
    for (let i = 0; i < playerCount; i++) {
        const div = document.createElement('div');
        div.style.display = 'flex'; div.style.justifyContent = 'space-between'; div.style.alignItems = 'center';
        div.style.background = 'rgba(0,0,0,0.3)'; div.style.padding = '6px 10px'; div.style.borderRadius = '6px';
        div.innerHTML = `<span><i class="fas fa-user"></i> Player ${i+1}</span> <strong style="color: ${['#00e5ff','#ff0055','#00ff00','#ffaa00'][i%4]};">${players[i]}</strong>`;
        participantsList.appendChild(div);
    }
}

pauseResumeBtn.addEventListener('click', () => {
    if (!gameActive) return;
    gamePaused = !gamePaused;
    if (gamePaused) {
        clearInterval(turnTimer); timerDisplay.classList.add('hidden');
        pauseResumeBtn.innerHTML = '<i class="fas fa-play"></i> Resume Game';
        statusMessage.innerText = "Game Paused.";
    } else {
        pauseResumeBtn.innerHTML = '<i class="fas fa-pause"></i> Pause Game';
        statusMessage.innerText = "Game Resumed!";
        startTimer();
    }
});

endMatchBtn.addEventListener('click', () => {
    gameActive = false; gamePaused = false; clearInterval(turnTimer);
    switchWindow(winSetup);
});

backToSetupBtn.addEventListener('click', () => {
    switchWindow(winSetup);
    fetchMatchHistory();
});

function startTimer() {
    clearInterval(turnTimer);
    if (!gameActive || gamePaused) return;
    if (gameMode === 'ai' && currentPlayerIndex === 1) { timerDisplay.classList.add('hidden'); return; }
    timeLeft = 10; timeRemainingSpan.innerText = timeLeft;
    timerDisplay.classList.remove('hidden');
    
    turnTimer = setInterval(() => {
        if (!gameActive || gamePaused) { clearInterval(turnTimer); timerDisplay.classList.add('hidden'); return; }
        timeLeft--; timeRemainingSpan.innerText = timeLeft;
        if (timeLeft <= 0) { clearInterval(turnTimer); handleTimeOut(); }
    }, 1000);
}

function handleTimeOut() {
    if (!gameActive || gamePaused) return;
    currentPlayerIndex = (currentPlayerIndex + 1) % playerCount;
    statusMessage.innerText = `Turn timed out! Next player turn.`;
    startTimer();
}

async function handleCellClick(index, cellElement) {
    if (!gameActive || gamePaused || board[index] !== ' ' || isSpectator) return;
    
    if (gameMode === 'online' && currentPlayerIndex !== myPlayerIndex) {
        statusMessage.innerText = "Not your turn!";
        return;
    }
    if (gameMode === 'ai' && currentPlayerIndex !== 0) return;

    const players = symbols.slice(0, playerCount);
    const sym = players[currentPlayerIndex];

    moveHistoryLog.push({ index, symbol: sym, boardState: [...board] });

    if (gameMode === 'online') {
        makeMoveLocally(index, sym, cellElement);
        socket.emit('make_move', { room: roomCode, index: index, symbol: sym, board: board, turnIndex: currentPlayerIndex });
    } else {
        makeMoveLocally(index, sym, cellElement);
        if (gameMode === 'ai' && gameActive && !gamePaused && currentPlayerIndex === 1) {
            statusMessage.innerText = "AI thinking...";
            await processAIMove();
        }
    }
}

function makeMoveLocally(index, symbol, cellElement) {
    board[index] = symbol;
    cellElement.innerText = symbol;
    cellElement.classList.add('taken');
    cellElement.style.boxShadow = 'none';
    playSound('move');
    
    const colors = ['#00e5ff', '#ff0055', '#00ff00', '#ffaa00', '#aa00ff', '#ff00ff'];
    cellElement.style.color = colors[symbols.indexOf(symbol) % colors.length];

    updateWinProbability();

    if (check_win(symbol)) {
        clearInterval(turnTimer); timerDisplay.classList.add('hidden');
        const winnerName = `Player ${symbols.indexOf(symbol) + 1} (${symbol})`;
        statusMessage.innerText = `${winnerName} Wins!`;
        gameActive = false; playSound('win');
        saveMatchAndShowLeaderboard(winnerName);
        return;
    }
    if (!board.includes(' ')) {
        clearInterval(turnTimer); timerDisplay.classList.add('hidden');
        statusMessage.innerText = "Match Draw!";
        gameActive = false; playSound('draw');
        saveMatchAndShowLeaderboard("Draw");
        return;
    }

    currentPlayerIndex = (currentPlayerIndex + 1) % playerCount;
    statusMessage.innerText = `Player ${currentPlayerIndex + 1} turn.`;
    if (heatmapActive) renderHeatmapUI();
    startTimer();
}

function updateWinProbability() {
    let emptyCount = board.filter(v => v === ' ').length;
    let total = BOARD_SIZE * BOARD_SIZE;
    let p1Chance = Math.floor(((total - emptyCount) / total) * 50 + 50);
    if (gameMode === 'ai' && currentPlayerIndex === 1) p1Chance = Math.max(15, p1Chance - 25);
    aiProbBar.style.width = `${p1Chance}%`;
    probText.innerText = `${p1Chance}%`;
}

getHintBtn.addEventListener('click', async () => {
    if (!gameActive || gamePaused) return;
    const emptyIndices = board.map((v, i) => v === ' ' ? i : null).filter(v => v !== null);
    if (emptyIndices.length === 0) return;

    let targetedMove = -1;
    const currentSym = symbols[currentPlayerIndex];
    
    for (let idx of emptyIndices) {
        board[idx] = currentSym;
        if (check_win(currentSym)) { targetedMove = idx; board[idx] = ' '; break; }
        board[idx] = ' ';
    }

    if (targetedMove === -1) {
        for (let nextPlayer = 1; nextPlayer < playerCount; nextPlayer++) {
            const oppSym = symbols[(currentPlayerIndex + nextPlayer) % playerCount];
            for (let idx of emptyIndices) {
                board[idx] = oppSym;
                if (check_win(oppSym)) { targetedMove = idx; board[idx] = ' '; break; }
                board[idx] = ' ';
            }
            if (targetedMove !== -1) break;
        }
    }

    if (targetedMove === -1) {
        const center = Math.floor((BOARD_SIZE * BOARD_SIZE) / 2);
        if (board[center] === ' ') { targetedMove = center; }
        else { targetedMove = emptyIndices[Math.floor(Math.random() * emptyIndices.length)]; }
    }

    const cell = document.querySelector(`.cell[data-index='${targetedMove}']`);
    if (cell) {
        cell.style.boxShadow = '0 0 20px #00ff00';
        setTimeout(() => { cell.style.boxShadow = 'none'; }, 2500);
        statusMessage.innerText = `AI Coach Hint: Recommended optimal strategic position highlighted in green!`;
    }
});

heatmapBtn.addEventListener('click', async () => {
    if (!gameActive || gamePaused) return;
    heatmapActive = !heatmapActive;
    if (heatmapActive) {
        heatmapBtn.style.background = '#00e5ff'; heatmapBtn.style.color = '#0f111a';
        await renderHeatmapUI();
    } else {
        heatmapBtn.style.background = 'rgba(255, 255, 255, 0.08)'; heatmapBtn.style.color = 'white';
        document.querySelectorAll('.cell').forEach(c => c.style.background = 'rgba(0, 0, 0, 0.6)');
    }
});

async function renderHeatmapUI() {
    try {
        const res = await fetch(`${BACKEND_URL}/get_heatmap`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ board }) });
        const data = await res.json();
        if (data.success && data.heatmap) {
            data.heatmap.forEach((val, idx) => {
                const cell = document.querySelector(`.cell[data-index='${idx}']`);
                if (cell && board[idx] === ' ') {
                    cell.style.background = `rgba(252, 163, 17, ${Math.min(0.7, Math.max(0.1, val))})`;
                }
            });
        }
    } catch(e) {}
}

function saveMatchAndShowLeaderboard(winner) {
    fetch(`${BACKEND_URL}/save_match`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${authToken}` },
        body: JSON.stringify({ size: BOARD_SIZE, players: playerCount, winner: winner, move_log: moveHistoryLog })
    }).then(() => {
        matchResultSummary.innerText = `Result: ${winner}`;
        fetchLeaderboardModal();
        switchWindow(winLeaderboard);
    }).catch(e => console.error("Save match error", e));
}

async function fetchLeaderboardModal() {
    try {
        const res = await fetch(`${BACKEND_URL}/leaderboard`);
        const data = await res.json();
        const list = document.getElementById('leaderboard-list');
        list.innerHTML = '';
        if (Array.isArray(data)) {
            data.forEach((user, idx) => {
                const li = document.createElement('li');
                li.style.display = 'flex'; li.style.justifyContent = 'space-between'; li.style.padding = '4px 0';
                li.innerHTML = `<span>#${idx+1} ${user.username}</span> <strong style="color: #00e5ff;">${user.elo} ELO</strong>`;
                list.appendChild(li);
            });
        }
    } catch(e) {}
}

function horizontal(sym) {
    for (let r = 0; r < BOARD_SIZE; r++) {
        for (let c = 0; c <= BOARD_SIZE - WIN; c++) {
            let cnt = 0; for (let i = 0; i < WIN; i++) if (board[r * BOARD_SIZE + (c + i)] === sym) cnt++;
            if (cnt === WIN) return true;
        }
    }
    return false;
}
function vertical(sym) {
    for (let c = 0; c < BOARD_SIZE; c++) {
        for (let r = 0; r <= BOARD_SIZE - WIN; r++) {
            let cnt = 0; for (let i = 0; i < WIN; i++) if (board[(r + i) * BOARD_SIZE + c] === sym) cnt++;
            if (cnt === WIN) return true;
        }
    }
    return false;
}
function diagonal1(sym) {
    for (let r = 0; r <= BOARD_SIZE - WIN; r++) {
        for (let c = 0; c <= BOARD_SIZE - WIN; c++) {
            let cnt = 0; for (let i = 0; i < WIN; i++) if (board[(r + i) * BOARD_SIZE + (c + i)] === sym) cnt++;
            if (cnt === WIN) return true;
        }
    }
    return false;
}
function diagonal2(sym) {
    for (let r = WIN - 1; r < BOARD_SIZE; r++) {
        for (let c = 0; c <= BOARD_SIZE - WIN; c++) {
            let cnt = 0; for (let i = 0; i < WIN; i++) if (board[(r - i) * BOARD_SIZE + (c + i)] === sym) cnt++;
            if (cnt === WIN) return true;
        }
    }
    return false;
}
function check_win(sym) { return horizontal(sym) || vertical(sym) || diagonal1(sym) || diagonal2(sym); }

async function processAIMove() {
    const empty = board.map((v, i) => v === ' ' ? i : null).filter(v => v !== null);
    if (empty.length === 0) return;
    let move = empty[Math.floor(Math.random() * empty.length)];
    try {
        const res = await fetch(`${BACKEND_URL}/ai_move`, { method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({board}) });
        const data = await res.json();
        if (data.move !== undefined && board[data.move] === ' ') move = data.move;
    } catch(e) {}
    setTimeout(() => {
        if (!gameActive || gamePaused) return;
        moveHistoryLog.push({ index: move, symbol: symbols[1], boardState: [...board] });
        const cell = document.querySelector(`.cell[data-index='${move}']`);
        makeMoveLocally(move, symbols[1], cell);
    }, 500);
}

socket.on('room_notification', (data) => {
    const div = document.createElement('div');
    div.innerHTML = `<span style="color: #fca311;">SYSTEM:</span> ${data.message}`;
    chatBox.appendChild(div); chatBox.scrollTop = chatBox.scrollHeight;
});

socket.on('sync_state', (state) => {
    if (state && state.board) {
        board = state.board;
        currentPlayerIndex = state.turn !== undefined ? state.turn : 0;
        BOARD_SIZE = state.size || 3;
        playerCount = state.players || 2;
        gameActive = true; gamePaused = false;
        
        switchWindow(winGame);
        boardElement.style.setProperty('--grid-size', BOARD_SIZE);
        boardElement.innerHTML = '';
        
        for (let i = 0; i < (BOARD_SIZE * BOARD_SIZE); i++) {
            const cell = document.createElement('div');
            cell.classList.add('cell');
            cell.dataset.index = i;
            cell.innerText = board[i] || ' ';
            if (board[i] && board[i] !== ' ') cell.classList.add('taken');
            cell.addEventListener('click', () => handleCellClick(i, cell));
            boardElement.appendChild(cell);
        }
        statusMessage.innerText = `State Synced! Player ${currentPlayerIndex + 1} turn.`;
        startTimer();
    }
});

socket.on('receive_move', (data) => {
    if (data && data.board) {
        board = data.board;
        currentPlayerIndex = data.turnIndex !== undefined ? data.turnIndex : 0;
        
        boardElement.innerHTML = '';
        boardElement.style.setProperty('--grid-size', BOARD_SIZE);
        for (let i = 0; i < (BOARD_SIZE * BOARD_SIZE); i++) {
            const cell = document.createElement('div');
            cell.classList.add('cell');
            cell.dataset.index = i;
            cell.innerText = board[i] || ' ';
            if (board[i] && board[i] !== ' ') {
                cell.classList.add('taken');
                const colors = ['#00e5ff', '#ff0055', '#00ff00', '#ffaa00', '#aa00ff', '#ff00ff'];
                cell.style.color = colors[symbols.indexOf(board[i]) % colors.length];
            }
            cell.addEventListener('click', () => handleCellClick(i, cell));
            boardElement.appendChild(cell);
        }
        
        playSound('move');
        updateWinProbability();

        if (check_win(data.symbol)) {
            clearInterval(turnTimer); timerDisplay.classList.add('hidden');
            statusMessage.innerText = `Player (${data.symbol}) Wins!`;
            gameActive = false; playSound('win');
            return;
        }

        statusMessage.innerText = `Player ${currentPlayerIndex + 1} turn.`;
        startTimer();
    }
});

socket.on('receive_chat', (data) => {
    const div = document.createElement('div');
    div.innerHTML = `<span style="color: #00e5ff;">${data.username}:</span> ${data.msg}`;
    chatBox.appendChild(div); chatBox.scrollTop = chatBox.scrollHeight;
});

sendChatBtn.addEventListener('click', sendChat);
chatInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') sendChat(); });

function sendChat() {
    const msg = chatInput.value.trim();
    if (msg && roomCode) {
        socket.emit('chat_message', { room: roomCode, username: currentUser || 'Guest', msg });
        chatInput.value = '';
    }
}

async function fetchMatchHistory() {
    try {
        const headers = { 'Content-Type': 'application/json' };
        if (authToken) { headers['Authorization'] = `Bearer ${authToken}`; } else { return; }

        const res = await fetch(`${BACKEND_URL}/history`, { headers });
        const data = await res.json();
        const list = document.getElementById('match-history-list');
        list.innerHTML = '';
        
        if (Array.isArray(data) && data.length > 0) {
            data.forEach(match => {
                const li = document.createElement('li');
                li.style.display = 'flex'; li.style.justifyContent = 'space-between'; li.style.alignItems = 'center'; li.style.padding = '4px 0';
                li.innerHTML = `<span>${match.size}x${match.size} | P:${match.players} | Win:${match.winner}</span>`;
                if (match.move_log && match.move_log.length > 0) {
                    const btn = document.createElement('button');
                    btn.className = 'btn-secondary'; btn.style.padding = '2px 6px'; btn.style.fontSize = '0.7rem';
                    btn.innerText = 'Replay'; btn.onclick = () => openReplayModal(match.move_log, match.size);
                    li.appendChild(btn);
                }
                list.appendChild(li);
            });
        } else {
            list.innerHTML = `<li>No personal match history found.</li>`;
        }
    } catch(e) {}
}

const replayModal = document.getElementById('replay-modal');
const replayBoard = document.getElementById('replay-board');
const replayStatus = document.getElementById('replay-status');
const replayPrev = document.getElementById('replay-prev');
const replayNext = document.getElementById('replay-next');
const replayClose = document.getElementById('replay-close');
let currentReplayLogs = []; let replayStepIndex = 0;

function openReplayModal(logs, size) {
    currentReplayLogs = logs; replayStepIndex = 0; BOARD_SIZE = size;
    replayModal.classList.remove('hidden'); renderReplayStep();
}
function renderReplayStep() {
    replayBoard.style.setProperty('--grid-size', BOARD_SIZE);
    replayBoard.innerHTML = '';
    let displayBoard = Array(BOARD_SIZE * BOARD_SIZE).fill(' ');
    if (replayStepIndex > 0 && currentReplayLogs.length > 0) {
        const targetLog = currentReplayLogs[replayStepIndex - 1];
        if (targetLog && targetLog.boardState) {
            displayBoard = [...targetLog.boardState]; displayBoard[targetLog.index] = targetLog.symbol;
        }
    }
    for (let i = 0; i < BOARD_SIZE * BOARD_SIZE; i++) {
        const cell = document.createElement('div'); cell.classList.add('cell'); cell.innerText = displayBoard[i];
        replayBoard.appendChild(cell);
    }
    replayStatus.innerText = `Step ${replayStepIndex} / ${currentReplayLogs.length}`;
}
replayNext.addEventListener('click', () => { if (replayStepIndex < currentReplayLogs.length) { replayStepIndex++; renderReplayStep(); } });
replayPrev.addEventListener('click', () => { if (replayStepIndex > 0) { replayStepIndex--; renderReplayStep(); } });
replayClose.addEventListener('click', () => { replayModal.classList.add('hidden'); });