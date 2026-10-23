# Batch OPS – Vercel

The Batch OPS dashboard (Arivihan NEET Dropper 2027), running on Vercel.

The server runs the same tested logic as the Apps Script version (`gas/Code.gs`, `gas/Admin.gs`).
Google services are provided by small Node versions in `lib/gas/`. The few Vercel-only differences live in `gas/vercel.gs`.

## How it works

- **Sign-in:** "Sign in with Google". Only users added in Admin → Users can use the dashboard.
- **Sheets access:** a Google service account. Every working sheet must be shared with it (Editor).
- **Settings, users and tokens:** kept in the hidden `_vercel_store` tab of the Batch OPS sheet, encrypted with `ENC_KEY`.
  The sheet alone never shows a token or a password.
- **Logs, Restore Points, Token History:** same tabs as before. The tamper check keeps working.
- **Daily backup:** stays in Apps Script, because service accounts cannot create Drive files.

## Environment variables (Vercel → Project → Settings → Environment Variables)

| Name | Value |
|---|---|
| `GCP_PROJECT_NUMBER` | Google Cloud → IAM & Admin → Settings → Project number |
| `GCP_SERVICE_ACCOUNT_EMAIL` | e.g. `batch-ops-bot@….iam.gserviceaccount.com` |
| `GCP_WORKLOAD_IDENTITY_POOL_ID` | `vercel` |
| `GCP_WORKLOAD_IDENTITY_POOL_PROVIDER_ID` | `vercel` |
| `GOOGLE_CLIENT_ID` | OAuth client ID (`….apps.googleusercontent.com`) for "Sign in with Google" |
| `ENC_KEY` | Long random text (40+ characters). Set it once and **never change it**, or the saved settings cannot be read. |
| `SESSION_SECRET` | A different long random text (40+ characters). |

Google access is **keyless**: Vercel OIDC + Google Workload Identity Federation, so no key file exists anywhere.
Only if your Google account allows service-account keys, you can use `GOOGLE_SA_JSON` (the full key file) instead of the four `GCP_*` values.

### Keyless Google access – one-time setup
1. In Google Cloud, enable these APIs: Google Sheets API, Google Drive API, IAM Service Account Credentials API and Security Token Service API.
2. Go to IAM & Admin → Workload Identity Federation → Create pool (name `Vercel`, ID `vercel`). Add a provider:
   - Type: OIDC. Name `Vercel`, ID `vercel`.
   - Issuer: `https://oidc.vercel.com/<team-slug>`.
   - Allowed audiences: `https://vercel.com/<team-slug>`.
   - Attribute mapping: `google.subject` = `assertion.sub`.
3. Open the service account → Principals with access → Grant access.
   - Principal: `principal://iam.googleapis.com/projects/<PROJECT_NUMBER>/locations/global/workloadIdentityPools/vercel/subject/owner:<team-slug>:project:batch-ops:environment:production`
   - Role: **Workload Identity User**.
4. In Vercel → Project → Settings → Security, turn on "Secure Backend Access with OIDC Federation" (issuer mode **Team**).

## First start

1. Deploy, then open the site and sign in with the **owner** account.
2. Open `/setup`.
3. Paste the JSON from `exportSettingsForMigration` (Apps Script → AdminGS) and click **Import**.
   Do this **before** using the Admin tab, so the existing admin password, users and log secret are used.
4. Every user saves their Internal Metrics token once with the **Token** button.

## Tests

```
node test/run.js     # login, admin, tokens, Stage switch, logs (mocked Google)
node test/run2.js    # Today, Lecture, DPP list / flags / upload (.xlsx), PDF update
node test/addclass.js  # Add class: live sheet row, position, Microlecture tab, NodePath
node test/profile.js # time and Google calls per dashboard call
```
