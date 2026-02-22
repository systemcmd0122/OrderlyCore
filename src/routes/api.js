const express = require('express');
const router = express.Router();
const { isAuthenticated, isGuildAdmin } = require('../middleware/auth');
const { client } = require('../config/discord');
const { db } = require('../config/firebase');
const { collection, query, where, getDocs, getDoc, doc, setDoc, updateDoc, deleteDoc, orderBy, limit, startAfter, getCountFromServer } = require('firebase/firestore');

router.get('/guild-info', isAuthenticated, isGuildAdmin, async (req, res) => {
    try {
        const guild = await client.guilds.fetch(req.session.guildId);
        const channels = guild.channels.cache
            .filter(c => c.type === 0 || c.type === 2)
            .map(c => ({ id: c.id, name: c.name, type: c.type }))
            .sort((a, b) => a.name.localeCompare(b.name));

        const roles = guild.roles.cache
            .filter(r => r.id !== guild.id)
            .map(r => ({ id: r.id, name: r.name, color: r.hexColor }))
            .sort((a,b) => a.name.localeCompare(b.name));

        let memberCount = guild.memberCount || 0;
        let botCount = guild.members.cache.filter(member => member.user.bot).size;

        res.json({
            id: guild.id,
            name: guild.name,
            icon: guild.iconURL(),
            channels,
            roles,
            memberCount,
            botCount
        });
    } catch (e) {
        console.error('Error fetching guild info:', e);
        res.status(404).json({ error: 'Guild not found or failed to fetch details.' });
    }
});

router.get('/members', isAuthenticated, isGuildAdmin, async (req, res) => {
    try {
        const { page = 1, limit = 15, search = '', sortBy = 'displayName', sortOrder = 'asc', roleFilter = '' } = req.query;
        const guild = await client.guilds.fetch(req.session.guildId);
        
        try {
            await Promise.race([
                guild.members.fetch(),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 5000))
            ]);
        } catch (fetchError) {
            console.warn(`Member fetch timeout or error for guild ${guild.name}, using cache`);
        }
        
        const members = guild.members.cache;

        const levelsRef = collection(db, 'levels');
        const levelsQuery = query(levelsRef, where('guildId', '==', req.session.guildId));
        const levelsSnapshot = await getDocs(levelsQuery);
        const levelsData = new Map(levelsSnapshot.docs.map(doc => [doc.data().userId, doc.data()]));

        const warningsRef = collection(db, 'warnings');
        const warningsQuery = query(warningsRef, where('guildId', '==', req.session.guildId));
        const warningsSnapshot = await getDocs(warningsQuery);
        const warningsData = new Map();
        warningsSnapshot.forEach(doc => {
            const userId = doc.data().userId;
            warningsData.set(userId, (warningsData.get(userId) || 0) + 1);
        });

        let memberList = members.map(member => {
            const levelInfo = levelsData.get(member.id) || { messageCount: 0 };
            return {
                id: member.id,
                avatar: member.user.displayAvatarURL(),
                username: member.user.username,
                displayName: member.displayName,
                roles: member.roles.cache.filter(r => r.id !== guild.id).map(r => ({ id: r.id, name: r.name, color: r.hexColor })),
                joinedAt: member.joinedTimestamp,
                messageCount: levelInfo.messageCount || 0,
                warnCount: warningsData.get(member.id) || 0
            };
        });

        if (search) {
            const lowercasedSearch = search.toLowerCase();
            memberList = memberList.filter(m =>
                m.displayName.toLowerCase().includes(lowercasedSearch) ||
                m.username.toLowerCase().includes(lowercasedSearch)
            );
        }
        if (roleFilter) {
            memberList = memberList.filter(m => m.roles.some(r => r.id === roleFilter));
        }

        memberList.sort((a, b) => {
            let valA = a[sortBy];
            let valB = b[sortBy];
            if (typeof valA === 'string') valA = valA.toLowerCase();
            if (typeof valB === 'string') valB = valB.toLowerCase();
            if (valA < valB) return sortOrder === 'asc' ? -1 : 1;
            if (valA > valB) return sortOrder === 'asc' ? 1 : -1;
            return 0;
        });

        const totalMembers = memberList.length;
        const paginatedMembers = memberList.slice((page - 1) * limit, page * limit);

        res.json({
            members: paginatedMembers,
            totalMembers,
            totalPages: Math.ceil(totalMembers / limit),
            currentPage: parseInt(page)
        });
    } catch (error) {
        console.error('Error fetching member list:', error);
        res.status(500).json({ error: 'Failed to fetch member list.' });
    }
});

