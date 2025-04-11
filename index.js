require('dotenv').config();
const express = require('express');
const serverless = require('serverless-http');
const axios = require('axios');
const AWS = require('aws-sdk');
const cors = require('cors');
const getRawBody = require('raw-body');

const dynamoDB = new AWS.DynamoDB.DocumentClient();

const API_USERNAME = process.env.API_USERNAME;
const API_PASSWORD = process.env.API_PASSWORD;
const TABLE_NAME = process.env.DYNAMODB_TABLE || 'SharedSmsInbox';
const TELAVOX_ADMIN_TOKEN = process.env.TELAVOX_ADMIN_TOKEN;
const TELAVOX_USER_TOKEN = process.env.TELAVOX_USER_TOKEN;

const app = express();

// CORS
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// 🧠 Body parser replacement for raw-body handling
app.use(async (req, res, next) => {
  try {
    const raw = await getRawBody(req);
    const contentType = req.headers['content-type'] || '';

    if (contentType.includes('application/json')) {
      try {
        req.body = JSON.parse(raw.toString('utf-8'));
      } catch (err) {
        console.warn('Invalid JSON, keeping raw buffer.');
        req.body = raw;
      }
    } else {
      req.body = raw;
    }

    next();
  } catch (err) {
    console.error('Error parsing body:', err);
    res.status(400).send('Invalid body');
  }
});

// GET messages
app.get('/api/messages', async (req, res) => {
  try {
    const params = {
      TableName: TABLE_NAME,
      Limit: 100,
      ScanIndexForward: false
    };

    const result = await dynamoDB.scan(params).promise();
    res.json(result.Items || []);
  } catch (error) {
    console.error('Error fetching messages:', error);
    res.status(500).json({ error: 'Failed to fetch messages' });
  }
});

// PUT message status update
app.put('/api/messages/:id', async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  try {
    const params = {
      TableName: TABLE_NAME,
      Key: { id },
      UpdateExpression: 'set #status = :status',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: { ':status': status },
      ReturnValues: 'ALL_NEW'
    };

    const result = await dynamoDB.update(params).promise();
    res.json(result.Attributes);
  } catch (error) {
    console.error('Error updating message:', error);
    res.status(500).json({ error: 'Failed to update message' });
  }
});

// POST send SMS via 46elks
app.post('/api/reply', async (req, res) => {
  const { to, message } = req.body;

  if (!to || !message) {
    return res.status(400).json({ error: 'Missing required fields: to and message' });
  }

  try {
    const formData = new URLSearchParams();
    formData.append('from', 'Inbox');
    formData.append('to', to);
    formData.append('message', message);

    const response = await axios.post('https://api.46elks.com/a1/sms',
      formData.toString(),
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        auth: { username: API_USERNAME, password: API_PASSWORD }
      }
    );

    const outgoingMessage = {
      id: response.data.id || Date.now().toString(),
      from: 'You',
      to,
      message,
      timestamp: new Date().toISOString(),
      status: 'sent',
      direction: 'outgoing'
    };

    await dynamoDB.put({
      TableName: TABLE_NAME,
      Item: outgoingMessage
    }).promise();

    res.json({ success: true, messageId: response.data.id, message: outgoingMessage });
  } catch (error) {
    console.error('Error sending SMS:', error.response?.data || error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to send SMS',
      details: error.response?.data || error.message
    });
  }
});

