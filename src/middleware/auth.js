const { PermissionsBitField } = require('discord.js');
const { client } = require('../config/discord');

const isAuthenticated = (req, res, next) => {
    if (req.session.userId && req.session.guildId) {
        return next();
    }
    res.status(401).json({ error: 'Unauthorized. Please login again.' });
};

const isGuildAdmin = async (req, res, next) => {
    try {
        if (!req.session.guildId || !req.session.userId) {
            return res.status(401).json({ error: 'Unauthorized.' });
        }
        const guild = await client.guilds.fetch(req.session.guildId);
        const member = await guild.members.fetch(req.session.userId);
        if (member.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
            return next();
        }
        res.status(403).json({ error: 'Forbidden: You are not an administrator of this server.' });
    } catch (error) {
        console.error('Error checking guild admin status:', error);
        res.status(500).json({ error: 'Internal Server Error while verifying permissions.' });
    }
};

const isAdminAuthenticated = (req, res, next) => {
    if (req.session.isAdmin) {
        return next();
    }
    res.status(401).json({ error: 'Administrator access required.' });
};

module.exports = {
    isAuthenticated,
    isGuildAdmin,
    isAdminAuthenticated
};