router.post('/members/:memberId/kick', isAuthenticated, isGuildAdmin, async (req, res) => {
    try {
        const guild = await client.guilds.fetch(req.session.guildId);
        const member = await guild.members.fetch(req.params.memberId);
        await member.kick(req.body.reason || '理由なし');
        res.status(200).json({ message: 'Member kicked.' });
    } catch (error) {
        console.error('Error kicking member:', error);
        res.status(500).json({ error: 'Failed to kick member.' });
    }
});

router.post('/members/:memberId/ban', isAuthenticated, isGuildAdmin, async (req, res) => {
    try {
        const guild = await client.guilds.fetch(req.session.guildId);
        const member = await guild.members.fetch(req.params.memberId);
        await member.ban({ reason: req.body.reason || '理由なし' });
        res.status(200).json({ message: 'Member banned.' });
    } catch (error) {
        console.error('Error banning member:', error);
        res.status(500).json({ error: 'Failed to ban member.' });
    }
});

router.put('/members/:memberId/roles', isAuthenticated, isGuildAdmin, async (req, res) => {
    try {
        const guild = await client.guilds.fetch(req.session.guildId);
        const member = await guild.members.fetch(req.params.memberId);
        await member.roles.set(req.body.roles);
        res.status(200).json({ message: 'Roles updated.' });
    } catch (error) {
        console.error('Error updating roles:', error);
        res.status(500).json({ error: 'Failed to update roles.' });
    }
});

router.get('/audit-logs', isAuthenticated, isGuildAdmin, async (req, res) => {
    try {
        const { eventType, user, page = 1, limit: pageLimit = 15 } = req.query;
        const logsRef = collection(db, 'audit_logs');
        let q = query(logsRef, where('guildId', '==', req.session.guildId));

        if (eventType) {
            q = query(q, where('eventType', '==', eventType));
        }
        
        const countQuery = query(q);
        const totalSnapshot = await getCountFromServer(countQuery);
        const totalLogs = totalSnapshot.data().count;

        q = query(q, orderBy('timestamp', 'desc'));

        if (page > 1) {
            const lastVisibleDocQuery = query(q, limit(pageLimit * (page - 1)));
            const lastVisibleSnapshot = await getDocs(lastVisibleDocQuery);
            const lastVisible = lastVisibleSnapshot.docs[lastVisibleSnapshot.docs.length - 1];
            if (lastVisible) {
                q = query(q, startAfter(lastVisible));
            }
        }
        
        q = query(q, limit(parseInt(pageLimit)));

        const snapshot = await getDocs(q);
        let logs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

        if (user) {
            logs = logs.filter(log => log.executorTag?.includes(user) || log.targetTag?.includes(user));
        }

        res.json({
            logs,
            totalPages: Math.ceil(totalLogs / pageLimit),
            currentPage: parseInt(page),
            totalLogs
        });
    } catch (error) {
        console.error('Error fetching audit logs:', error);
        if (error.code === 'failed-precondition') {
            return res.status(500).json({ 
                error: 'データベースインデックスが必要です。',
                errorCode: 'INDEX_REQUIRED',
                message: 'Firestoreの複合インデックスが必要です。'
            });
        }
        res.status(500).json({ error: 'Failed to fetch audit logs.' });
    }
});

