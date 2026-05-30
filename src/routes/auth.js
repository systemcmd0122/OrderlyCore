const express = require('express');
const router = express.Router();
const passport = require('passport');
const DiscordStrategy = require('passport-discord').Strategy;
const { ref, get, remove } = require('firebase/database');
const { rtdb } = require('../config/firebase');

// Passport serialization
passport.serializeUser((user, done) => {
    done(null, user);
});

passport.deserializeUser((obj, done) => {
    done(null, obj);
});

// Discord Strategy configuration
passport.use(new DiscordStrategy({
    clientID: process.env.CLIENT_ID,
    clientSecret: process.env.DISCORD_CLIENT_SECRET,
    callbackURL: process.env.CALLBACK_URL,
    scope: ['identify', 'guilds']
}, (accessToken, refreshToken, profile, done) => {
    process.nextTick(() => done(null, profile));
}));

// Discord OAuth routes
router.get('/auth/discord', passport.authenticate('discord'));

router.get('/auth/discord/callback', passport.authenticate('discord', {
    failureRedirect: '/login'
}), (req, res) => {
    // After successful login, we need to decide which guild to manage.
    // If they were trying to access a specific guild or we just take the first one where they have permissions.
    // For simplicity, we redirect to dashboard and let the client handle it if multiple guilds are available,
    // but the current system seems to assume a session-based guildId.

    // Check if the user is in any guilds the bot is in and has Manage Guild permission
    const userGuilds = req.user.guilds;
    const botGuilds = require('../config/discord').client.guilds.cache;

    const manageableGuilds = userGuilds.filter(g => {
        const botGuild = botGuilds.get(g.id);
        const hasPermission = (g.permissions & 0x20) === 0x20; // Manage Guild
        return botGuild && hasPermission;
    });

    if (manageableGuilds.length > 0) {
        req.session.userId = req.user.id;
        req.session.guildId = manageableGuilds[0].id; // Pick first one by default
        res.redirect('/dashboard');
    } else {
        res.redirect('/login?error=no_manageable_guilds');
    }
});

router.post('/verify', async (req, res) => {
    const { token } = req.body;
    if (!token) return res.status(400).json({ error: 'Token is required.' });

    const tokenRef = ref(rtdb, `authTokens/${token}`);
    try {
        const snapshot = await get(tokenRef);
        if (snapshot.exists()) {
            const data = snapshot.val();
            if (data.expiresAt > Date.now()) {
                req.session.userId = data.userId;
                req.session.guildId = data.guildId;
                await remove(tokenRef);
                return res.status(200).json({ message: 'Login successful!', guildId: data.guildId });
            } else {
                await remove(tokenRef);
                return res.status(401).json({ error: 'Token has expired.' });
            }
        } else {
            return res.status(401).json({ error: 'Invalid token.' });
        }
    } catch (error) {
        console.error("Token verification error:", error);
        return res.status(500).json({ error: 'Database error during token verification.' });
    }
});

router.post('/logout', (req, res) => {
    req.session.destroy(err => {
        if (err) {
            return res.status(500).json({ error: 'Could not log out.' });
        }
        res.clearCookie('connect.sid');
        res.status(200).json({ message: 'Logged out successfully.' });
    });
});

router.post('/admin/login', (req, res) => {
    const { password } = req.body;
    if (password && password === process.env.ADMIN_PASSWORD) {
        req.session.isAdmin = true;
        res.status(200).json({ message: 'Admin login successful.' });
    } else {
        res.status(401).json({ error: 'Invalid password.' });
    }
});

router.post('/admin/logout', (req, res) => {
    req.session.destroy(err => {
        if (err) {
            return res.status(500).json({ error: 'Could not log out.' });
        }
        res.clearCookie('connect.sid');
        res.status(200).json({ message: 'Logged out successfully.' });
    });
});

module.exports = router;
