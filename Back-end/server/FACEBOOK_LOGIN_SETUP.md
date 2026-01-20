# Facebook Login Setup Guide

To enable Facebook Login for the Autobacs application, follow these steps to configure a Facebook App and update your environment variables.

## 1. Create a Facebook App

1.  Go to the [Facebook Developers Console](https://developers.facebook.com/apps/).
2.  Click **Create App**.
3.  Select **Authenticate and request data from users with Facebook Login** (or "Consumer" / "Business" depending on current options, usually "Consumer" is fine for login).
4.  Click **Next**.
5.  Enter a **Display Name** (e.g., "Autobacs Dev") and your **App Contact Email**.
6.  Click **Create App**.

## 2. Configure Facebook Login

1.  In the App Dashboard, find **Facebook Login** under "Add products to your app" and click **Set Up**.
2.  Select **Web** as the platform.
3.  **Site URL**: Enter `http://localhost:3000/` (or your frontend URL).
4.  Click **Save**, then **Continue** (you can skip the rest of the Quickstart).

## 3. Configure OAuth Settings

1.  In the left sidebar, expand **Facebook Login** and click **Settings**.
2.  Find **Valid OAuth Redirect URIs**.
3.  Add your backend callback URL:
    ```
    http://localhost:5000/auth/facebook/callback
    ```
    *(Note: If you change your backend port or domain, update this accordingly.)*
4.  Click **Save Changes**.

## 4. Get App Credentials

1.  In the left sidebar, go to **App Settings** -> **Basic**.
2.  Find **App ID** and **App Secret**.
3.  Click **Show** next to App Secret (you may need to enter your password).

## 5. Update Environment Variables

1.  Open your backend `.env` file (`c:\Main project\Autobacs\Back-end\server\.env`).
2.  Add the following lines (replace with your actual credentials):

    ```env
    # Facebook Login
    FACEBOOK_CLIENT_ID=your_app_id_here
    FACEBOOK_CLIENT_SECRET=your_app_secret_here
    # Optional: FACEBOOK_REDIRECT_URI=http://localhost:5000/auth/facebook/callback
    ```

3.  Restart the backend server for changes to take effect.

## 6. Testing

1.  Start the backend server (`npm run dev` in `Back-end/server`).
2.  Start the frontend (`npm run dev` in `Front-end/web`).
3.  Go to the Login page (`http://localhost:3000/login`).
4.  Click **Continue with Facebook**.
5.  You should be redirected to Facebook, asked to approve the app, and then redirected back to the dashboard logged in.

## Troubleshooting

-   **"URL Blocked" Error**: Ensure `http://localhost:5000/auth/facebook/callback` is exactly listed in **Valid OAuth Redirect URIs**.
-   **"App Not Setup" Error**: Ensure the App is in "Live" mode if testing with non-admin/developer accounts, or add test users in the Roles section.
-   **HTTPS Requirement**: Facebook generally requires HTTPS. For `localhost`, http is usually allowed. If you deploy, you MUST use https.
