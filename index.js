require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const axios = require('axios');

// Get API credentials from environment variables
const API_USERNAME = process.env.API_USERNAME;
const API_PASSWORD = process.env.API_PASSWORD;
const PORT = process.env.PORT || 3000;

// Validate API credentials
if (!API_USERNAME || API_USERNAME === 'your_46elks_api_username' || 
    !API_PASSWORD || API_PASSWORD === 'your_46elks_api_password') {
  console.warn("Warning: 46elks API credentials not properly configured in .env file");
}

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// In-memory message store for demo purposes
// In a real app, you'd use a database
const messages = [];

// Routes
app.get('/api/messages', (req, res) => {
  res.json(messages);
});

app.put('/api/messages/:id', (req, res) => {
  const { id } = req.params;
  const { status } = req.body;
  
  const messageIndex = messages.findIndex(msg => msg.id === id);
  if (messageIndex !== -1) {
    messages[messageIndex].status = status;
    
    // Broadcast the updated message to all clients
    io.emit('message-updated', messages[messageIndex]);
    
    res.json(messages[messageIndex]);
  } else {
    res.status(404).json({ error: 'Message not found' });
  }
});

app.post('/api/reply', async (req, res) => {
  const { to, message } = req.body;
  
  if (!to || !message) {
    return res.status(400).json({ error: 'Missing required fields: to and message' });
  }
  
  try {
    // Creating form data for 46elks API
    const formData = new URLSearchParams();
    formData.append('from', 'Inbox');  // You can customize this or add it to .env
    formData.append('to', to);
    formData.append('message', message);
    
    // Send SMS via 46elks API
    const response = await axios.post('https://api.46elks.com/a1/sms', 
      formData.toString(),
      {
        headers: { 
          'Content-Type': 'application/x-www-form-urlencoded' 
        },
        auth: {
          username: API_USERNAME,
          password: API_PASSWORD
        }
      }
    );
    
    console.log('SMS sent successfully:', response.data);
    
    // Store outgoing message in the local message store
    const outgoingMessage = {
      id: response.data.id || Date.now().toString(),
      from: 'You',
      to: to,
      message: message,
      timestamp: new Date().toISOString(),
      status: 'sent',
      direction: 'outgoing'
    };
    
    messages.push(outgoingMessage);
    io.emit('new-message', outgoingMessage);
    
    res.json({ 
      success: true, 
      messageId: response.data.id,
      message: outgoingMessage
    });
  } catch (error) {
    console.error('Error sending SMS:', error.response?.data || error.message);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to send SMS', 
      details: error.response?.data || error.message 
    });
  }
});

// Webhook endpoint for incoming SMS from 46elks
app.post('/api/webhook', (req, res) => {
  console.log('Received webhook:', req.body);
  
  // 46elks webhook payload format:
  // { id, from, to, message, ... }
  const { id, from, to, message } = req.body;
  
  if (!from || !message) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  
  const newMessage = {
    id: id || Date.now().toString(),
    from,
    to,
    message,
    timestamp: new Date().toISOString(),
    status: 'unread',
    direction: 'incoming'
  };
  
  messages.push(newMessage);
  
  // Broadcast the new message to all connected clients
  io.emit('new-message', newMessage);
  
  // Respond with 200 OK to the 46elks webhook
  res.status(200).json({ success: true });
});

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log('New client connected');
  
  socket.on('disconnect', () => {
    console.log('Client disconnected');
  });
});

// Start the server
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Configure 46elks to send webhooks to: http://your-server-address:${PORT}/api/webhook`);
});