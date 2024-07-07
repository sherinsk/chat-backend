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
    origin: "http://localhost:5174","https://chat-frontend-pied.vercel.app",// Update this to match your frontend URL
    methods: ["GET", "POST"]
  }
});

const JWT_SECRET = 'your_jwt_secret'; // Replace with your secret

app.use(cors());
app.use(express.json());

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
    const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '1h' });
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
app.get('/users', authenticateToken, async (req, res) => {
  const users = await prisma.user.findMany();
  res.json(users);
});

// Get user by id
app.get('/users/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const user = await prisma.user.findUnique({ where: { id: parseInt(id) } });
  res.json(user);
});

io.on('connection', (socket) => {
  console.log('a user connected');

  socket.on('joinRoom', ({ token, receiverId }) => {
    jwt.verify(token, JWT_SECRET, (err, decoded) => {
      if (err) {
        console.error('Invalid token');
        return;
      }
      const senderId = decoded.userId;
      const room = [senderId, receiverId].sort().join('-');
      console.log(room)
      socket.join(room);
    });
  });

  socket.on('message', async ({ token, receiverId, content }) => {
    jwt.verify(token, JWT_SECRET, async (err, decoded) => {
      if (err) {
        console.error('Invalid token');
        return;
      }
      const senderId = decoded.userId;
      try {
        console.log("hi")
        const message = await prisma.message.create({
          data: {
            content,
            senderId: parseInt(senderId),
            receiverId: parseInt(receiverId),
          },
        });

        const room = [senderId, receiverId].sort().join('-');
        io.to(room).emit('message', message);
      } catch (err) {
        console.error('Error saving message:', err);
      }
    });
  });

  socket.on('disconnect', () => {
    console.log('user disconnected');
  });
});

// Get messages between two users
app.get('/messages/:senderId/:receiverId', authenticateToken, async (req, res) => {
  const {receiverId } = req.params;
  const senderId=req.userId

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

server.listen(3000, () => {
  console.log('listening on *:3000');
});
