/**
 * OrderlyCore - Production Grade Discord Bot
 * 
 * Main entry point for the application.
 * Responsibility: Initialize configuration, express server, and Discord bot.
 */

require('dotenv').config();
const express = require('express');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const path = require('node:path');
const fs = require('node:fs');
const chalk = require('chalk');

const { validateEnv, PORT, NODE_ENV, FRONTEND_URL } = require('./src/config/env');
const { client, loadCommands, loadEvents } = require('./src/config/discord');

// 1. Validate Environment Variables
validateEnv();

const app = express();

// 2. Express Middleware Setup
app.use(cors({
    origin: [FRONTEND_URL, 'http://localhost:3000'].filter(Boolean),
    credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: true,
    cookie: {
        secure: NODE_ENV === 'production',
        httpOnly: true,
        maxAge: 24 * 60 * 60 * 1000
    }
}));
app.use(express.static(path.join(__dirname, 'public')));

// 3. Security Headers Middleware
app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    next();
});

// 4. API & Authentication Routes
app.use('/api', require('./src/routes/auth'));
app.use('/api', require('./src/routes/api'));
app.use('/api/admin', require('./src/routes/admin'));

// 5. Basic Health & Static Routes
app.get('/health', (_req, res) => {
    res.status(client.isReady() ? 200 : 503).json({
        status: client.isReady() ? 'ok' : 'degraded',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        memory: process.memoryUsage()
    });
});

app.get('/dashboard', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'dashboard.html')));
app.get('/login', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/admin', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

// 6. Catch-all / SPA Fallback
app.get('*', (req, res) => {
    if (!req.path.startsWith('/api/')) {
        const filePath = path.join(__dirname, 'public', req.path);
        // Serve file if it exists, otherwise redirect to dashboard
        if (fs.existsSync(filePath) && fs.lstatSync(filePath).isFile()) {
            return res.sendFile(filePath);
        }
        return res.redirect('/dashboard');
    }
    res.status(404).json({ error: 'Not Found' });
});

// 7. Discord Bot Initialization
const commands = loadCommands();
loadEvents();

// 8. Bot Login & Command Deployment
client.login(process.env.DISCORD_TOKEN).then(async () => {
    console.log(chalk.green('✅ Discord bot logged in.'));
    const { deployCommands } = require('./src/config/discord');
    await deployCommands(commands);
}).catch(err => {
    console.error(chalk.red('❌ Discord bot login failed:'), err);
});

// 9. Server Initialization
if (require.main === module) {
    app.listen(PORT, () => {
        console.log(chalk.bold.cyan(`
--------------------------------------------------
🚀 OrderlyCore Bot is starting up!
🌐 Web Server: http://localhost:${PORT}
🔧 Environment: ${NODE_ENV}
--------------------------------------------------
        `));
    });
}

// 10. Global Error Handlers
process.on('unhandledRejection', (reason, promise) => {
    console.error(chalk.red('Unhandled Rejection at:', promise, 'reason:', reason));
});

process.on('uncaughtException', (err) => {
    console.error(chalk.red('Uncaught Exception thrown:'), err);
});

module.exports = app;
