const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: ["http://localhost:3000"],
    methods: ["GET", "POST"]
  },
  pingInterval: 30000, // Interval for sending pings (30 seconds)
  pingTimeout: 5000,   // Timeout for receiving pongs (5 seconds)
});

const JWT_SECRET = 'sherin'; // Replace with your secret

// Global object to store user ID to socket ID mappings
const userSocketMap = new Map();

// Middleware to parse JWT
const parseJwt = (token) => {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (e) {
    console.error('Invalid token', e);
    return null;
  }
};

// Handle Socket.IO connections
io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // Register the user when they connect
  socket.on('register', (token) => {
    const decoded = parseJwt(token);

    if (decoded && decoded.userId) {
      const userId = decoded.userId;
      userSocketMap.set(userId, socket.id);
      console.log(`User ID ${userId} is associated with socket ID ${socket.id}`);
    } else {
      console.error('Invalid token: Cannot decode userId');
    }
  });

  // Ping/Pong mechanism
  const pingInterval = setInterval(() => {
    if (socket.connected) {
      socket.ping(); // Ping the client
    }
  }, 30000); // Ping every 30 seconds

  // Handle disconnection
  socket.on('disconnect', () => {
    clearInterval(pingInterval); // Clear the ping interval
    console.log('User disconnected:', socket.id);

    // Remove the user from the userSocketMap
    userSocketMap.forEach((value, key) => {
      if (value === socket.id) {
        userSocketMap.delete(key);
        console.log(`User ID ${key} has been removed from socket map`);
      }
    });
  });

  // Other socket events here...
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
      const clientsInRoom = await io.in(room).allSockets();
      const isReceiverInRoom = Array.from(clientsInRoom).includes(userSocketMap.get(receiverId));

      if (!isReceiverInRoom) {
        // Create and emit notification to the receiver
        const sender = await prisma.user.findUnique({ where: { id: senderId } });
        const content = `New message from ${sender.username}`;
          
        // Retrieve the receiver's socket ID
        var receiverSocketId = userSocketMap.get(receiverId);

        if (receiverSocketId) {
          io.to(receiverSocketId).emit('notification', content);
        } else {
          console.log(`No socket ID found for user ${receiverId}`);
        }
      }
    } catch (error) {
      console.error('Error sending message:', error);
    }
  });

  socket.on('onlineusers', async (token) => {
    try {
      const decoded = parseJwt(token);
      if (!decoded) {
        return;
      }
      const senderId = decoded.userId;

      // Retrieve the sender's socket ID
      var receiverSocketId = userSocketMap.get(senderId);

      if (receiverSocketId) {
        const Obj = Object.fromEntries(userSocketMap);
        const users = Object.keys(Obj).map(Number);
        io.to(receiverSocketId).emit('onlineusers', users);
      } else {
        console.log(`No socket ID found for user ${senderId}`);
      }
    } catch (error) {
      console.error('Error sending message:', error);
    }
  });

  socket.on('typing', async ({ token, receiverId }) => {
    try {
      const decoded = parseJwt(token);
      if (!decoded) {
        return;
      }
      const senderId = decoded.userId;

      const status = "typing...";
      const obj = { status, senderId, receiverId };

      // Emit typing status to the receiver
      const room = [senderId, receiverId].sort().join('-');
      io.to(room).emit('typing', obj);

    } catch (error) {
      console.error('Error sending message:', error);
    }
  });

  socket.on('leaveRoom', ({ token, receiverId }) => {
    try {
      const decoded = parseJwt(token);
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
    } catch (err) {
      console.log(err);
    }
  });

  socket.on('joinRoom', ({ token, receiverId }) => {
    try {
      const decoded = parseJwt(token);
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
    } catch (err) {
      console.log(err);
    }
  });
});

server.listen(3000, () => {
  console.log('listening on *:3000');
});
