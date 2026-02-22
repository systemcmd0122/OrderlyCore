const express = require('express');
const router = express.Router();
const { ref, get, remove } = require('firebase/database');
const { rtdb } = require('../config/firebase');

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
