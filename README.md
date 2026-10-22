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
| `GOOGLE_SA_JSON` | Full content of the service-account JSON key file (paste the whole file). |
| `GOOGLE_CLIENT_ID` | OAuth client ID (`….apps.googleusercontent.com`). |
| `ENC_KEY` | Long random text (at least 32 characters). Set it once and **never change it**, or the saved settings cannot be read. |
| `SESSION_SECRET` | At least 32 random characters. |

For `ENC_KEY` and `SESSION_SECRET`, use two **different** long random texts, e.g. from a password manager (40+ characters).

## First start

1. Deploy, then open the site and sign in with the **owner** account.
2. Open `/setup`.
3. Paste the JSON from `exportSettingsForMigration` (Apps Script → AdminGS) and click **Import**.
   Do this **before** using the Admin tab, so the existing admin password, users and log secret are used.
4. Every user saves their Internal Metrics token once with the **Token** button.

## Tests

```
node test/run.js     # login, admin, tokens, Stage switch, logs (mocked Google)
node test/run2.js    # Today, Lecture, DPP list / flags / upload (.xlsx)
```
