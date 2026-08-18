# AGENTS.md

## Project Overview

This workspace contains a Zoho/Catalyst WhatsApp integration with two separate runtime surfaces:

1. `server/index.js`
   Local HTTPS development server for the Zoho widget shell.
   Serves `app/`, injects Zoho client metadata from `plugin-manifest.json`, and listens on `https://127.0.0.1:3000`.

2. `appsail-nodejs/index.js`
   AppSail Node.js service configured by [`appsail-nodejs/app-config.json`](/Users/teddy/waba_webhook/appsail-nodejs/app-config.json).
   This is the deployable backend entrypoint referenced by [`catalyst.json`](/Users/teddy/waba_webhook/catalyst.json).

## Source Of Truth

Use the code, not assumptions:

- Local widget dev server command comes from [`package.json`](/Users/teddy/waba_webhook/package.json).
- AppSail runtime command comes from [`appsail-nodejs/app-config.json`](/Users/teddy/waba_webhook/appsail-nodejs/app-config.json).
- Deployment wiring comes from [`catalyst.json`](/Users/teddy/waba_webhook/catalyst.json).
- Widget/backend integration expectations live in [`app/widget.js`](/Users/teddy/waba_webhook/app/widget.js).

## Working Commands

Run these from the repo root unless noted otherwise.

### Install dependencies

```bash
npm install
cd appsail-nodejs && npm install
```

### Run the local Zoho widget shell

```bash
npm start
```

This starts [`server/index.js`](/Users/teddy/waba_webhook/server/index.js) on `https://127.0.0.1:3000`.

### Run the AppSail service locally

```bash
npm run start:appsail
```

The service listens on `X_ZOHO_CATALYST_LISTEN_PORT` when present, otherwise `3000`.

### Serve through Catalyst

If the Catalyst CLI is installed and authenticated:

```bash
catalyst serve
```

### Deploy the AppSail service

If the Catalyst CLI is installed and authenticated:

```bash
catalyst deploy
```

## Expected Workflows

### Frontend/widget changes

When changing the Zoho CRM widget UI or behavior:

- Edit files under [`app/`](/Users/teddy/waba_webhook/app).
- Use `npm start` to run the HTTPS widget shell locally.
- Keep [`plugin-manifest.json`](/Users/teddy/waba_webhook/plugin-manifest.json) and the HTML entry at [`app/app_file.html`](/Users/teddy/waba_webhook/app/app_file.html) aligned.
- Configure the backend host through `window.WABA_CONFIG.backendUrl`, a `backend_url` query parameter, or `localStorage.waba_backend_url` when the widget is not sharing the same origin as the backend.

### Backend/AppSail changes

When changing the deployed backend:

- Edit files under [`appsail-nodejs/`](/Users/teddy/waba_webhook/appsail-nodejs).
- Run `npm run start:appsail` or `cd appsail-nodejs && node index.js` for quick local checks.
- Keep startup behavior consistent with [`appsail-nodejs/app-config.json`](/Users/teddy/waba_webhook/appsail-nodejs/app-config.json).
- Deploy with `catalyst deploy` once verified.

### Full-stack integration changes

When changing API contracts between the widget and backend:

- Update the fetch calls in [`app/widget.js`](/Users/teddy/waba_webhook/app/widget.js).
- Keep the local HTTPS server and AppSail service aligned by reusing [`appsail-nodejs/backend.cjs`](/Users/teddy/waba_webhook/appsail-nodejs/backend.cjs).
- Verify end-to-end behavior after deployment with the deployed backend URL configured for the widget host.

## Integration Endpoints

- `GET /health`
- `GET /api/messages?phone=<E164-ish digits>&limit=50`
- `POST /api/send-message`
- `GET /webhook/whatsapp`
- `POST /webhook/whatsapp`

## Current Caveats

- There is still no automated test suite; validation is currently done with smoke tests against the running servers.
- Both the local widget shell and the AppSail sample default to port `3000`, so do not run them directly at the same time without changing one port.

## Editing Guidance

- Prefer `rg` for code search.
- Avoid editing `node_modules/`.
- Keep secrets out of committed docs and code; do not copy values from `.env` into source files.
- Preserve the Zoho widget bootstrap in [`app/app_file.html`](/Users/teddy/waba_webhook/app/app_file.html) and the manifest-driven script injection in [`server/index.js`](/Users/teddy/waba_webhook/server/index.js).
- When adding new commands, add them here only if they are supported by files checked into this repo.

## Quick File Map

