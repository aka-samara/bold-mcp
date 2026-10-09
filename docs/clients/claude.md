# Claude (claude.ai, desktop and mobile)

Custom connectors are set up once on the web or desktop app and then work on mobile too. On Team and Enterprise plans an owner adds the connector for the organisation first.

1. Open **Settings → Connectors** and choose **Add custom connector**.
2. Name: `Bill of Lading Data`. URL: `https://mcp.billofladingdata.com/mcp` (staging: `https://mcp-staging.billofladingdata.com/mcp`). Leave the OAuth client fields empty.
3. Choose **Connect**. A Bill of Lading Data page opens: paste your API key, check the spending settings, choose **Connect**. You return to Claude.
4. In a chat, open the tools menu and make sure Bill of Lading Data is on.

To disconnect, remove the connector in Settings → Connectors. Rotating your API key in your Bill of Lading Data account also ends every connection that uses it (connect again with the new key), and connections unused for 90 days expire.

When Claude asks to confirm a paid call or an unlock, it shows the credits and pool; answer in the chat.
