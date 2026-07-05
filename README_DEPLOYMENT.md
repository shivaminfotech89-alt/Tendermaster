# Deployment Instructions

You are seeing a `404: NOT_FOUND (bom1::...)` error because you likely deployed this application to **Vercel** or a similar static hosting provider.

This application includes a **custom Node.js Express Backend** (`server.ts`) which is required to securely communicate with the Gemini AI and handle backend logic. Vercel's standard deployment only serves static files and does not run Express servers.

### How to Deploy correctly:

To make this project live, you need to deploy it to a platform that supports Node.js servers. You have two options:

**Option 1: Google Cloud Run (Recommended)**
Since you are building in Google AI Studio, you can deploy directly using the **Deploy to Cloud Run** button in the top right menu of AI Studio. Cloud Run will automatically read the `package.json` start script and run the backend server.

**Option 2: Other Node.js Hosts**
You can deploy this repository to **Render**, **Railway**, or **Heroku**. 
- They will automatically run `npm run build` followed by `npm start`.
- Make sure to add the contents of `firebase-applet-config.json` as environment variables if required by your hosting platform.

### Database Seeding
Once the application is live, log in using your Google account (`shivaminfotech89@gmail.com`). Your account is hardcoded as the **Super Admin**. 
Navigate to the **Super Admin Panel** in the app to configure the Premium Plan details and your Payment UPI ID.
