const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const crypto = require('crypto');

const CONFIG_PATH = './config.txt';
const USERS_PATH = './users.txt';
const STORAGE_DIR = './storage';

function parseSize(str) {
    if (!str) return 0;
    const match = str.trim().toUpperCase().match(/^(\d+(?:\.\d+)?)([KMGTP]?B)?$/);
    if (!match) return parseInt(str, 10) || 0;
    const num = parseFloat(match[1]);
    const unit = match[2] || '';
    switch (unit) {
        case 'KB': return Math.round(num * 1024);
        case 'MB': return Math.round(num * 1024 * 1024);
        case 'GB': return Math.round(num * 1024 * 1024 * 1024);
        case 'TB': return Math.round(num * 1024 * 1024 * 1024 * 1024);
        case 'PB': return Math.round(num * 1024 * 1024 * 1024 * 1024 * 1024);
        default: return Math.round(num);
    }
}

function parseConfig() {
    const config = {};
    fs.readFileSync(CONFIG_PATH, 'utf-8').split('\n').forEach(line => {
        if (!line.trim() || line.trim().startsWith('//')) return;
        const [key, value] = line.split('=');
        if (key && value) config[key.trim()] = value.trim();
    });
    if (config['HARD_LIMIT']) config['HARD_LIMIT'] = parseSize(config['HARD_LIMIT']);
    config['ENABLE_APP'] = config['ENABLE_APP'] !== 'false';
    config['ENABLE_WEB'] = config['ENABLE_WEB'] !== 'false';
    config['PORT'] = config['PORT'] ? parseInt(config['PORT'], 10) : 3000;
    return config;
}

function parseUsers() {
    const users = {};
    fs.readFileSync(USERS_PATH, 'utf-8').split('\n').forEach(line => {
        if (!line.trim() || line.trim().startsWith('//')) return;
        const [username, password, limit] = line.split(',');
        if (!username || !password || !limit) return;
        users[username.trim()] = {
            password: password.trim(),
            limit: parseSize(limit.trim())
        };
    });
    return users;
}

function getUserStorageUsage(username) {
    const userDir = path.join(STORAGE_DIR, username);
    if (!fs.existsSync(userDir)) return 0;
    let total = 0;
    fs.readdirSync(userDir).forEach(file => {
        const filePath = path.join(userDir, file);
        total += fs.statSync(filePath).size;
    });
    return total;
}

function getTotalStorageUsage() {
    if (!fs.existsSync(STORAGE_DIR)) return 0;
    let total = 0;
    fs.readdirSync(STORAGE_DIR).forEach(userDir => {
        const userPath = path.join(STORAGE_DIR, userDir);
        if (fs.statSync(userPath).isDirectory()) {
            fs.readdirSync(userPath).forEach(file => {
                const filePath = path.join(userPath, file);
                total += fs.statSync(filePath).size;
            });
        }
    });
    return total;
}

const config = parseConfig();
const users = parseUsers();
const HARD_LIMIT = config['HARD_LIMIT'] || 50000000000; // default 50GB

if (!fs.existsSync(STORAGE_DIR)) fs.mkdirSync(STORAGE_DIR);

const app = express();
app.use(express.json());

// Serve web app if enabled
if (config.ENABLE_WEB) {
    app.use(express.static(path.join(__dirname, 'webapp')));
    app.get('/', (req, res) => {
        res.sendFile(path.join(__dirname, 'webapp', 'index.html'));
    });
}

function authMiddleware(req, res, next) {
    const { username, password } = req.headers;
    if (!username || !password) return res.status(401).send('Missing credentials');
    const user = users[username];
    if (!user) return res.status(401).send('Invalid user');
    if (password !== user.password) return res.status(401).send('Invalid password');
    req.user = username;
    next();
}

const upload = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => {
            const userDir = path.join(STORAGE_DIR, req.user);
            if (!fs.existsSync(userDir)) fs.mkdirSync(userDir);
            cb(null, userDir);
        },
        filename: (req, file, cb) => cb(null, file.originalname)
    }),
    limits: { fileSize: 1024 * 1024 * 1024 } // 1GB per file max
});

function checkAccess(req, res, next) {
    // If request is from the app (Python), check ENABLE_APP
    // If from web (browser), check ENABLE_WEB
    // Use a custom header 'X-Client-Type' sent by the app, otherwise assume web
    const clientType = req.headers['x-client-type'];
    if (clientType === 'app') {
        if (!config.ENABLE_APP) return res.status(403).send('App access disabled');
    } else {
        if (!config.ENABLE_WEB) return res.status(403).send('Web access disabled');
    }
    next();
}

// API endpoints (all protected by checkAccess)
app.post('/upload', checkAccess, authMiddleware, upload.single('file'), (req, res) => {
    const username = req.user;
    const userLimit = users[username].limit;
    const userUsage = getUserStorageUsage(username);
    const totalUsage = getTotalStorageUsage();
    const fileSize = req.file.size;

    if (userUsage + fileSize > userLimit) {
        fs.unlinkSync(req.file.path);
        return res.status(400).send('User storage limit exceeded');
    }
    if (totalUsage + fileSize > HARD_LIMIT) {
        fs.unlinkSync(req.file.path);
        return res.status(400).send('Server storage hard limit exceeded');
    }
    res.send('File uploaded');
});

app.get('/files', checkAccess, authMiddleware, (req, res) => {
    const userDir = path.join(STORAGE_DIR, req.user);
    if (!fs.existsSync(userDir)) return res.json([]);
    res.json(fs.readdirSync(userDir));
});

app.get('/download/:filename', checkAccess, authMiddleware, (req, res) => {
    const filePath = path.join(STORAGE_DIR, req.user, req.params.filename);
    if (!fs.existsSync(filePath)) return res.status(404).send('File not found');
    res.download(filePath);
});

app.listen(config.PORT, () => {
    console.log('Server running');
});
