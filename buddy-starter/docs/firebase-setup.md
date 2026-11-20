# Firebase setup

1. In Firebase Console create a project and register a **Web app**. Copy its API key, auth domain, project ID, and app ID into `frontend/.env.local`; these are public project identifiers, not server secrets.
2. Open Authentication → Sign-in method. Enable Email/Password and Google. Configure authorized domain `localhost` and add any future app domain before deployment.
3. Review the verification and password reset email templates and authorized redirect domains.
4. Set `FIREBASE_PROJECT_ID` in `backend/.env` to the Firebase project ID and set `NEXT_PUBLIC_FIREBASE_PROJECT_ID` in `frontend/.env.local` to that exact same ID. Keep `GOOGLE_APPLICATION_CREDENTIALS` blank for local development. The backend uses Google Application Default Credentials (ADC); it does not need a downloaded service-account key.
5. In PowerShell, authenticate your Google account and create local ADC credentials:

   ```powershell
   gcloud auth login
   gcloud config set project YOUR_FIREBASE_PROJECT_ID
   gcloud auth application-default login
   ```

   `gcloud auth login` configures the CLI; `gcloud auth application-default login` separately configures ADC used by FastAPI. Do not try to bypass an organization policy that blocks service-account key creation. If `GOOGLE_APPLICATION_CREDENTIALS` points to a missing key, the backend clears that stale value so Google ADC can use the local gcloud credentials.
6. The ADC identity must be allowed to access the Firebase project for the Firebase Admin operations used by this app. A missing/invalid ID token returns 401. Missing ADC or IAM permission problems return 503 and should be fixed by signing in with the intended Google identity or asking the project administrator for appropriate project access; do not paste credentials into logs or chat.
7. The frontend sends Firebase ID tokens in `Authorization: Bearer …`; Firebase Admin verifies the token signature and expiry, then the backend also checks that token audience (`aud`) matches `FIREBASE_PROJECT_ID`. A token from a different frontend project is rejected with 401.

The Google provider and email flow require project settings above. No credentials are included in this repository.
