# Quiz Web Application

A minimal full-stack quiz web application built with Vanilla JS, Node.js (Express), and MongoDB for data storage.

## Setup Instructions

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Configure environment variables:**
   - Copy `.env.example` to `.env`:
     ```bash
     cp .env.example .env
     ```
   - Edit `.env` and set your MongoDB connection string:
     ```
     MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/gdg_quiz?retryWrites=true&w=majority
     SECRET_CODE=your_secret_code_here
     SESSION_SECRET=a_very_long_random_string_here
     ```

3. **Start the server:**
   ```bash
   npm start
   ```

4. **Access the application:**
   - Quiz: `http://localhost:3000`
   - Admin Dashboard: `http://localhost:3000/admin.html`

## MongoDB Setup

This application uses **MongoDB** to store quiz results. You can use either:

### Option 1: MongoDB Atlas (Recommended for Production)
1. Create a free account at [MongoDB Atlas](https://www.mongodb.com/cloud/atlas)
2. Create a new cluster
3. Get your connection string (looks like: `mongodb+srv://username:password@cluster.mongodb.net/`)
4. Add your connection string to the `.env` file as `MONGODB_URI`
5. Make sure to whitelist your IP address in Atlas Network Access settings

### Option 2: Local MongoDB (Development)
1. Install MongoDB locally
2. Start MongoDB service
3. The app will automatically connect to `mongodb://127.0.0.1:27017/gdg_quiz` if no `MONGODB_URI` is set

## Deployment

This app is ready for deployment on platforms like **Render**, **Railway**, **DigitalOcean**, or a VPS.

### Environment Variables
Set the following environment variables on your hosting provider:
- `MONGODB_URI`: Your MongoDB Atlas connection string (required)
- `SECRET_CODE`: The code participants must enter to start
- `SESSION_SECRET`: A long random string to secure login sessions
- `PORT`: (Optional) The port the server should run on (defaults to 3000)
- `NODE_ENV`: Set to `production` for better performance

### Data Persistence
- All quiz results are stored in **MongoDB**
- Results persist across server restarts
- Access results via the Admin Dashboard at `/admin.html`
- Download results as Excel or CSV files

## Structure
- `/public`: Frontend assets (HTML, CSS, JS, images)
- `/server`: Express backend logic and questions data
  - `index.js`: Main server file with API endpoints
  - `questions.json`: Quiz questions organized by rounds
- `.env`: Environment configuration (create from `.env.example`)

## Admin Dashboard
Access the admin dashboard at `http://localhost:3000/admin.html`
- View all submitted results
- Download results as Excel or CSV
- Requires the same secret code used for quiz access

## Configuration
- Secret code is set via `SECRET_CODE` environment variable
- Only users who know the code can participate
- Questions are configured in `server/questions.json`