router.get('/analytics/activity', isAuthenticated, isGuildAdmin, async (req, res) => {
    try {
        const guildId = req.session.guildId;
        const guild = await client.guilds.fetch(guildId);

        const levelsRef = collection(db, 'levels');
        const q = query(levelsRef, where('guildId', '==', guildId));
        const snapshot = await getDocs(q);

        const allUsersData = snapshot.docs.map(doc => doc.data());

        const topUsers = allUsersData
            .sort((a, b) => (b.messageCount || 0) - (a.messageCount || 0))
            .slice(0, 10);

        const topUsersWithDetails = await Promise.all(topUsers.map(async (user) => {
            try {
                const member = await guild.members.fetch(user.userId);
                return { ...user, displayName: member.displayName, username: member.user.username };
            } catch {
                return { ...user, displayName: '不明なユーザー', username: 'Unknown' };
            }
        }));

        const activityByHour = Array(24).fill(0);
        allUsersData.forEach(user => {
            if (user.lastMessageTimestamp) {
                const date = user.lastMessageTimestamp.toDate ? user.lastMessageTimestamp.toDate() : new Date(user.lastMessageTimestamp);
                const hour = date.getHours();
                activityByHour[hour] += user.messageCount || 0;
            }
        });
        
        try {
            await Promise.race([
                guild.members.fetch(),
                new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 5000))
            ]);
        } catch (fetchError) {
            console.warn(`Member fetch timeout for analytics in guild ${guild.name}, using cache`);
        }
        
        const roleCounts = {};
        guild.members.cache.forEach(member => {
            member.roles.cache.forEach(role => {
                if (role.id === guild.id) return;
                roleCounts[role.id] = (roleCounts[role.id] || 0) + 1;
            });
        });

        const roleDistribution = Object.entries(roleCounts)
            .map(([roleId, count]) => {
                const role = guild.roles.cache.get(roleId);
                return {
                    name: role ? role.name : '不明なロール',
                    count,
                    color: role ? role.hexColor : '#808080'
                };
            })
            .sort((a, b) => b.count - a.count)
            .slice(0, 10);

        res.json({
            topUsers: topUsersWithDetails,
            activityByHour,
            roleDistribution
        });
    } catch (error) {
        console.error('Error fetching analytics data:', error);
        res.status(500).json({ error: 'Failed to fetch analytics data.' });
    }
});

router.get('/settings/welcome-message', isAuthenticated, isGuildAdmin, async (req, res) => {
    try {
        const settingsRef = doc(db, 'guild_settings', req.session.guildId);
        const docSnap = await getDoc(settingsRef);
        if (docSnap.exists() && docSnap.data().welcomeMessage) {
            res.json(docSnap.data().welcomeMessage);
        } else {
            res.json({
                enabled: true,
                type: 'default',
                title: '🎉 {server.name} へようこそ！',
                description: '**{user.displayName}** さん、サーバーへのご参加ありがとうございます！\n\nまずはルールをご確認ください: {rulesChannel}',
                imageUrl: ''
            });
        }
    } catch (error) {
        console.error('Error fetching welcome message settings:', error);
        res.status(500).json({ error: 'Failed to fetch welcome message settings.' });
    }
});

router.post('/settings/welcome-message', isAuthenticated, isGuildAdmin, async (req, res) => {
    try {
        const settingsRef = doc(db, 'guild_settings', req.session.guildId);
        await setDoc(settingsRef, { welcomeMessage: req.body }, { merge: true });
        res.status(200).json({ message: 'Welcome message settings updated successfully.' });
    } catch (error) {
        console.error('Error updating welcome message settings:', error);
        res.status(500).json({ error: 'Failed to update welcome message settings.' });
    }
});

