// DOM elements
const messageList = document.getElementById('message-list');
const messageDetail = document.getElementById('message-detail');
const messageContent = document.getElementById('message-content');
const messageFrom = document.getElementById('message-from');
const messageTime = document.getElementById('message-time');
const messageStatus = document.getElementById('message-status');
const messageBody = document.getElementById('message-body');
const replyText = document.getElementById('reply-text');
const sendReplyBtn = document.getElementById('send-reply');

// Store for messages
let messages = [];
let selectedMessageId = null;
let lastPollTime = Date.now();

// Initialize the app
async function init() {
  try {
    // Fetch existing messages
    await fetchMessages();
    
    // Set up event listeners
    setupEventListeners();
    
    // Set up polling for new messages
    setInterval(pollForNewMessages, 10000); // Poll every 10 seconds
  } catch (error) {
    console.error('Error initializing app:', error);
  }
}

// Fetch messages from the API
async function fetchMessages() {
  try {
    const response = await fetch('/api/messages');
    messages = await response.json();
    renderMessageList();
  } catch (error) {
    console.error('Error fetching messages:', error);
  }
}

// Poll for new messages
async function pollForNewMessages() {
  try {
    const response = await fetch('/api/messages');
    const latestMessages = await response.json();
    
    // Check for new or updated messages
    let hasNewMessages = false;
    
    latestMessages.forEach(newMsg => {
      const existingMsgIndex = messages.findIndex(msg => msg.id === newMsg.id);
      if (existingMsgIndex === -1) {
        // This is a new message
        messages.push(newMsg);
        hasNewMessages = true;
      } else if (JSON.stringify(messages[existingMsgIndex]) !== JSON.stringify(newMsg)) {
        // This message has been updated
        messages[existingMsgIndex] = newMsg;
        hasNewMessages = true;
        
        // If this is the currently selected message, update the detail view
        if (selectedMessageId === newMsg.id) {
          selectMessage(newMsg);
        }
      }
    });
    
    if (hasNewMessages) {
      renderMessageList();
    }
  } catch (error) {
    console.error('Error polling for messages:', error);
  }
}

// Render the message list
function renderMessageList() {
  if (messages.length === 0) {
    messageList.innerHTML = '<div class="empty-state">No messages yet</div>';
    return;
  }
  
  messageList.innerHTML = '';
  
  // Sort messages by timestamp (newest first)
  messages.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  
  messages.forEach(message => {
    const messageItem = document.createElement('div');
    messageItem.classList.add('message-item');
    
    if (message.status === 'unread') {
      messageItem.classList.add('unread');
    }
    
    if (message.id === selectedMessageId) {
      messageItem.classList.add('active');
    }
    
    const formattedTime = formatTimestamp(message.timestamp);
    
    messageItem.innerHTML = `
      <div class="from">${message.from}</div>
      <div class="preview">${message.message.substring(0, 50)}${message.message.length > 50 ? '...' : ''}</div>
      <div class="meta">
        <span class="time">${formattedTime}</span>
        <span class="status">${message.status}</span>
      </div>
    `;
    
    messageItem.addEventListener('click', () => {
      selectMessage(message);
    });
    
    messageList.appendChild(messageItem);
  });
}

// Select and display a message
function selectMessage(message) {
  selectedMessageId = message.id;
  
  // Update UI
  const allItems = messageList.querySelectorAll('.message-item');
  allItems.forEach(item => item.classList.remove('active'));
  
  const selectedItem = Array.from(allItems).find(item => 
    item.querySelector('.from').textContent === message.from && 
    item.querySelector('.preview').textContent.includes(message.message.substring(0, 20))
  );
  
  if (selectedItem) {
    selectedItem.classList.add('active');
  }
  
  // Show message details
  messageFrom.textContent = message.from;
  messageTime.textContent = formatTimestamp(message.timestamp);
  messageStatus.textContent = message.status;
  messageStatus.className = `status ${message.status}`;
  messageBody.textContent = message.message;
  
  messageContent.style.display = 'block';
  document.querySelector('#message-detail .empty-state').style.display = 'none';
  
  // If the message was unread, mark it as read
  if (message.status === 'unread') {
    updateMessageStatus(message.id, 'read');
  }
}

// Update message status
async function updateMessageStatus(id, status) {
  try {
    const response = await fetch(`/api/messages/${id}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ status })
    });
    
    const updatedMessage = await response.json();
    
    // Update local message store
    const messageIndex = messages.findIndex(msg => msg.id === id);
    if (messageIndex !== -1) {
      messages[messageIndex].status = status;
    }
    
    renderMessageList();
  } catch (error) {
    console.error('Error updating message status:', error);
  }
}

// Send a reply
async function sendReply() {
  const replyMessage = replyText.value.trim();
  if (!replyMessage || !selectedMessageId) return;
  
  const selectedMessage = messages.find(msg => msg.id === selectedMessageId);
  if (!selectedMessage) return;
  
  try {
    const response = await fetch('/api/reply', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        to: selectedMessage.from,
        message: replyMessage
      })
    });
    
    const result = await response.json();
    
    if (result.success) {
      // Clear the reply text field
      replyText.value = '';
      
      // Add the sent message to the message list
      if (result.message) {
        messages.push(result.message);
        renderMessageList();
      } else {
        // If the server didn't return the message, poll for new messages
        await fetchMessages();
      }
    } else {
      alert('Failed to send reply. Please try again.');
    }
  } catch (error) {
    console.error('Error sending reply:', error);
    alert('Error sending reply. Please try again.');
  }
}

// Format timestamp
function formatTimestamp(timestamp) {
  const date = new Date(timestamp);
  const now = new Date();
  
  // Today
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  
  // Yesterday
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) {
    return 'Yesterday ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  
  // This year
  if (date.getFullYear() === now.getFullYear()) {
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }
  
  // Other dates
  return date.toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' });
}

// Set up event listeners
function setupEventListeners() {
  sendReplyBtn.addEventListener('click', sendReply);
  
  replyText.addEventListener('keypress', function(event) {
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      sendReply();
    }
  });
}

// Initialize the app when the page loads
document.addEventListener('DOMContentLoaded', init);