- [`package.json`](/Users/teddy/waba_webhook/package.json): root local dev command
- [`server/index.js`](/Users/teddy/waba_webhook/server/index.js): local HTTPS widget server
- [`app/app_file.html`](/Users/teddy/waba_webhook/app/app_file.html): widget HTML entry
- [`app/widget.js`](/Users/teddy/waba_webhook/app/widget.js): widget logic and backend API calls
- [`appsail-nodejs/index.js`](/Users/teddy/waba_webhook/appsail-nodejs/index.js): AppSail backend entry
- [`appsail-nodejs/app-config.json`](/Users/teddy/waba_webhook/appsail-nodejs/app-config.json): AppSail runtime/deploy config
- [`catalyst.json`](/Users/teddy/waba_webhook/catalyst.json): Catalyst component mapping

## Zoho Signal Configuration

To ensure Zoho Signals work correctly, you must configure the following environment variables in your Zoho Catalyst console for the AppSail service:

- `ZOHO_CRM_SIGNAL_NAMESPACE`: Set this to `zohocrmsignalnamespace_waba`.
- `ZOHO_CRM_SIGNAL_ACTION_URL`: Set this to your deployed AppSail URL (e.g., `https://waba-10123192285.development.catalystappsail.com`).
- `ZOHO_CRM_SIGNAL_ACTION_DISPLAY_NAME`: (Optional) The text displayed on the action button in the Zoho Signal (e.g., "Open WhatsApp").
- `ZOHO_CRM_SIGNAL_ACTION_OPEN_IN`: (Optional) Set to `popup` or `tab` (defaults to `popup`).

Make sure the namespace in Zoho CRM settings matches exactly with `zohocrmsignalnamespace_waba`.
137	
138	## Zoho SalesIQ Integration
139	
140	To route messages through Zoho SalesIQ, set the following environment variables in your Zoho Catalyst console:
141	
142	- `SALESIQ_SCREEN_NAME`: Your SalesIQ Screen Name (e.g., `zylker`).
143	- `ZOHO_SALESIQ_SERVER_URI`: (Optional) Defaults to `salesiq.zoho.com`. Set this if your data center is different (e.g., `salesiq.zoho.eu`).
144	
145	### SalesIQ Webhook Setup
146	
147	1. In SalesIQ, go to **Settings > Automation > Webhooks**.
148	2. Create a new webhook with the URL: `https://waba-10123192285.development.catalystappsail.com/webhook/salesiq`.
149	3. Subscribe to the **Message Sent** event.
150	4. This will allow operator replies in SalesIQ to be sent back to the customer via WhatsApp.
151	
152	### Message Flow
153	
154	- **Incoming**: WhatsApp -> AppSail -> SalesIQ (Visitor Message)
155	- **Outgoing**: SalesIQ (Operator Reply) -> AppSail Webhook -> WhatsApp (via 360dialog)
156	

## WhatsApp Visa Questionnaire

The AppSail webhook includes a resumable, one-question-at-a-time UK visa questionnaire in `appsail-nodejs/questionnaire.cjs`. A customer starts it by sending `START`, `VISA`, `QUESTIONNAIRE`, or `BEGIN`. During the flow, `BACK`, `SUMMARY`, and `RESTART` are supported. Answers are stored in `appsail-nodejs/data/questionnaire-sessions.json` alongside the existing message store.

The flow is enabled by default. Set `WA_VISA_QUESTIONNAIRE_ENABLED=false` in the AppSail environment to disable it. Outbound replies use the existing Meta or 360dialog provider configuration. The implementation records uploaded WhatsApp media as received placeholders; production document retrieval and adviser-facing storage can be added separately if required.

Before deployment, configure the existing WhatsApp webhook verification and outbound credentials, then send `START` from a test mobile number and verify that each reply contains only the next questionnaire prompt.

## Adviser Questionnaire Exports

Completed questionnaire sessions can be exported from the AppSail backend using the protected endpoints `GET /api/visa-questionnaire/<mobile>.csv` and `GET /api/visa-questionnaire/<mobile>.pdf`. Requests must include either `X-Export-Token: <token>` or `Authorization: Bearer <token>`, where the token is configured only as the `VISA_EXPORT_TOKEN` AppSail environment variable. The endpoints return `401` when the token is invalid and `404` unless the session is marked complete. Do not put the token in a URL or commit it to the repository.

## Zoho Cliq Adviser Export Command

The ready-to-paste Deluge command-execution function is stored at `zoho/visaexport_cliq_command.deluge`. Create a Zoho Cliq slash command named `visaexport`, map it to this function, and invoke it as `/visaexport <mobile-number> <pdf|csv>`. The function calls `https://waba-10123192285.catalystappsail.com` and uses the `dialogcrm` connection. That connection must be configured to carry the adviser authentication accepted by the export endpoints, preferably as `X-Export-Token` or an equivalent `Authorization: Bearer` value. The returned PDF or CSV is attached directly to the Cliq response rather than exposing a public download URL.
