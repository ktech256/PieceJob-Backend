# PieceJob V3.0 Backend

PieceJob is a second-generation global multi-service marketplace platform. This backend provides the core API, real-time tracking, matching engine, and financial infrastructure.

## Tech Stack
- **Language:** TypeScript
- **Runtime:** Node.js
- **Framework:** Express
- **Database:** MongoDB (via Mongoose)
- **Real-time:** Socket.io
- **Queueing:** BullMQ (Redis)
- **Security:** JWT, Bcrypt, Helmet, Express Rate Limit

## Getting Started

### Prerequisites
- Node.js (v18+)
- MongoDB (local or Atlas)
- Redis (required for background queues)

### Installation
1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Create a `.env` file based on `.env.example`:
   ```bash
   cp .env.example .env
   ```
4. Update the variables in `.env` with your actual credentials.

### Running Locally
To start the development server with auto-reload:
```bash
npm run dev
```

### Building for Production
To compile TypeScript to JavaScript:
```bash
npm run build
```

### Starting Production Server
```bash
npm start
```

## Production Deployment (Render)

1. Create a new **Web Service** on Render.
2. Connect your GitHub repository.
3. Configure the following:
   - **Environment:** Node
   - **Build Command:** `npm install && npm run build`
   - **Start Command:** `npm start`
4. Add the environment variables from your `.env` file to the Render Dashboard (Environment tab).
5. Ensure you have a **Redis** instance available (can use Render Redis or external like Upstash).

## Project Structure
- `src/controllers`: Request handlers
- `src/models`: Database schemas
- `src/routes`: API endpoints
- `src/services`: Core business logic (matching, financials, fraud)
- `src/middleware`: Security and auth filters
- `src/socket`: WebSocket event handlers
- `src/scripts`: Maintenance and E2E simulation scripts
- `src/utils`: Helper functions

## Security & Hardening
- **Idempotency:** Webhook processing is idempotent.
- **FraudSense:** Velocity checks and cancellation patterns monitoring.
- **Safety:** Proximity validation (20m rule) for job initiation.
- **Audit:** Immutable ledger and admin action logs.
