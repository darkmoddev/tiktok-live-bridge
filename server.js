const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const { WebcastPushConnection } = require('tiktok-live-connector');

const app = express();
app.use(cors());
app.use(express.json());

// Rota simples de teste para o Render não dar erro
app.get('/', (req, res) => {
    res.send('Servidor do TikTok Live rodando perfeitamente!');
});

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

let tiktokLiveConnection = null;
let currentTikTokUsername = '';
let reconnectTimeout = null;
let reconnectAttempts = 0;

function connectToTikTok(username) {
    if (!username || username.trim() === '') return;

    if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
        reconnectTimeout = null;
    }
    reconnectAttempts = 0;

    if (tiktokLiveConnection) {
        try {
            tiktokLiveConnection.disconnect();
        } catch (err) {
            console.error('Erro ao desconectar conexão anterior:', err);
        }
    }

    const cleanUsername = username.replace(/^@/, '').trim();
    currentTikTokUsername = cleanUsername;
    io.emit('sys_message', { type: 'info', text: `Conectando ao TikTok Live de @${cleanUsername}...` });

    tiktokLiveConnection = new WebcastPushConnection(cleanUsername);
    bindConnectionEvents();

    tiktokLiveConnection.connect().then(state => {
        io.emit('sys_message', { type: 'success', text: `Conectado com sucesso!` });
        reconnectAttempts = 0;
    }).catch(err => {
        let errorMsg = err.message || String(err);
        if (errorMsg.includes("Failed to retrieve room id")) {
            errorMsg = "Perfil offline ou incorreto. Inicie a Live primeiro.";
        }
        io.emit('sys_message', { type: 'error', text: `Erro: ${errorMsg}` });
    });
}

function bindConnectionEvents() {
    if (!tiktokLiveConnection) return;

    tiktokLiveConnection.on('chat', data => {
        io.emit('tiktok_chat', {
            username: data.uniqueId,
            nickname: data.nickname,
            comment: data.comment,
            profilePictureUrl: data.profilePictureUrl
        });
    });

    tiktokLiveConnection.on('gift', data => {
        io.emit('tiktok_gift', {
            username: data.uniqueId,
            userId: data.userId,
            nickname: data.nickname,
            giftName: data.giftName,
            giftId: data.giftId,
            giftType: data.giftType,
            repeatCount: data.repeatCount,
            repeatEnd: data.repeatEnd,
            profilePictureUrl: data.profilePictureUrl
        });
    });

    tiktokLiveConnection.on('disconnected', () => {
        handleDisconnect();
    });
}

function handleDisconnect() {
    const MAX_RECONNECT_ATTEMPTS = 3;
    if (currentTikTokUsername && reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
        reconnectAttempts++;
        const delay = 8000 * reconnectAttempts;
        io.emit('sys_message', { type: 'warning', text: `Conexão perdida. Reconectando (${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS}) em ${delay/1000}s...` });
        
        if (reconnectTimeout) clearTimeout(reconnectTimeout);
        reconnectTimeout = setTimeout(() => {
            if (!currentTikTokUsername) return;
            tiktokLiveConnection = new WebcastPushConnection(currentTikTokUsername);
            bindConnectionEvents();
            tiktokLiveConnection.connect().then(() => {
                io.emit('sys_message', { type: 'success', text: `Reconectado!` });
                reconnectAttempts = 0;
            }).catch(err => {
                handleDisconnect();
            });
        }, delay);
    } else {
        io.emit('sys_message', { type: 'error', text: 'Conexão perdida definitivamente.' });
        currentTikTokUsername = '';
        tiktokLiveConnection = null;
        reconnectAttempts = 0;
    }
}

io.on('connection', (socket) => {
    if (tiktokLiveConnection && currentTikTokUsername) {
        socket.emit('sys_message', { type: 'success', text: `Live conectada: @${currentTikTokUsername}` });
    }

    socket.on('set_tiktok_username', (username) => {
        connectToTikTok(username);
    });

    socket.on('disconnect_tiktok', () => {
        if (reconnectTimeout) clearTimeout(reconnectTimeout);
        reconnectTimeout = null;
        reconnectAttempts = 0;
        currentTikTokUsername = '';
        if (tiktokLiveConnection) {
            try { tiktokLiveConnection.disconnect(); } catch (e) {}
            tiktokLiveConnection = null;
        }
        io.emit('sys_message', { type: 'info', text: 'Live desconectada.' });
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Servidor rodando na porta ${PORT}`);
});
