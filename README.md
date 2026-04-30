# WhatsApp Zoho CRM Widget

This project is prepared as a two-part deployment:

1. Zoho CRM internal widget upload
2. Catalyst AppSail backend deployment

## What You Upload

### Widget ZIP for Zoho CRM

Build:

```bash
cd /Users/teddy/waba_webhook
npm run pack:widget
```

Output:

- [`dist/zoho-crm-widget.zip`](/Users/teddy/waba_webhook/dist/zoho-crm-widget.zip)

ZIP contents:

- [`plugin-manifest.json`](/Users/teddy/waba_webhook/plugin-manifest.json)
- [`app/`](/Users/teddy/waba_webhook/app)

This matches Zoho CRM's internal-hosted widget flow, where the ZIP contains the app files and manifest.

### Backend ZIP for Catalyst AppSail

Build:

```bash
cd /Users/teddy/waba_webhook
npm run pack:appsail
```

Output:

- [`dist/appsail-backend.zip`](/Users/teddy/waba_webhook/dist/appsail-backend.zip)

ZIP contents:

- [`appsail-nodejs/app-config.json`](/Users/teddy/waba_webhook/appsail-nodejs/app-config.json)
- [`appsail-nodejs/index.js`](/Users/teddy/waba_webhook/appsail-nodejs/index.js)
- [`appsail-nodejs/backend.cjs`](/Users/teddy/waba_webhook/appsail-nodejs/backend.cjs)
- [`appsail-nodejs/package.json`](/Users/teddy/waba_webhook/appsail-nodejs/package.json)
- [`appsail-nodejs/package-lock.json`](/Users/teddy/waba_webhook/appsail-nodejs/package-lock.json)
- [`appsail-nodejs/data/messages.json`](/Users/teddy/waba_webhook/appsail-nodejs/data/messages.json)

## Local Development

Run the widget shell locally:

```bash
npm start
```

Open:

- `https://127.0.0.1:3000/app/app_file.html`

Run the backend locally:

```bash
npm run start:appsail
```

## Environment Variables

Use [`/.env.example`](/Users/teddy/waba_webhook/.env.example) as your template.

Required Meta WhatsApp variables:

- `WA_PHONE_NUMBER_ID`
- `WA_ACCESS_TOKEN`
- `WA_VERIFY_TOKEN`

Provider selection:

- `WHATSAPP_OUTBOUND_PROVIDER=meta` for Meta Cloud API
- `WHATSAPP_OUTBOUND_PROVIDER=360dialog` for 360dialog

Required 360dialog variables when using 360dialog:

- `D360_API_KEY`
- `D360_BASE_URL`

Required Zoho variables for automatic CRM Signal creation:

- `ZOHO_CRM_CLIENT_ID`
- `ZOHO_CRM_CLIENT_SECRET`
- `ZOHO_CRM_REFRESH_TOKEN`
- `ZOHO_CRM_API_DOMAIN`
- `ZOHO_CRM_SIGNAL_NAMESPACE`
- `ZOHO_CRM_SIGNAL_ACTION_URL`

## Deployment Order

### 1. Deploy the AppSail backend

Use Catalyst CLI from the repo root:

```bash
catalyst deploy
```

Or upload the backend package built at [`dist/appsail-backend.zip`](/Users/teddy/waba_webhook/dist/appsail-backend.zip) through Catalyst.

After deployment, copy the public AppSail base URL.

### 2. Configure Meta webhook

Use the deployed backend URL if your inbound provider sends Meta-style/360dialog phone-number webhooks:

- Verify URL: `https://YOUR-APPSAIL-URL/webhook/whatsapp`
- Verify token: same value as `WA_VERIFY_TOKEN`

Subscribe to WhatsApp message events in Meta Developer Console.

If you use 360dialog, configure the webhook URL in 360dialog to:

- `https://YOUR-APPSAIL-URL/webhook/whatsapp`

360dialog’s phone-number webhook payload is compatible with the backend’s parser and does not require the Meta verification handshake on the provider side.

### 3. Create the custom Zoho CRM Signal

In Zoho CRM, create a custom signal with namespace exactly matching:

- `ZOHO_CRM_SIGNAL_NAMESPACE`

Your Zoho OAuth client must have scopes that cover:

- `ZohoCRM.signals.ALL`
- `ZohoCRM.coql.READ`
- module read access for Contacts and Leads

### 4. Upload the Zoho CRM widget ZIP

In Zoho CRM:

1. Go to `Setup -> Developer Hub -> Widgets`
2. Create a widget
3. Hosting type: `Zoho`
4. Upload [`dist/zoho-crm-widget.zip`](/Users/teddy/waba_webhook/dist/zoho-crm-widget.zip)
5. Index URL: `/app/app_file.html`
6. Associate the widget to the location you want, including Signals if needed

### 5. Set widget backend URL

The widget resolves its backend from one of these sources:

1. `window.WABA_CONFIG.backendUrl`
2. `backend_url` query parameter
3. `localStorage.waba_backend_url`
4. current origin

For production, point it to your AppSail URL.

## Runtime Behavior

### Inbound WhatsApp message

When Meta posts an inbound WhatsApp webhook:

1. The backend stores the message
2. The backend searches Zoho CRM Contacts, then Leads, by phone number
3. If a matching record is found, the backend triggers a Zoho CRM custom signal
4. When the widget opens from that signal, it reads the signal payload and refreshes the WhatsApp thread

### Outbound message from widget

When a user sends a message from the widget:

1. The widget calls `POST /api/send-message`
2. The backend sends the message through WhatsApp Cloud API
3. The backend stores the outbound message for thread history

## Health Check

Use the backend health endpoint to confirm deployment config:

```bash
curl https://YOUR-APPSAIL-URL/health
```

The response reports whether WhatsApp and Zoho signal settings are configured.

## Final Deliverables

The main files you will use are:

- [`dist/zoho-crm-widget.zip`](/Users/teddy/waba_webhook/dist/zoho-crm-widget.zip)
- [`dist/appsail-backend.zip`](/Users/teddy/waba_webhook/dist/appsail-backend.zip)
- [`/.env.example`](/Users/teddy/waba_webhook/.env.example)

## Notes

- [`server/index.js`](/Users/teddy/waba_webhook/server/index.js) is for local HTTPS widget development only.
- The CRM upload ZIP should not contain `.env`, `node_modules`, or local dev artifacts.
- The AppSail backend is the component that receives Meta webhooks and raises Zoho CRM Signals.
