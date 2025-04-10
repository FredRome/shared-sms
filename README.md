# Shared SMS Inbox

A serverless application for managing and responding to SMS messages from 46elks.

## Architecture

This application uses:
- AWS Lambda + API Gateway for the serverless backend
- DynamoDB for message storage
- S3 for hosting static frontend files
- 46elks API for sending and receiving SMS messages

## Lambda Limitations

### Socket.IO Support
- **Local Development**: Socket.IO works for real-time updates when running locally with `npm run dev`
- **Lambda Deployment**: Socket.IO is not supported in Lambda due to the stateless, event-driven nature of serverless functions
- **Alternative**: The deployed version uses polling (every 10 seconds) to check for new messages instead

## DynamoDB Usage

The current implementation uses Scan operations to retrieve messages. For production use with larger datasets, consider:

1. Adding a GSI (Global Secondary Index) with a suitable partition key
2. Using Query operations instead of Scan for better performance and cost efficiency

## Setup and Deployment

### Local Development
```
npm install
npm run dev
```

### AWS Deployment
```
npm install -g serverless
npm install
serverless deploy
```

### 46elks Configuration
1. Get your API Gateway URL from the deployment output
2. Configure your 46elks webhook URL to: `https://your-api-gateway-url/api/webhook`
3. Set your 46elks API credentials in the Lambda environment variables

## Security Considerations

- Never commit API credentials to version control
- In production, restrict CORS to specific origins
- Consider using AWS Secrets Manager for API credentials