router.get('/settings/:collection', isAuthenticated, isGuildAdmin, async (req, res) => {
    try {
        const { collection: collectionName } = req.params;
        if (!['guilds', 'guild_settings'].includes(collectionName)) {
            return res.status(400).json({ error: 'Invalid collection specified.' });
        }
        const settingsRef = doc(db, collectionName, req.session.guildId);
        const docSnap = await getDoc(settingsRef);
        if (docSnap.exists()) {
            res.json(docSnap.data());
        } else {
            res.json({});
        }
    } catch (error) {
        console.error(`Error fetching settings from ${req.params.collection}:`, error);
        res.status(500).json({ error: `Failed to fetch settings from ${req.params.collection}.` });
    }
});

router.post('/settings/:collection', isAuthenticated, isGuildAdmin, async (req, res) => {
    try {
        const { collection: collectionName } = req.params;
        if (!['guilds', 'guild_settings'].includes(collectionName)) {
            return res.status(400).json({ error: 'Invalid collection specified.' });
        }
        const settingsRef = doc(db, collectionName, req.session.guildId);
        await setDoc(settingsRef, req.body, { merge: true });
        res.status(200).json({ message: 'Settings updated successfully.' });
    } catch (error) {
        console.error(`Error updating settings for ${req.params.collection}:`, error);
        res.status(500).json({ error: `Failed to update settings for ${req.params.collection}.` });
    }
});

router.get('/roleboards', isAuthenticated, isGuildAdmin, async (req, res) => {
    try {
        const q = query(collection(db, 'roleboards'), where('guildId', '==', req.session.guildId));
        const snapshot = await getDocs(q);
        const boards = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        res.json(boards);
    } catch (error) {
        console.error('Error fetching roleboards:', error);
        res.status(500).json({ error: 'Failed to fetch roleboards.' });
    }
});

router.post('/roleboards', isAuthenticated, isGuildAdmin, async (req, res) => {
    try {
        const { title, description, color, password } = req.body;
        const guildId = req.session.guildId;
        const boardId = `rb_${guildId}_${Date.now()}`;
        if (password && password.length > 128) {
            return res.status(400).json({ error: 'パスワードは128文字以内で指定してください。' });
        }
        const boardData = {
            guildId,
            title,
            description: description || 'ボタンをクリックしてロールを取得・削除できます。',
            color: parseInt(color.replace('#', ''), 16) || 0x5865F2,
            password: password || null,
            roles: {},
            genres: {},
            createdBy: req.session.userId,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };
        await setDoc(doc(db, 'roleboards', boardId), boardData);
        res.status(201).json({ message: 'Roleboard created successfully.', board: {id: boardId, ...boardData} });
    } catch (error) {
        console.error('Error creating roleboard:', error);
        res.status(500).json({ error: 'Failed to create roleboard.' });
    }
});

router.put('/roleboards/:id', isAuthenticated, isGuildAdmin, async (req, res) => {
    try {
        const { id } = req.params;
        const boardRef = doc(db, 'roleboards', id);
        const boardDoc = await getDoc(boardRef);
        if (!boardDoc.exists() || boardDoc.data().guildId !== req.session.guildId) {
            return res.status(404).json({ error: 'Roleboard not found.' });
        }
        const updateData = { ...req.body, updatedAt: new Date().toISOString() };
        await updateDoc(boardRef, updateData);
        res.status(200).json({ message: 'Roleboard updated successfully.' });
    } catch (error) {
        console.error(`Error updating roleboard ${req.params.id}:`, error);
        res.status(500).json({ error: 'Failed to update roleboard.' });
    }
});

router.delete('/roleboards/:id', isAuthenticated, isGuildAdmin, async (req, res) => {
     try {
        const { id } = req.params;
        const boardRef = doc(db, 'roleboards', id);
        const boardDoc = await getDoc(boardRef);
        if (!boardDoc.exists() || boardDoc.data().guildId !== req.session.guildId) {
            return res.status(404).json({ error: 'Roleboard not found.' });
        }
        await deleteDoc(boardRef);
        res.status(200).json({ message: 'Roleboard deleted successfully.' });
    } catch (error) {
        console.error(`Error deleting roleboard ${req.params.id}:`, error);
        res.status(500).json({ error: 'Failed to delete roleboard.' });
    }
});