// POST webhook from 46elks
app.post('/api/webhook', async (req, res) => {
  console.log('Received webhook payload:', JSON.stringify(req.body));

  let payload = {};

  // Handle Buffer-style input
  if (req.body && req.body.type === 'Buffer' && Array.isArray(req.body.data)) {
    try {
      const buffer = Buffer.from(req.body.data);
      const rawString = buffer.toString('utf-8');
      console.log('Decoded buffer string:', rawString);
      
      // Check if it's URL-encoded form data (which 46elks sends)
      if (rawString.includes('&') && rawString.includes('=')) {
        // Parse URL-encoded form data
        const params = new URLSearchParams(rawString);
        params.forEach((value, key) => {
          payload[key] = value;
        });
        console.log('Parsed URL form data:', payload);
      } else {
        // Try to parse as JSON
        try {
          payload = JSON.parse(rawString);
        } catch (e) {
          console.error('Error parsing as JSON:', e);
        }
      }
    } catch (e) {
      console.error('Error decoding buffer payload:', e);
    }
  } else if (Buffer.isBuffer(req.body)) {
    try {
      const rawString = req.body.toString('utf-8');
      console.log('Decoded buffer string (Buffer body):', rawString);
      
      // Check if it's URL-encoded form data
      if (rawString.includes('&') && rawString.includes('=')) {
        // Parse URL-encoded form data
        const params = new URLSearchParams(rawString);
        params.forEach((value, key) => {
          payload[key] = value;
        });
        console.log('Parsed URL form data (Buffer body):', payload);
      } else {
        // Try to parse as JSON
        try {
          payload = JSON.parse(rawString);
        } catch (e) {
          console.error('Error parsing Buffer as JSON:', e);
        }
      }
    } catch (e) {
      console.error('Error parsing raw buffer body:', e);
    }
  } else {
    payload = req.body;
  }

  console.log('Final parsed webhook payload:', payload);

  // Extract fields, supporting both 46elks form data format and JSON
  const id = payload.id || Date.now().toString();
  const from = payload.from || '';
  const to = payload.to || 'unknown';
  const message = payload.message || '';

  if (!from || !message) {
    console.error('Missing required fields: from =', from, 'message =', message);
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    const newMessage = {
      id,
      from,
      to,
      message,
      timestamp: new Date().toISOString(),
      status: 'unread',
      direction: 'incoming'
    };

    await dynamoDB.put({
      TableName: TABLE_NAME,
      Item: newMessage
    }).promise();

    // Create Telavox ticket
    try {
      // Step 1: Create ticket
      const visitorId = from.replace(/^\+46/, '0'); // Extract only numbers from the sender's phone
      const createTicketResponse = await axios.post(
        `https://flow.telavox.com/api/internal/tickets?visitorId=${visitorId}`,
        '',
        {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${TELAVOX_ADMIN_TOKEN}`
          }
        }
      );

      console.log('Telavox ticket created:', createTicketResponse.data);
      
      // Get ticket ID from response
      const ticketId = createTicketResponse.data.key;
      if (!ticketId) {
        throw new Error('No ticket ID returned from Telavox API');
      }

      // Step 2: Add member to the ticket
      await axios.put(
        `https://flow.telavox.com/api/internal/tickets/${ticketId}/members`,
        [
            'extension-6302421',
            'extension-1829770',
            'extension-1829703',
            'extension-4105463',
            'extension-2593256',
            'extension-1379',
            'extension-905678',
            'extension-4229674',
            'extension-3533994',
            'extension-4425906',
            'extension-906127',
            'extension-292423',
            'extension-1159014',
            'extension-1810281',
            'extension-5089384',
            'extension-2412214',
            'extension-1403122',
            'extension-1241031',
            'extension-1746309',
            'extension-8260',
            'extension-1491560',
            'extension-370096',
            'extension-905679',
            'extension-6430368'
        ],
        {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${TELAVOX_ADMIN_TOKEN}`
          }
        }
      );
      
      console.log('Member added to ticket:', ticketId);

      // Step 3: Add internal note with the SMS message
      await axios.put(
        `https://flow.telavox.com/api/internal/tickets/${ticketId}/internalNotes`,
        {
          "DTOSubtype": "OmniInternalNoteTicketEvent",
          "type": "note_internal",
          "message": `SMS from ${from}: ${message}`,
          "stylings": [],
          "sender": "extension-6302421",
          "read": true
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${TELAVOX_USER_TOKEN}`
          }
        }
      );
      
      console.log('Internal note added to ticket:', ticketId);
      
      // Store ticket ID in DynamoDB
      await dynamoDB.update({
        TableName: TABLE_NAME,
        Key: { id },
        UpdateExpression: 'set telavoxTicketId = :ticketId',
        ExpressionAttributeValues: { ':ticketId': ticketId }
      }).promise();
      
    } catch (telavoxError) {
      console.error('Error creating Telavox ticket:', telavoxError.response?.data || telavoxError.message);
      // Continue with normal response even if Telavox ticket creation fails
    }

    res.status(200).json({ success: true });
  } catch (error) {
    console.error('Error storing webhook message:', error);
    res.status(500).json({ error: 'Failed to process webhook' });
  }
});

// Export handler for AWS Lambda
module.exports.handler = serverless(app);