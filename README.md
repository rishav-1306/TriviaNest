# Quiz Web Application

A minimal full-stack quiz web application built with Vanilla JS, Node.js (Express), and `xlsx` for data storage.

## Setup Instructions

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Start the server:**
   ```bash
   npm start
   ```

3. **Access the application:**
   Open a browser and navigate to `http://localhost:3000`

## Deployment
This app is ready for deployment on platforms like **Render**, **Railway**, **DigitalOcean**, or a VPS.

### Environment Variables
For security and configuration in production, set the following environment variables on your hosting provider:
- `SECRET_CODE`: The code participants must enter to start.
- `SESSION_SECRET`: A long random string to secure login sessions.
- `PORT`: (Optional) The port the server should run on (defaults to 3000).

### Data Persistence
The app saves results to `data/results.xlsx` and `data/results.csv`.
- If deploying on a platform with "ephemeral" storage (like Heroku), these files will be deleted when the server restarts.
- **Recommendation**: Use a platform that supports **Persistent Volumes** or **Disks** to keep your data safe.

## Structure
- `/public`: Frontend assets (HTML, CSS, JS, images)
- `/server`: Express backend logic and questions data
- `/data`: Directory where the Excel results file will be generated

## Configuration
The secret code is hardcoded in `server/index.js` as `SECRET_CODE`. Only users who know the code can participate.