router.get('/data-manager/collections', isAuthenticated, isGuildAdmin, async (req, res) => {
    try {
        const guildId = req.session.guildId;
        const collections = ['levels', 'warnings', 'audit_logs', 'quotes', 'roleboards'];
        const result = {};
        for (const collectionName of collections) {
            const collectionRef = collection(db, collectionName);
            const q = query(collectionRef, where('guildId', '==', guildId));
            const snapshot = await getDocs(q);
            result[collectionName] = snapshot.size;
        }
        res.json(result);
    } catch (error) {
        console.error('Error fetching collection counts:', error);
        res.status(500).json({ error: 'Failed to fetch data.' });
    }
});

router.get('/data-manager/:collection', isAuthenticated, isGuildAdmin, async (req, res) => {
    try {
        const { collection: collectionName } = req.params;
        const guildId = req.session.guildId;
        const { page = 1, limit: pageLimit = 20 } = req.query;
        const validCollections = ['levels', 'warnings', 'audit_logs', 'quotes', 'roleboards'];
        if (!validCollections.includes(collectionName)) {
            return res.status(400).json({ error: 'Invalid collection name.' });
        }
        const collectionRef = collection(db, collectionName);
        const q = query(collectionRef, where('guildId', '==', guildId));
        const snapshot = await getDocs(q);
        const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        const totalItems = data.length;
        const startIndex = (page - 1) * pageLimit;
        const paginatedData = data.slice(startIndex, startIndex + parseInt(pageLimit));
        res.json({
            data: paginatedData,
            totalItems,
            totalPages: Math.ceil(totalItems / pageLimit),
            currentPage: parseInt(page)
        });
    } catch (error) {
        console.error(`Error fetching ${req.params.collection}:`, error);
        res.status(500).json({ error: 'Failed to fetch data.' });
    }
});

router.delete('/data-manager/:collection/:id', isAuthenticated, isGuildAdmin, async (req, res) => {
    try {
        const { collection: collectionName, id } = req.params;
        const guildId = req.session.guildId;
        const validCollections = ['levels', 'warnings', 'audit_logs', 'quotes', 'roleboards'];
        if (!validCollections.includes(collectionName)) {
            return res.status(400).json({ error: 'Invalid collection name.' });
        }
        const docRef = doc(db, collectionName, id);
        const docSnap = await getDoc(docRef);
        if (!docSnap.exists() || docSnap.data().guildId !== guildId) {
            return res.status(404).json({ error: 'Document not found or access denied.' });
        }
        await deleteDoc(docRef);
        res.status(200).json({ message: 'Document deleted successfully.' });
    } catch (error) {
        console.error(`Error deleting document:`, error);
        res.status(500).json({ error: 'Failed to delete document.' });
    }
});

router.delete('/data-manager/:collection', isAuthenticated, isGuildAdmin, async (req, res) => {
    try {
        const { collection: collectionName } = req.params;
        const guildId = req.session.guildId;
        const validCollections = ['levels', 'warnings', 'audit_logs', 'quotes', 'roleboards'];
        if (!validCollections.includes(collectionName)) {
            return res.status(400).json({ error: 'Invalid collection name.' });
        }
        const collectionRef = collection(db, collectionName);
        const q = query(collectionRef, where('guildId', '==', guildId));
        const snapshot = await getDocs(q);
        const deletePromises = snapshot.docs.map(doc => deleteDoc(doc.ref));
        await Promise.all(deletePromises);
        res.status(200).json({ message: `Deleted ${snapshot.size} documents from ${collectionName}.`, count: snapshot.size });
    } catch (error) {
        console.error(`Error deleting collection:`, error);
        res.status(500).json({ error: 'Failed to delete collection data.' });
    }
});

module.exports = router;
