const express = require('express');
const http = require('http');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { Server } = require('socket.io');
const { PrismaClient } = require('@prisma/client');


const prisma = new PrismaClient();
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: ["https://chat-frontend-ashen.vercel.app", "http://localhost:5173"], // Added localhost
    methods: ["GET", "POST"]
  }
});


const JWT_SECRET = 'your_jwt_secret'; // Replace with your secret

app.use(cors());
app.use(express.json());

2  // Global object to store user ID to socket ID mappings

// Register user
app.post('/register', async (req, res) => {
  const { email, password, username } = req.body;
  const hashedPassword = await bcrypt.hash(password, 10);
  try {
    const user = await prisma.user.create({
      data: { email, password: hashedPassword, username },
    });
    res.json(user);
  } catch (error) {
    console.log(error);
    res.status(400).send('User already exists');
  }
});

// Login user
app.post('/login', async (req, res) => {
  const { email, password } = req.body;
  const user = await prisma.user.findUnique({ where: { email } });

  if (user && await bcrypt.compare(password, user.password)) {
    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '24h' });
    res.json({ token });
  } else {
    res.status(401).send('Invalid credentials');
  }
});

// Middleware to authenticate token
const authenticateToken = (req, res, next) => {
  const token = req.headers['authorization'];
  if (!token) return res.sendStatus(401);

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.sendStatus(403);
    req.userId = user.userId;
    next();
  });
};

// Get all users
app.get('/users', async (req, res) => {
  const users = await prisma.user.findMany();
  res.json(users);
});

// Get user by id
app.get('/users/:id', async (req, res) => {
  const { id } = req.params;
  const user = await prisma.user.findUnique({ where: { id: parseInt(id) } });
  res.json(user);
});

// Get messages between two users
app.get('/messages/:senderId/:receiverId', authenticateToken, async (req, res) => {
  const { senderId, receiverId } = req.params;

  const messages = await prisma.message.findMany({
    where: {
      OR: [
        { senderId: parseInt(senderId), receiverId: parseInt(receiverId) },
        { senderId: parseInt(receiverId), receiverId: parseInt(senderId) },
      ],
    },
    orderBy: {
      createdAt: 'asc',
    },
  });

  res.json(messages);
});

// Get notifications for the user
app.get('/notifications', authenticateToken, async (req, res) => {
  const notifications = await prisma.notification.findMany({
    where: {
      userId: req.userId,
      seen: false,
    },
    orderBy: {
      createdAt: 'asc',
    },
  });

  res.json(notifications);
});

// Mark notifications as seen
app.post('/notifications/mark-seen', authenticateToken, async (req, res) => {
  const { notificationIds } = req.body;
  await prisma.notification.updateMany({
    where: {
      id: { in: notificationIds },
      userId: req.userId,
    },
    data: {
      seen: true,
    },
  });

  res.sendStatus(200);
});

const parseJwt = (token) => {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (e) {
    console.error('Invalid token', e);
    return null;
  }
};

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // Store the user's socket ID when they connect
  socket.on('register', (userId) => {
    userSocketMap.set(userId, socket.id);
    console.log(`User ${userId} connected with socket ID ${socket.id}`);
  });

  socket.on('message', async ({ token, receiverId, content }) => {
    try {
      const decoded = parseJwt(token);
      if (!decoded) {
        return;
      }
      const senderId = decoded.userId;

      const message = await prisma.message.create({
        data: {
          content,
          senderId,
          receiverId,
        },
      });

      // Emit message to the receiver
      const room = [senderId, receiverId].sort().join('-');
      io.to(room).emit('message', message);

      // Check if the receiver is in the same room
      // const clientsInRoom = await io.in(room).allSockets();
      // const isReceiverInRoom = Array.from(clientsInRoom).includes(userSocketMap.get(receiverId));

      // if (!isReceiverInRoom) {
      //   // Create and emit notification to the receiver
      //   const sender = await prisma.user.findUnique({ where: { id: senderId } });
      //   console.log(sender)
      //   const notification = await prisma.notification.create({
      //     data: {
      //       userId: receiverId,
      //       messageId: message.id,
      //       content: `New message from ${sender.username}`,
      //     },
      //   });
      //   console.log(notification);

      //   // Retrieve the receiver's socket ID
      //   const receiverSocketId = userSocketMap.get(receiverId);

      //   if (receiverSocketId) {
      //     io.to(receiverSocketId).emit('notification', notification);
      //   } else {
      //     console.log(`No socket ID found for user ${receiverId}`);
        // }
      // }
    } catch (error) {
      console.error('Error sending message:', error);
    }
  });

  socket.on('joinRoom', ({ token, receiverId }) => {
    try
    {
    console.log(token)
    console.log(receiverId)
    const decoded = parseJwt(token);
    console.log(decoded)
    if (!decoded) {
      return;
    }
    const userId = decoded.userId;

    // Leave the previous room
    const previousRoom = socket.rooms.size > 1 ? Array.from(socket.rooms)[1] : null;
    if (previousRoom) {
      socket.leave(previousRoom);
      console.log(`User ${userId} left room ${previousRoom}`);
    }

    // Join the new room
    const newRoom = [userId, receiverId].sort().join('-');
    socket.join(newRoom);
    console.log(`User ${userId} joined room ${newRoom}`);

    }
    catch(err)
    {
      console.log(err)
    }
  });

  socket.on('disconnect', () => {
    console.log('User disconnected');
    // Remove the user from the mapping if needed
    // userSocketMap.forEach((value, key) => {
    //   if (value === socket.id) {
    //     userSocketMap.delete(key);
    //   }
    // });
  });
});

server.listen(3000, () => {
  console.log('listening on *:3000');
});
